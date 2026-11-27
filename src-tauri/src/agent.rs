//! Claude Code hook plumbing for agent terminals the IDE launches: subagent tree + exact status.
//! Uses only documented features: `claude --settings <file>` (merges with the user's own settings)
//! and hooks (https://code.claude.com/docs/en/hooks). Event files are local and deleted once read.

use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// Writes the hook's stdin JSON to its own file (mktemp → write → mv, so readers only ever see
/// complete `*.json` files). Prints nothing and always exits 0, so it can't influence Claude.
const HOOK_CMD: &str =
    r#"[ -n "$IDE_AGENT_EVENTS" ] && mkdir -p "$IDE_AGENT_EVENTS" && f=$(mktemp "$IDE_AGENT_EVENTS/e.XXXXXX") && cat > "$f" && mv "$f" "$f.json"; exit 0"#;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("agent-events"))
}

/// Per-terminal event dir, derived from the terminal key (never a caller-supplied path, since
/// `agent_events` deletes what it reads).
fn events_dir(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad terminal key".into());
    }
    Ok(root(app)?.join(key))
}

/// Like HOOK_CMD but wraps the payload as `{"ide_hook":"<event>","payload":<stdin>}` — for CLIs whose
/// payloads don't name the event (one command per event, so the event name is known here).
fn tagged_cmd(event: &str) -> String {
    format!(
        r#"[ -n "$IDE_AGENT_EVENTS" ] && mkdir -p "$IDE_AGENT_EVENTS" && f=$(mktemp "$IDE_AGENT_EVENTS/e.XXXXXX") && {{ printf '{{"ide_hook":"{event}","payload":'; cat; printf '}}'; }} > "$f" && mv "$f" "$f.json"; exit 0"#
    )
}

/// Claude-style `{ Event: [{ matcher?, hooks: [{ type, command }] }] }` map (Claude, Qwen, Gemini, Codex, Droid, Goose).
fn claude_style(events: &[(&str, Option<&str>)], tagged: bool) -> Value {
    let mut m = serde_json::Map::new();
    for (ev, matcher) in events {
        let command = if tagged { tagged_cmd(ev) } else { HOOK_CMD.to_string() };
        let mut entry = json!({ "hooks": [{ "type": "command", "command": command }] });
        if let Some(mt) = matcher {
            entry["matcher"] = json!(mt);
        }
        m.insert((*ev).to_string(), json!([entry]));
    }
    Value::Object(m)
}

fn settings_json() -> Value {
    let hook = json!([{ "hooks": [{ "type": "command", "command": HOOK_CMD }] }]);
    let agent_tool = json!([{ "matcher": "Agent|Task", "hooks": [{ "type": "command", "command": HOOK_CMD }] }]);
    // PreToolUse on every tool: a call from inside a subagent (agent_id set) proves it's still alive —
    // Claude fires SubagentStop at each turn end, and a background agent resumes after it when a message
    // was queued for it (no second SubagentStart).
    json!({ "hooks": {
        "PreToolUse": hook, "PostToolUse": agent_tool,
        "SubagentStart": hook, "SubagentStop": hook,
        "UserPromptSubmit": hook, "Stop": hook, "Notification": hook,
    }})
}

/// New hook events for a terminal, oldest first; consumed (deleted) on read.
#[tauri::command]
pub async fn agent_events(app: AppHandle, key: String) -> Result<Vec<Value>, String> {
    let dir = events_dir(&app, &key)?;
    tauri::async_runtime::spawn_blocking(move || read_events(&dir)).await.map_err(err)
}

#[tauri::command]
pub async fn agent_events_clear(app: AppHandle, key: String) -> Result<(), String> {
    let _ = tokio::fs::remove_dir_all(events_dir(&app, &key)?).await;
    Ok(())
}

/// Leftovers from a previous run (terminals are killed on quit).
pub fn clear_all(app: &AppHandle) {
    if let Ok(r) = root(app) {
        let _ = std::fs::remove_dir_all(r);
    }
}

fn read_events(dir: &Path) -> Vec<Value> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    files.sort(); // APFS mtimes have nanosecond resolution
    files
        .into_iter()
        .filter_map(|(_, p)| {
            let v = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice(&b).ok());
            let _ = std::fs::remove_file(&p);
            v
        })
        .collect()
}

// ---------- macOS notifications with click-to-focus ----------

/// Banners post as this app once LaunchServices knows the bundle id (a built .app exists, e.g. in
/// /Applications). Until then the crate poses as Terminal, as the notification plugin did in dev.
pub fn init_notifications(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = mac_notification_sys::set_application(&app.config().identifier);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
static WAITERS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// Last banner (title, body) per terminal key, so the next one can take it down.
#[cfg(target_os = "macos")]
static LAST: std::sync::Mutex<BTreeMap<String, (String, String)>> = std::sync::Mutex::new(BTreeMap::new());

/// Removes a delivered banner from Notification Center by its text. The crate ends a `wait_for_click`
/// once its banner is gone, so this also frees that parked waiter.
#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn remove_banner(title: &str, body: &str) {
    let center = objc2_foundation::NSUserNotificationCenter::defaultUserNotificationCenter();
    for n in center.deliveredNotifications().iter() {
        if n.title().is_some_and(|t| t.to_string() == title) && n.informativeText().is_some_and(|b| b.to_string() == body) {
            center.removeDeliveredNotification(&n);
        }
    }
}

/// Banner for an agent terminal. A click focuses the window and emits `notification-clicked` with the key.
/// A terminal's newer banner replaces its older one, so unclicked banners never pile up (or exhaust the waiters).
#[tauri::command]
pub async fn notify_agent(app: AppHandle, key: String, title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use mac_notification_sys::{Notification, NotificationResponse};
        use std::sync::atomic::Ordering;
        // ponytail: a waiter parks a thread until its banner is clicked or cleared; past 32, fire and forget.
        let wait = WAITERS.fetch_add(1, Ordering::SeqCst) < 32;
        let prev = LAST.lock().unwrap().insert(key.clone(), (title.clone(), body.clone()));
        let r = tauri::async_runtime::spawn_blocking(move || {
            if let Some((t, b)) = prev {
                remove_banner(&t, &b);
            }
            let r = Notification::new().title(&title).message(&body).wait_for_click(wait).send();
            WAITERS.fetch_sub(1, Ordering::SeqCst);
            r
        })
        .await
        .map_err(err)?
        .map_err(err)?;
        if matches!(r, NotificationResponse::Click) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            let _ = app.emit("notification-clicked", key);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, key, title, body);
    Ok(())
}

// ---------- token usage from the Claude Code transcript ----------

/// Tokens one model used in a session; the frontend prices them.
#[derive(serde::Serialize, Default)]
pub struct Usage {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_create: u64,
}

/// Sums the `usage` of a session's assistant messages, per model. The path comes from a hook payload
/// Claude wrote, but only transcripts under ~/.claude are readable here.
#[tauri::command]
pub async fn agent_usage(app: AppHandle, path: String) -> Result<Vec<Usage>, String> {
    let p = transcript_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || read_usage(&p)).await.map_err(err)?
}

/// Only transcripts under ~/.claude are readable here; the path comes from a hook payload Claude wrote.
fn transcript_path(app: &AppHandle, path: String) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(err)?;
    let p = PathBuf::from(path);
    if !p.starts_with(home.join(".claude")) || !p.extension().is_some_and(|x| x == "jsonl") {
        return Err("not a Claude transcript".into());
    }
    Ok(p)
}

#[derive(serde::Serialize)]
pub struct TranscriptTail {
    /// `user` and `assistant` lines only, trimmed to what the conversation view renders.
    pub lines: Vec<Value>,
    /// Byte offset after the last complete line; pass it back to read what came after.
    pub offset: u64,
}

/// The transcript's conversation lines from `offset` on (plan 016, phone conversation view). A trailing
/// partial line (still being written) is left for the next call.
#[tauri::command]
pub async fn agent_transcript(app: AppHandle, path: String, offset: u64) -> Result<TranscriptTail, String> {
    let p = transcript_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || read_tail(&p, offset)).await.map_err(err)?
}

/// Truncates every string inside a content value (blocks, nested results) to `max` chars.
fn cap_strings(v: &mut Value, max: usize) {
    match v {
        Value::String(s) if s.chars().count() > max => *s = s.chars().take(max).collect(),
        Value::Array(a) => a.iter_mut().for_each(|x| cap_strings(x, max)),
        Value::Object(o) => o.values_mut().for_each(|x| cap_strings(x, max)),
        _ => {}
    }
}

fn read_tail(path: &Path, mut offset: u64) -> Result<TranscriptTail, String> {
    use std::io::{BufRead, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).map_err(err)?;
    let len = f.metadata().map_err(err)?.len();
    if offset > len {
        offset = 0; // the file was replaced or truncated: start over
    }
    f.seek(SeekFrom::Start(offset)).map_err(err)?;
    let mut r = std::io::BufReader::new(f);
    let mut lines = Vec::new();
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = r.read_line(&mut buf).map_err(err)?;
        if n == 0 || !buf.ends_with('\n') {
            break;
        }
        offset += n as u64;
        if !(buf.contains("\"type\":\"user\"") || buf.contains("\"type\":\"assistant\"")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&buf) else { continue };
        let t = v["type"].as_str().unwrap_or("");
        if t != "user" && t != "assistant" {
            continue;
        }
        let mut content = v["message"]["content"].clone();
        cap_strings(&mut content, 4096); // the view keeps ~2 KB of a tool result; don't ship megabytes over IPC
        lines.push(json!({
            "type": t,
            "uuid": v["uuid"],
            "timestamp": v["timestamp"],
            "isMeta": v["isMeta"],
            "content": content,
        }));
    }
    Ok(TranscriptTail { lines, offset })
}

/// One transcript line per content block repeats the message's usage, so the last line per message id wins.
fn read_usage(path: &Path) -> Result<Vec<Usage>, String> {
    use std::io::BufRead;
    // ponytail: full re-read per turn (~1 MB); a byte-offset cache if it shows up in profiles.
    let f = std::fs::File::open(path).map_err(err)?;
    let mut by_id: HashMap<String, (String, Value)> = HashMap::new();
    for line in std::io::BufReader::new(f).lines().map_while(Result::ok) {
        if !line.contains("\"type\":\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let m = &v["message"];
        let (Some(id), Some(usage)) = (m["id"].as_str(), m.get("usage")) else { continue };
        by_id.insert(id.to_string(), (m["model"].as_str().unwrap_or("").to_string(), usage.clone()));
    }
    let mut out: BTreeMap<String, Usage> = BTreeMap::new();
    for (model, u) in by_id.into_values() {
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let e = out.entry(model.clone()).or_insert_with(|| Usage { model, ..Default::default() });
        e.input += n("input_tokens");
        e.output += n("output_tokens");
        e.cache_read += n("cache_read_input_tokens");
        e.cache_create += n("cache_creation_input_tokens");
    }
    Ok(out.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_dedupes_by_message_id_and_sums_per_model() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("s.jsonl");
        let a = |id: &str, model: &str, inp: u64, out: u64| {
            format!(
                r#"{{"type":"assistant","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{inp},"output_tokens":{out},"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}}}}}"#
            )
        };
        let lines = [
            r#"{"type":"user","message":{"role":"user"}}"#.to_string(),
            a("m1", "claude-opus-5-5", 2, 100), // two blocks of one message: counted once
            a("m1", "claude-opus-5-5", 2, 100),
            a("m2", "claude-opus-5-5", 3, 50),
            a("m3", "claude-haiku-4-5", 7, 1),
            "not json".to_string(),
        ];
        std::fs::write(&p, lines.join("\n")).unwrap();
        let rows = read_usage(&p).unwrap();
        assert_eq!(rows.len(), 2);
        let opus = rows.iter().find(|r| r.model == "claude-opus-5-5").unwrap();
        assert_eq!((opus.input, opus.output, opus.cache_read, opus.cache_create), (5, 150, 20, 10));
        let haiku = rows.iter().find(|r| r.model == "claude-haiku-4-5").unwrap();
        assert_eq!((haiku.input, haiku.output), (7, 1));
    }

    #[test]
    fn tail_returns_conversation_lines_and_leaves_a_partial_line() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("s.jsonl");
        let full = concat!(
            r#"{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"hi"}}"#, "\n",
            r#"{"type":"mode","mode":"x"}"#, "\n",
            r#"{"type":"assistant","uuid":"a1","timestamp":"t","message":{"content":[{"type":"text","text":"yo"}]}}"#, "\n",
            r#"{"type":"user","uuid":"u2","mess"#
        );
        std::fs::write(&p, full).unwrap();
        let t = read_tail(&p, 0).unwrap();
        assert_eq!(t.lines.len(), 2);
        let mut big = json!([{ "type": "tool_result", "content": "x".repeat(5000) }, "y"]);
        cap_strings(&mut big, 4096);
        assert_eq!(big[0]["content"].as_str().unwrap().len(), 4096);
        assert_eq!(big[1], "y");
        assert_eq!(t.lines[0]["uuid"], "u1");
        assert_eq!(t.lines[1]["content"][0]["text"], "yo");
        let partial = r#"{"type":"user","uuid":"u2","mess"#.len() as u64;
        assert_eq!(t.offset, full.len() as u64 - partial);
        // the rest of the line lands: picked up from the saved offset
        std::fs::write(&p, format!(r#"{full}age":{{"content":"more"}}}}"#) + "\n").unwrap();
        let t2 = read_tail(&p, t.offset).unwrap();
        assert_eq!(t2.lines.len(), 1);
        assert_eq!(t2.lines[0]["content"], "more");
    }

    #[test]
    fn hook_command_writes_complete_event_files() {
        let tmp = tempfile::tempdir().unwrap();
        let run = |payload: &str| {
            let mut child = std::process::Command::new("/bin/sh")
                .args(["-c", HOOK_CMD])
                .env("IDE_AGENT_EVENTS", tmp.path())
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            use std::io::Write;
            child.stdin.take().unwrap().write_all(payload.as_bytes()).unwrap();
            let out = child.wait_with_output().unwrap();
            assert!(out.status.success());
            assert!(out.stdout.is_empty(), "hook must print nothing");
        };
        run(r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"Explore"}"#);
        std::thread::sleep(std::time::Duration::from_millis(5));
        run(r#"{"hook_event_name":"SubagentStop","agent_id":"a1"}"#);
        let events = read_events(tmp.path());
        let names: Vec<_> = events.iter().map(|e| e["hook_event_name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["SubagentStart", "SubagentStop"]);
        assert!(read_events(tmp.path()).is_empty(), "events are consumed");
        // Unset env var: no file, still exit 0.
        let ok = std::process::Command::new("/bin/sh").args(["-c", HOOK_CMD]).env_remove("IDE_AGENT_EVENTS").status().unwrap();
        assert!(ok.success());
    }

    #[test]
    fn settings_register_agent_hooks() {
        let s = settings_json();
        for k in ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "UserPromptSubmit", "Stop", "Notification"] {
            assert!(s["hooks"][k][0]["hooks"][0]["command"].is_string(), "{k}");
        }
        assert!(s["hooks"]["PreToolUse"][0].get("matcher").is_none(), "every tool call: subagent liveness");
        assert_eq!(s["hooks"]["PostToolUse"][0]["matcher"], "Agent|Task");
    }
}

// ---------- per-agent setup (plan 004) ----------

/// Zero-touch setup for a launch: extra CLI args + env. Never edits the user's own config.
#[derive(serde::Serialize, Default)]
pub struct Setup {
    args: Vec<String>,
    env: std::collections::HashMap<String, String>,
}

/// Generated files live in app data; their paths are stable so repeat launches reuse them.
fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(name))
}

/// Merges `ours` into an existing system settings file (if any), appending hook arrays, so an
/// admin's system settings stay in effect when we point the CLI's system-settings env at our file.
fn merged_system_settings(existing: Option<&Path>, ours: Value) -> Value {
    let mut base: Value = existing
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let hooks = base.as_object_mut().unwrap().entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    for (ev, entries) in ours["hooks"].as_object().into_iter().flatten() {
        let slot = hooks.as_object_mut().unwrap().entry(ev.clone()).or_insert_with(|| json!([]));
        if let (Some(arr), Some(add)) = (slot.as_array_mut(), entries.as_array()) {
            arr.extend(add.iter().cloned());
        }
    }
    base
}

const OPENCODE_PLUGIN: &str = r#"// IDE subagent/status bridge for OpenCode (generated). Writes normalized events to $IDE_AGENT_EVENTS.
let main = null;
const kids = new Map();
async function emit(ide_event) {
  const dir = process.env.IDE_AGENT_EVENTS;
  if (!dir) return;
  const name = `${dir}/e.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await Bun.write(`${name}.tmp`, JSON.stringify({ ide_event }));
  const fs = await import("node:fs/promises");
  await fs.rename(`${name}.tmp`, `${name}.json`);
}
export const IdeEvents = async () => ({
  event: async ({ event }) => {
    try {
      const p = event.properties ?? {};
      if (event.type === "session.created") {
        const info = p.info ?? {};
        if (!info.parentID) { main ??= info.id; return; }
        kids.set(info.id, true);
        await emit({ kind: "sub_start", id: info.id, parent: info.parentID === main ? null : info.parentID, type: "subagent", description: info.title });
      } else if (event.type === "session.status") {
        const id = p.sessionID, busy = p.status?.type === "busy";
        if (id === main) await emit({ kind: busy ? "prompt" : "stop" });
        else if (kids.has(id) && !busy) { kids.delete(id); await emit({ kind: "sub_stop", id }); }
      } else if (event.type === "permission.v2.asked" || event.type === "permission.asked" || event.type === "permission.updated") {
        await emit({ kind: "waiting" });
      }
    } catch {}
  },
});
export default { server: IdeEvents };
"#;

#[tauri::command]
pub async fn agent_setup(app: AppHandle, agent: String, key: String) -> Result<Setup, String> {
    let dir = events_dir(&app, &key)?;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir).await.map_err(err)?;
    let mut s = Setup::default();
    s.env.insert("IDE_AGENT_EVENTS".into(), dir.to_string_lossy().into_owned());
    match agent.as_str() {
        "claude" => {
            let path = data_file(&app, "claude-hooks.json")?;
            std::fs::write(&path, serde_json::to_string_pretty(&settings_json()).map_err(err)?).map_err(err)?;
            s.args = vec!["--settings".into(), path.to_string_lossy().into_owned()];
        }
        // System-settings layer: hooks there CONCAT with the user's (verified in their settingsSchema).
        "qwen" | "gemini" => {
            let (env, default, events): (&str, &str, &[(&str, Option<&str>)]) = if agent == "qwen" {
                (
                    "QWEN_CODE_SYSTEM_SETTINGS_PATH",
                    "/Library/Application Support/QwenCode/settings.json",
                    &[("PreToolUse", Some("agent|Task")), ("SubagentStart", None), ("SubagentStop", None), ("UserPromptSubmit", None), ("Stop", None), ("Notification", None)],
                )
            } else {
                (
                    "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
                    "/Library/Application Support/GeminiCli/settings.json",
                    &[("BeforeAgent", None), ("AfterAgent", None), ("Notification", None)],
                )
            };
            let existing = std::env::var(env).ok().map(PathBuf::from).unwrap_or_else(|| PathBuf::from(default));
            let merged = merged_system_settings(existing.exists().then_some(existing.as_path()), json!({ "hooks": claude_style(events, false) }));
            let path = data_file(&app, &format!("{agent}-system-settings.json"))?;
            std::fs::write(&path, serde_json::to_string_pretty(&merged).map_err(err)?).map_err(err)?;
            s.env.insert(env.into(), path.to_string_lossy().into_owned());
        }
        // OPENCODE_CONFIG_CONTENT merges; plugin lists concatenate (verified in config.ts).
        "opencode" => {
            let path = data_file(&app, "ide-opencode-plugin.js")?;
            std::fs::write(&path, OPENCODE_PLUGIN).map_err(err)?;
            let url = format!("file://{}", path.to_string_lossy());
            s.env.insert("OPENCODE_CONFIG_CONTENT".into(), json!({ "plugin": [url] }).to_string());
        }
        _ => {} // repo-hook agents (opt-in) and heuristic-only agents: just the events dir
    }
    Ok(s)
}

// ---------- opt-in repo hook files ----------

/// (relative path, contents) of the hook file(s) for agents that only read hooks from the project.
fn repo_hook_files(agent: &str) -> Option<Vec<(&'static str, String)>> {
    let pretty = |v: Value| serde_json::to_string_pretty(&v).unwrap() + "\n";
    let tagged = |events: &[(&str, Option<&str>)]| claude_style(events, true);
    Some(match agent {
        "codex" => vec![(".codex/hooks.json", pretty(json!({ "hooks": tagged(&[
            ("SubagentStart", None), ("SubagentStop", None), ("UserPromptSubmit", None), ("Stop", None), ("PermissionRequest", None),
        ]) })))],
        "droid" => vec![(".factory/hooks.json", pretty(tagged(&[
            ("PreToolUse", Some("Task")), ("SubagentStop", None), ("UserPromptSubmit", None), ("Stop", None), ("Notification", None),
        ])))],
        "copilot" => {
            let h = |ev: &str, matcher: Option<&str>| {
                let mut e = json!({ "type": "command", "bash": tagged_cmd(ev) });
                if let Some(m) = matcher {
                    e["matcher"] = json!(m);
                }
                json!([e])
            };
            vec![(".github/hooks/ide-agent-events.json", pretty(json!({ "version": 1, "hooks": {
                "subagentStart": h("subagentStart", None), "subagentStop": h("subagentStop", None),
                "userPromptSubmitted": h("userPromptSubmitted", None), "agentStop": h("agentStop", None),
                "permissionRequest": h("permissionRequest", None),
            }})))]
        }
        // Observational events only: Cursor treats empty output from permission-type hooks as a block.
        "cursor" => {
            let h = |ev: &str| json!([{ "type": "command", "command": tagged_cmd(ev) }]);
            vec![(".cursor/hooks.json", pretty(json!({ "version": 1, "hooks": {
                "subagentStart": h("subagentStart"), "subagentStop": h("subagentStop"), "stop": h("stop"),
            }})))]
        }
        "goose" => vec![
            (".agents/plugins/ide-agent-events/plugin.json", pretty(json!({ "name": "ide-agent-events", "version": "0.1.0", "description": "IDE agent status events" }))),
            (".agents/plugins/ide-agent-events/hooks/hooks.json", pretty(json!({ "hooks": tagged(&[("UserPromptSubmit", None), ("Stop", None)]) }))),
        ],
        _ => return None,
    })
}

async fn repo_root(cwd: &str) -> PathBuf {
    match crate::git::run(cwd, &["rev-parse", "--show-toplevel"]).await {
        Ok(top) => PathBuf::from(top.trim()),
        Err(_) => PathBuf::from(cwd),
    }
}

/// Adds/removes `line` in the repo's local exclude file (never committed). No-op outside git.
async fn set_excluded(root: &Path, line: &str, on: bool) {
    let Ok(p) = crate::git::run(&root.to_string_lossy(), &["rev-parse", "--git-path", "info/exclude"]).await else { return };
    let path = root.join(p.trim());
    let text = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let has = text.lines().any(|l| l.trim() == line);
    let next = if on && !has {
        format!("{}{}{}\n", text, if text.is_empty() || text.ends_with('\n') { "" } else { "\n" }, line)
    } else if !on && has {
        text.lines().filter(|l| l.trim() != line).map(|l| format!("{l}\n")).collect()
    } else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = tokio::fs::create_dir_all(dir).await;
    }
    let _ = tokio::fs::write(&path, next).await;
}

/// Opt-in project hook files. Enabling creates them only when absent (an existing file is never
/// edited) and git-excludes them locally; disabling removes only files still identical to ours.
/// Returns "on" | "exists" (a foreign file is in the way) | "off" | "unsupported".
#[tauri::command]
pub async fn agent_repo_hooks(agent: String, cwd: String, enable: bool) -> Result<String, String> {
    let Some(files) = repo_hook_files(&agent) else { return Ok("unsupported".into()) };
    let root = repo_root(&cwd).await;
    for (rel, content) in &files {
        let path = root.join(rel);
        let current = tokio::fs::read_to_string(&path).await.ok();
        if enable {
            match current {
                Some(c) if &c == content => {}
                Some(_) => return Ok("exists".into()),
                None => {
                    tokio::fs::create_dir_all(path.parent().unwrap()).await.map_err(err)?;
                    tokio::fs::write(&path, content).await.map_err(err)?;
                }
            }
        } else if current.as_deref() == Some(content.as_str()) {
            tokio::fs::remove_file(&path).await.map_err(err)?;
            // Remove now-empty dirs we created (e.g. .codex/), never the repo root.
            let mut dir = path.parent().map(Path::to_path_buf);
            while let Some(d) = dir {
                if d == root || tokio::fs::remove_dir(&d).await.is_err() {
                    break;
                }
                dir = d.parent().map(Path::to_path_buf);
            }
        }
        set_excluded(&root, rel, enable).await;
    }
    Ok(if enable { "on" } else { "off" }.into())
}

#[cfg(test)]
mod setup_tests {
    use super::*;

    #[test]
    fn tagged_command_wraps_payload_as_json() {
        let tmp = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", &tagged_cmd("subagentStart")])
            .env("IDE_AGENT_EVENTS", tmp.path())
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child.stdin.take().unwrap().write_all(br#"{"agentName":"reviewer"}"#).unwrap();
        assert!(child.wait().unwrap().success());
        let ev = &read_events(tmp.path())[0];
        assert_eq!(ev["ide_hook"], "subagentStart");
        assert_eq!(ev["payload"]["agentName"], "reviewer");
    }

    #[test]
    fn system_settings_merge_keeps_existing_and_appends_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        let admin = tmp.path().join("settings.json");
        std::fs::write(&admin, r#"{"telemetry":false,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"admin"}]}]}}"#).unwrap();
        let merged = merged_system_settings(Some(&admin), json!({ "hooks": claude_style(&[("Stop", None), ("BeforeAgent", None)], false) }));
        assert_eq!(merged["telemetry"], false);
        assert_eq!(merged["hooks"]["Stop"].as_array().unwrap().len(), 2, "admin hook kept, ours appended");
        assert!(merged["hooks"]["BeforeAgent"].is_array());
    }

    #[tokio::test]
    async fn repo_hooks_never_overwrite_and_clean_up() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        assert!(std::process::Command::new("git").args(["init", "-q"]).current_dir(&root).status().unwrap().success());
        let r = root.to_string_lossy().to_string();
        assert_eq!(agent_repo_hooks("codex".into(), r.clone(), true).await.unwrap(), "on");
        assert!(root.join(".codex/hooks.json").exists());
        let exclude = std::fs::read_to_string(root.join(".git/info/exclude")).unwrap();
        assert!(exclude.lines().any(|l| l == ".codex/hooks.json"));
        // idempotent, single exclude line
        agent_repo_hooks("codex".into(), r.clone(), true).await.unwrap();
        assert_eq!(std::fs::read_to_string(root.join(".git/info/exclude")).unwrap().matches(".codex/hooks.json").count(), 1);
        // disabling removes our file, its empty dir, and the exclude line
        assert_eq!(agent_repo_hooks("codex".into(), r.clone(), false).await.unwrap(), "off");
        assert!(!root.join(".codex").exists());
        assert!(!std::fs::read_to_string(root.join(".git/info/exclude")).unwrap().contains(".codex/hooks.json"));
        // a foreign file is never touched
        std::fs::create_dir_all(root.join(".cursor")).unwrap();
        std::fs::write(root.join(".cursor/hooks.json"), "{\"team\":true}").unwrap();
        assert_eq!(agent_repo_hooks("cursor".into(), r.clone(), true).await.unwrap(), "exists");
        assert_eq!(agent_repo_hooks("cursor".into(), r.clone(), false).await.unwrap(), "off");
        assert_eq!(std::fs::read_to_string(root.join(".cursor/hooks.json")).unwrap(), "{\"team\":true}");
        assert_eq!(agent_repo_hooks("aider".into(), r, true).await.unwrap(), "unsupported");
    }
}
