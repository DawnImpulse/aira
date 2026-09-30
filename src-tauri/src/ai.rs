//! AI commit messages via cloud APIs, local OpenAI-compatible servers, or installed agent CLIs.
//! API keys live in the macOS Keychain and never reach the webview. Only official endpoints,
//! header auth, and each CLI's documented non-interactive mode are used.

use crate::{env, git};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const SERVICE: &str = "com.codevry.ide";
const MAX_DIFF: usize = 60_000;
const SYSTEM: &str = "You write git commit messages. Reply with the commit message only: \
a concise imperative subject line (max 72 chars), then optionally a blank line and a short \
body (bullets) explaining what and why for non-trivial changes. Follow the style of the recent \
commits (e.g. conventional-commit prefixes if they use them). No code fences, no quotes, no preamble.";

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiCfg {
    /// "anthropic" | "openai" (any OpenAI-compatible endpoint) | "cli"
    kind: String,
    base_url: Option<String>,
    /// Keychain entry name; None = keyless (local servers, CLIs).
    key_id: Option<String>,
    #[serde(default)]
    model: String,
    /// claude | codex | gemini | opencode
    cli: Option<String>,
    /// Human name for error messages.
    label: String,
}

fn entry(key_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = entry(&provider)?;
        match key.trim() {
            "" => match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(err) => Err(err.to_string()),
            },
            k => e.set_password(k).map_err(|e| e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn key_for(cfg: &AiCfg) -> Result<Option<String>, String> {
    let Some(id) = cfg.key_id.clone() else { return Ok(None) };
    let label = cfg.label.clone();
    tauri::async_runtime::spawn_blocking(move || {
        entry(&id)?.get_password().map(Some).map_err(|_| format!("No API key saved for {label}. Add one in Settings."))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("IDE/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(120))
        .build()
        .expect("http client")
}

fn base(cfg: &AiCfg, default: &str) -> String {
    cfg.base_url.clone().filter(|b| !b.trim().is_empty()).unwrap_or_else(|| default.into()).trim_end_matches('/').to_string()
}

/// OpenRouter's optional app attribution (`X-OpenRouter-Title`; `X-Title` is its legacy name).
/// No `HTTP-Referer`: we have no public app URL and must not send a made-up one.
fn with_attribution(req: reqwest::RequestBuilder, base: &str) -> reqwest::RequestBuilder {
    if base.contains("openrouter.ai") {
        req.header("X-OpenRouter-Title", "IDE")
    } else {
        req
    }
}

async fn read_json(resp: reqwest::Response, label: &str) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    // Surface the provider's own message (rate limits, quota, bad model) without retrying.
    let msg = body["error"]["message"].as_str().or(body["error"].as_str()).map(String::from).unwrap_or(text);
    Err(format!("{label} {status}: {}", msg.chars().take(400).collect::<String>()))
}

async fn chat(cfg: &AiCfg, key: Option<&str>, prompt: &str) -> Result<String, String> {
    let http = client();
    let (req, pick): (_, fn(&Value) -> Option<&str>) = match cfg.kind.as_str() {
        "anthropic" => {
            let b = base(cfg, "https://api.anthropic.com");
            (
                http.post(format!("{b}/v1/messages"))
                    .header("x-api-key", key.ok_or("Missing API key")?)
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": cfg.model, "max_tokens": 600, "system": SYSTEM,
                        "messages": [{ "role": "user", "content": prompt }],
                    })),
                |v| v["content"][0]["text"].as_str(),
            )
        }
        "openai" => {
            let b = base(cfg, "https://api.openai.com/v1");
            let mut req = http.post(format!("{b}/chat/completions")).json(&json!({
                "model": cfg.model,
                "messages": [{ "role": "system", "content": SYSTEM }, { "role": "user", "content": prompt }],
            }));
            if let Some(k) = key {
                req = req.bearer_auth(k);
            }
            (with_attribution(req, &b), |v| v["choices"][0]["message"]["content"].as_str())
        }
        other => return Err(format!("Unknown provider kind {other}")),
    };
    let resp = req.send().await.map_err(|e| format!("{}: {e}", cfg.label))?;
    let body = read_json(resp, &cfg.label).await?;
    pick(&body).map(clean).filter(|s| !s.is_empty()).ok_or_else(|| "Empty response from model".into())
}

fn clean(s: &str) -> String {
    s.trim().trim_matches('`').trim().to_string()
}

/// Removes ANSI escape sequences some CLIs print even when not on a TTY.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Runs an agent CLI in its documented non-interactive mode. We only invoke the tool the way a
/// user would; its own login/session is never read.
async fn run_cli(cli: &str, model: &str, repo: &str, context: &str, envs: &HashMap<String, String>) -> Result<String, String> {
    let instruction = format!("{SYSTEM} The repository context and diff are provided as input.");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let out_file = std::env::temp_dir().join(format!("ide-codex-{}-{nanos}.txt", std::process::id()));
    let with_model = |mut a: Vec<String>, flag: &str| {
        if !model.trim().is_empty() {
            a.extend([flag.to_string(), model.trim().to_string()]);
        }
        a
    };
    // (binary, args, context via stdin?)
    let (bin, args, stdin): (&str, Vec<String>, bool) = match cli {
        "claude" => ("claude", with_model(vec!["-p".into(), instruction], "--model"), true),
        "codex" => (
            "codex",
            with_model(
                vec!["exec".into(), "--ephemeral".into(), "--skip-git-repo-check".into(), "-o".into(), out_file.to_string_lossy().into(), instruction],
                "-m",
            ),
            true,
        ),
        "gemini" => ("gemini", with_model(vec!["-p".into(), instruction, "--approval-mode".into(), "plan".into()], "-m"), true),
        "opencode" => ("opencode", with_model(vec!["run".into(), format!("{instruction}\n\n{context}")], "-m"), false),
        other => return Err(format!("Unsupported CLI {other}")),
    };
    let mut child = Command::new(bin)
        .args(&args)
        .current_dir(repo)
        .env_clear()
        .envs(envs)
        .stdin(if stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Could not start `{bin}`: {e}"))?;
    if let Some(mut w) = child.stdin.take() {
        w.write_all(context.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .map_err(|_| format!("`{bin}` timed out after 120s"))?
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = strip_ansi(&String::from_utf8_lossy(&out.stderr));
        return Err(format!("`{bin}` failed: {}", err.trim().chars().take(400).collect::<String>()));
    }
    let text = if cli == "codex" {
        let t = tokio::fs::read_to_string(&out_file).await.unwrap_or_default();
        let _ = tokio::fs::remove_file(&out_file).await;
        t
    } else {
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    Some(clean(&strip_ansi(&text))).filter(|s| !s.is_empty()).ok_or_else(|| format!("`{bin}` returned nothing"))
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

async fn commit_context(repo: &str, excludes: &[String]) -> Result<String, String> {
    let mut spec = vec!["--".to_string(), ".".to_string()];
    spec.extend(excludes.iter().map(|e| format!(":(exclude){e}")));
    let diff_args = |extra: &[&str]| {
        let mut a: Vec<String> = vec!["diff".into()];
        a.extend(extra.iter().map(|s| s.to_string()));
        a.extend(spec.iter().cloned());
        a
    };
    let run = |args: Vec<String>| async move { git::run(repo, &args.iter().map(String::as_str).collect::<Vec<_>>()).await };
    // Staged changes if any, otherwise everything (what "commit all" would commit).
    let mut stat = run(diff_args(&["--cached", "--stat"])).await?;
    let mut diff = run(diff_args(&["--cached"])).await?;
    if diff.trim().is_empty() {
        // `diff HEAD` fails on an unborn branch; fall back to worktree-vs-index.
        stat = match run(diff_args(&["HEAD", "--stat"])).await {
            Ok(s) => s,
            Err(_) => run(diff_args(&["--stat"])).await?,
        };
        diff = match run(diff_args(&["HEAD"])).await {
            Ok(s) => s,
            Err(_) => run(diff_args(&[])).await?,
        };
        let untracked = run(vec!["ls-files".into(), "--others".into(), "--exclude-standard".into()]).await?;
        if !untracked.trim().is_empty() {
            stat.push_str(&format!("\nNew untracked files:\n{untracked}"));
        }
    }
    if diff.trim().is_empty() && stat.trim().is_empty() {
        return Err("No changes to describe".into());
    }
    let log = run(vec!["log".into(), "-n".into(), "10".into(), "--pretty=format:%s".into()]).await.unwrap_or_default();
    Ok(format!(
        "Recent commit subjects (style reference):\n{log}\n\nDiff stat:\n{stat}\n\nDiff{}:\n{}",
        if diff.len() > MAX_DIFF { " (truncated)" } else { "" },
        truncate(&diff, MAX_DIFF)
    ))
}

/// Sends the repo's diff to the configured provider. Only called on an explicit Generate click.
#[tauri::command]
pub async fn ai_commit_message(repo: String, excludes: Vec<String>, cfg: AiCfg) -> Result<String, String> {
    let context = commit_context(&repo, &excludes).await?;
    if cfg.kind == "cli" {
        return run_cli(cfg.cli.as_deref().unwrap_or_default(), &cfg.model, &repo, &context, env::get()).await;
    }
    if cfg.model.trim().is_empty() {
        return Err(format!("Pick a model for {} in Settings.", cfg.label));
    }
    let key = key_for(&cfg).await?;
    chat(&cfg, key.as_deref(), &context).await
}

/// Model ids from the provider's official list endpoint.
#[tauri::command]
pub async fn ai_list_models(cfg: AiCfg) -> Result<Vec<String>, String> {
    let key = key_for(&cfg).await?;
    let http = client();
    let req = match cfg.kind.as_str() {
        "anthropic" => http
            .get(format!("{}/v1/models?limit=1000", base(&cfg, "https://api.anthropic.com")))
            .header("x-api-key", key.as_deref().ok_or("Missing API key")?)
            .header("anthropic-version", "2023-06-01"),
        "openai" => {
            let b = base(&cfg, "https://api.openai.com/v1");
            let req = http.get(format!("{b}/models"));
            let req = match &key {
                Some(k) => req.bearer_auth(k),
                None => req,
            };
            with_attribution(req, &b)
        }
        _ => return Ok(vec![]),
    };
    let resp = req.send().await.map_err(|e| format!("{}: {e}", cfg.label))?;
    let body = read_json(resp, &cfg.label).await?;
    let mut ids: Vec<String> = body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect();
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// One-shot HTTP server: returns the raw request it received.
    fn mock_server(reply: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 65536];
            let mut req = String::new();
            // Read until the JSON body is complete (headers + Content-Length).
            loop {
                let n = s.read(&mut buf).unwrap();
                req.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Some((head, body)) = req.split_once("\r\n\r\n") {
                    let len = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if body.len() >= len {
                        break;
                    }
                }
            }
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{reply}", reply.len());
            s.write_all(resp.as_bytes()).unwrap();
            req
        });
        (url, h)
    }

    fn cfg(kind: &str, base_url: Option<String>) -> AiCfg {
        AiCfg { kind: kind.into(), base_url, key_id: None, model: "m1".into(), cli: None, label: "Test".into() }
    }

    #[tokio::test]
    async fn openai_compatible_request_and_parse() {
        let (url, h) = mock_server(r#"{"choices":[{"message":{"content":"```feat: add x```"}}]}"#);
        let out = chat(&cfg("openai", Some(format!("{url}/v1/"))), Some("sk-test"), "the diff").await.unwrap();
        assert_eq!(out, "feat: add x");
        let req = h.join().unwrap();
        assert!(req.starts_with("POST /v1/chat/completions "), "{req}");
        assert!(req.to_ascii_lowercase().contains("authorization: bearer sk-test"));
        assert!(req.contains(r#""model":"m1""#) && req.contains("the diff"));
        assert!(req.to_ascii_lowercase().contains("user-agent: ide/"));
    }

    #[tokio::test]
    async fn keyless_local_and_model_list() {
        let (url, h) = mock_server(r#"{"data":[{"id":"qwen3"},{"id":"llama3"}]}"#);
        let ids = ai_list_models(cfg("openai", Some(format!("{url}/v1")))).await.unwrap();
        assert_eq!(ids, vec!["llama3", "qwen3"]);
        let req = h.join().unwrap();
        assert!(req.starts_with("GET /v1/models "));
        assert!(!req.to_ascii_lowercase().contains("authorization"), "no key must mean no auth header");
    }

    #[tokio::test]
    async fn anthropic_error_is_surfaced() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let _ = s.read(&mut buf);
            let body = r#"{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}"#;
            let _ = s.write_all(format!("HTTP/1.1 429 Too Many Requests\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
        });
        let err = chat(&cfg("anthropic", Some(url)), Some("k"), "d").await.unwrap_err();
        assert!(err.contains("429") && err.contains("slow down"), "{err}");
    }

    #[tokio::test]
    async fn cli_gets_context_on_stdin() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        // Echo "-p" check + stdin back, with ANSI noise to strip.
        std::fs::write(&fake, "#!/bin/sh\n[ \"$1\" = \"-p\" ] || exit 9\nprintf '\\033[1mfix: '; cat; printf '\\033[0m\\n'\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let envs = HashMap::from([("PATH".to_string(), format!("{}:/usr/bin:/bin", dir.path().display()))]);
        let out = run_cli("claude", "", dir.path().to_str().unwrap(), "the diff", &envs).await.unwrap();
        assert_eq!(out, "fix: the diff");
        assert!(run_cli("nope", "", "/", "", &envs).await.is_err());
    }
}
