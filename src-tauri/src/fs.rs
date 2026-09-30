//! Files, config persistence, file watching, runner detection.
//! ponytail: no project-root guard on fs commands — `pty_spawn` already gives the
//! webview arbitrary exec, so the real boundary is CSP + never rendering raw HTML.

use crate::{env, git::SKIP_DIRS};
use notify_debouncer_full::notify::{Config, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, NoCache};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    dir: bool,
}

#[tauri::command]
pub async fn read_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut rd = tokio::fs::read_dir(&path).await.map_err(err)?;
    let mut out = Vec::new();
    while let Some(e) = rd.next_entry().await.map_err(err)? {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" || name == ".DS_Store" {
            continue;
        }
        // metadata() follows symlinks, so a symlinked dir shows as a dir
        let dir = tokio::fs::metadata(e.path()).await.is_ok_and(|m| m.is_dir());
        out.push(Entry { name, path: e.path().to_string_lossy().into_owned(), dir });
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Text only: refuses binary / non-UTF-8 so saving can never corrupt a file.
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(err)?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("File too large to open (>10MB)".into());
    }
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return Err("binary".into());
    }
    String::from_utf8(bytes).map_err(|_| "binary".into())
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(tokio::fs::read(&path).await.map_err(err)?))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content).await.map_err(err)
}

/// New empty file or directory; fails if the path already exists (never overwrites).
#[tauri::command]
pub async fn create_path(path: String, dir: bool) -> Result<(), String> {
    if dir {
        tokio::fs::create_dir(&path).await.map_err(err)
    } else {
        tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map(drop).map_err(err)
    }
}

/// Clipboard write from native-menu actions (the web clipboard API needs a user gesture there).
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    // ponytail: macOS pbcopy; Windows port would use `clip` or the clipboard plugin.
    let mut child = tokio::process::Command::new("pbcopy").stdin(std::process::Stdio::piped()).spawn().map_err(err)?;
    child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).await.map_err(err)?;
    child.wait().await.map_err(err).map(drop)
}

// ---------- config ----------

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("config.json"))
}

#[tauri::command]
pub async fn load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    let Ok(text) = tokio::fs::read_to_string(&path).await else { return Ok(None) };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(Some(v)),
        Err(_) => {
            // Keep the broken file instead of silently overwriting it with defaults.
            let _ = tokio::fs::rename(&path, path.with_extension("corrupt.json")).await;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn save_config(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app)?;
    tokio::fs::create_dir_all(path.parent().unwrap()).await.map_err(err)?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&config).map_err(err)?;
    tokio::fs::write(&tmp, text).await.map_err(err)?;
    tokio::fs::rename(&tmp, &path).await.map_err(err)
}

// ---------- runners ----------

/// Which of `names` are executables on the login-shell PATH.
#[tauri::command]
pub async fn which(names: Vec<String>) -> Vec<String> {
    use std::os::unix::fs::PermissionsExt;
    let path = env::get().get("PATH").cloned().unwrap_or_default();
    names
        .into_iter()
        .filter(|n| {
            std::env::split_paths(&path).any(|dir| {
                std::fs::metadata(dir.join(n)).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            })
        })
        .collect()
}

// ---------- watcher ----------

type Watcher = Debouncer<RecommendedWatcher, NoCache>;

#[derive(Default)]
pub struct Watch(Mutex<Option<(Watcher, HashSet<String>)>>);

/// Drops build-output noise; inside `.git/` only keeps what changes status/branches.
fn relevant(p: &Path) -> bool {
    let s = p.to_string_lossy();
    if let Some(i) = s.find("/.git/") {
        let mut rest = &s[i + 6..];
        if let Some(wt) = rest.strip_prefix("worktrees/") {
            rest = wt.split_once('/').map_or("", |(_, r)| r);
        }
        return !rest.ends_with(".lock")
            && (rest == "HEAD" || rest == "index" || rest == "packed-refs" || rest.starts_with("refs/"));
    }
    !p.components().any(|c| SKIP_DIRS.contains(&c.as_os_str().to_string_lossy().as_ref()))
}

/// Replaces the watched set (project roots + worktrees outside them).
#[tauri::command]
pub fn watch_set(app: AppHandle, state: State<Watch>, paths: Vec<String>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() {
        // NoCache: the default file-id cache walks every file (node_modules included) on watch().
        let debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
            Duration::from_millis(300),
            None,
            move |res: DebounceEventResult| {
                let Ok(events) = res else { return };
                let mut paths: Vec<String> = events
                    .iter()
                    .flat_map(|e| e.paths.iter())
                    .filter(|p| relevant(p))
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                paths.sort();
                paths.dedup();
                if !paths.is_empty() {
                    let _ = app.emit("fs-changed", paths);
                }
            },
            NoCache::new(),
            Config::default(),
        )
        .map_err(err)?;
        *guard = Some((debouncer, HashSet::new()));
    }
    let (debouncer, watched) = guard.as_mut().unwrap();
    let want: HashSet<String> = paths.into_iter().collect();
    for p in watched.difference(&want) {
        let _ = debouncer.unwatch(p);
    }
    for p in want.difference(watched) {
        let _ = debouncer.watch(p, RecursiveMode::Recursive);
    }
    *watched = want;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_path_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.txt").to_string_lossy().to_string();
        let d = tmp.path().join("sub").to_string_lossy().to_string();
        create_path(f.clone(), false).await.unwrap();
        std::fs::write(&f, "keep").unwrap();
        assert!(create_path(f.clone(), false).await.is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "keep");
        create_path(d.clone(), true).await.unwrap();
        assert!(std::path::Path::new(&d).is_dir());
        assert!(create_path(d, true).await.is_err());
    }

    #[test]
    fn filters_watch_events() {
        let yes = ["/p/src/a.ts", "/p/.git/HEAD", "/p/.git/index", "/p/.git/refs/heads/x", "/p/.git/worktrees/wt/HEAD"];
        let no = ["/p/node_modules/x/a.js", "/p/.git/index.lock", "/p/.git/objects/ab/cd", "/p/target/debug/x", "/p/.git/worktrees/wt/index.lock"];
        for p in yes {
            assert!(relevant(Path::new(p)), "{p}");
        }
        for p in no {
            assert!(!relevant(Path::new(p)), "{p}");
        }
    }
}
