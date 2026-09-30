//! Git via the `git` CLI (reuses the user's SSH keys, credential helpers, hooks).
//! `--no-optional-locks` keeps `status` from touching `.git/index`, which would
//! otherwise wake the file watcher and loop refreshes forever.

use crate::env;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use walkdir::WalkDir;

async fn run_raw(repo: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .arg("--no-optional-locks")
        .args(args)
        .env_clear()
        .envs(env::get())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("git: {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let msg = String::from_utf8_lossy(if out.stderr.is_empty() { &out.stdout } else { &out.stderr });
        Err(msg.trim().to_string())
    }
}

pub async fn run(repo: &str, args: &[&str]) -> Result<String, String> {
    run_raw(repo, args).await.map(|b| String::from_utf8_lossy(&b).into_owned())
}

// ---------- discovery ----------

#[derive(Serialize, Debug, PartialEq)]
pub struct Repo {
    path: String,
    kind: &'static str, // primary | nested | worktree
    parent: Option<String>,
}

pub const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv", "venv", ".next", ".turbo",
    ".cache", "vendor", "Pods", "DerivedData", ".gradle", "__pycache__",
];

/// Directories under `root` (depth ≤ 4) containing a `.git` dir or file. Ignores
/// .gitignore on purpose: inner repos are usually ignored by the outer one.
fn find_repos(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            e.file_type().is_dir() && !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .filter_map(Result::ok)
        .filter(|e| e.path().join(".git").exists())
        .map(|e| e.into_path())
        .collect()
}

fn parse_worktrees(out: &str) -> Vec<String> {
    out.split("\n\n")
        .filter(|block| !block.lines().any(|l| l == "bare" || l.starts_with("prunable")))
        .filter_map(|block| block.lines().find_map(|l| l.strip_prefix("worktree ")))
        .map(String::from)
        .collect()
}

#[tauri::command]
pub async fn git_discover(root: String, extra: Vec<String>) -> Result<Vec<Repo>, String> {
    let root_path = PathBuf::from(&root);
    let mut found = tauri::async_runtime::spawn_blocking(move || find_repos(&root_path))
        .await
        .map_err(|e| e.to_string())?;
    if !found.iter().any(|p| p == Path::new(&root)) {
        // Opened a subfolder of a repo: use the enclosing repo as primary.
        if let Ok(top) = run(&root, &["rev-parse", "--show-toplevel"]).await {
            found.insert(0, PathBuf::from(top.trim()));
        }
    }
    found.extend(extra.iter().map(PathBuf::from).filter(|p| p.join(".git").exists()));

    let mut repos: Vec<Repo> = Vec::new();
    for p in found {
        let path = p.to_string_lossy().into_owned();
        if repos.iter().any(|r| r.path == path) {
            continue;
        }
        let kind = if repos.is_empty() && (path == root || Path::new(&root).starts_with(&path)) {
            "primary"
        } else {
            "nested"
        };
        repos.push(Repo { path, kind, parent: None });
    }
    // Linked worktrees of every non-worktree repo (they may live outside the root).
    let mains: Vec<String> = repos.iter().map(|r| r.path.clone()).collect();
    for main in mains {
        let Ok(out) = run(&main, &["worktree", "list", "--porcelain"]).await else { continue };
        for wt in parse_worktrees(&out).into_iter().skip(1) {
            match repos.iter_mut().find(|r| r.path == wt) {
                Some(r) => {
                    r.kind = "worktree";
                    r.parent = Some(main.clone());
                }
                None => repos.push(Repo { path: wt, kind: "worktree", parent: Some(main.clone()) }),
            }
        }
    }
    Ok(repos)
}

// ---------- status ----------

#[derive(Serialize, Default, Debug)]
pub struct Status {
    branch: Option<String>, // None when detached
    oid: Option<String>,    // None on an unborn branch
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<FileEntry>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct FileEntry {
    path: String,
    orig: Option<String>,
    x: char, // index status: '.', M, A, D, R, C, T, U, '?'
    y: char, // worktree status
    conflict: bool,
}

fn parse_status(out: &str) -> Status {
    let mut st = Status::default();
    let mut tokens = out.split('\0').filter(|t| !t.is_empty());
    let xy = |s: &str| {
        let mut c = s.chars();
        (c.next().unwrap_or('.'), c.next().unwrap_or('.'))
    };
    while let Some(t) = tokens.next() {
        if let Some(h) = t.strip_prefix("# ") {
            let (key, val) = h.split_once(' ').unwrap_or((h, ""));
            match key {
                "branch.oid" if val != "(initial)" => st.oid = Some(val.into()),
                "branch.head" if val != "(detached)" => st.branch = Some(val.into()),
                "branch.upstream" => st.upstream = Some(val.into()),
                "branch.ab" => {
                    for part in val.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            st.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let entry = match t.as_bytes()[0] {
            b'1' => t.splitn(9, ' ').collect::<Vec<_>>().try_into().ok().map(|f: [&str; 9]| {
                let (x, y) = xy(f[1]);
                FileEntry { path: f[8].into(), orig: None, x, y, conflict: false }
            }),
            b'2' => t.splitn(10, ' ').collect::<Vec<_>>().try_into().ok().map(|f: [&str; 10]| {
                let (x, y) = xy(f[1]);
                FileEntry { path: f[9].into(), orig: tokens.next().map(Into::into), x, y, conflict: false }
            }),
            b'u' => t.splitn(11, ' ').collect::<Vec<_>>().try_into().ok().map(|f: [&str; 11]| {
                let (x, y) = xy(f[1]);
                FileEntry { path: f[10].into(), orig: None, x, y, conflict: true }
            }),
            b'?' => Some(FileEntry { path: t[2..].into(), orig: None, x: '?', y: '?', conflict: false }),
            _ => None,
        };
        st.files.extend(entry);
    }
    st
}

fn pathspec(excludes: &[String]) -> Vec<String> {
    let mut v = vec!["--".to_string(), ".".to_string()];
    v.extend(excludes.iter().map(|e| format!(":(exclude){e}")));
    v
}

/// `excludes`: repo-relative paths of nested repos, hidden from this repo's view.
#[tauri::command]
pub async fn git_status(repo: String, excludes: Vec<String>) -> Result<Status, String> {
    let mut args = vec!["status", "--porcelain=v2", "--branch", "-z"];
    let spec = pathspec(&excludes);
    args.extend(spec.iter().map(String::as_str));
    Ok(parse_status(&run(&repo, &args).await?))
}

#[derive(Serialize)]
pub struct FileVersions {
    original: String,
    modified: String,
    binary: bool,
}

/// Both sides for Monaco's diff editor: HEAD→index when `staged`, else index→worktree.
#[tauri::command]
pub async fn git_file_versions(
    repo: String,
    path: String,
    orig: Option<String>,
    staged: bool,
) -> Result<FileVersions, String> {
    let head_path = format!("HEAD:{}", orig.as_deref().unwrap_or(&path));
    let index_path = format!(":{path}");
    let show = |spec: String| {
        let repo = repo.clone();
        async move { run_raw(&repo, &["show", &spec]).await.unwrap_or_default() }
    };
    let (original, modified) = if staged {
        (show(head_path).await, show(index_path).await)
    } else {
        let mut original = run_raw(&repo, &["show", &index_path]).await.unwrap_or_default();
        if original.is_empty() {
            original = show(head_path).await; // rename source / intent-to-add
        }
        (original, tokio::fs::read(Path::new(&repo).join(&path)).await.unwrap_or_default())
    };
    let is_bin = |b: &[u8]| b[..b.len().min(8000)].contains(&0);
    Ok(FileVersions {
        binary: is_bin(&original) || is_bin(&modified),
        original: String::from_utf8_lossy(&original).into_owned(),
        modified: String::from_utf8_lossy(&modified).into_owned(),
    })
}

// ---------- index / commit ----------

#[tauri::command]
pub async fn git_stage(repo: String, paths: Vec<String>, excludes: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add".to_string(), "-A".to_string()];
    if paths.is_empty() {
        args.extend(pathspec(&excludes)); // stage all, but never nested repos as gitlinks
    } else {
        args.push("--".into());
        args.extend(paths);
    }
    run(&repo, &args.iter().map(String::as_str).collect::<Vec<_>>()).await.map(drop)
}

#[tauri::command]
pub async fn git_unstage(repo: String, paths: Vec<String>) -> Result<(), String> {
    let paths = if paths.is_empty() { vec![".".to_string()] } else { paths };
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    if run(&repo, &args).await.is_ok() {
        return Ok(());
    }
    // Unborn branch: there is no HEAD to restore from.
    let mut args = vec!["rm", "--cached", "-r", "-q", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(&repo, &args).await.map(drop)
}

#[tauri::command]
pub async fn git_discard(repo: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--worktree", "--"];
        args.extend(tracked.iter().map(String::as_str));
        run(&repo, &args).await?;
    }
    if !untracked.is_empty() {
        let mut args = vec!["clean", "-fd", "--"];
        args.extend(untracked.iter().map(String::as_str));
        run(&repo, &args).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_commit(repo: String, message: String) -> Result<(), String> {
    run(&repo, &["commit", "-m", &message]).await.map(drop)
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    run(&path, &["init"]).await.map(drop)
}

// ---------- branches / sync ----------

#[derive(Serialize)]
pub struct Branch {
    name: String,
    upstream: Option<String>,
    track: String, // e.g. "[ahead 1, behind 2]"
    current: bool,
}

#[derive(Serialize)]
pub struct Branches {
    local: Vec<Branch>,
    remote: Vec<String>,
}

#[tauri::command]
pub async fn git_branches(repo: String) -> Result<Branches, String> {
    let out = run(
        &repo,
        &["for-each-ref", "--format=%(refname)%09%(upstream:short)%09%(upstream:track)%09%(HEAD)", "refs/heads", "refs/remotes"],
    )
    .await?;
    let (mut local, mut remote) = (Vec::new(), Vec::new());
    for line in out.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 4 {
            continue;
        }
        if let Some(name) = f[0].strip_prefix("refs/heads/") {
            local.push(Branch {
                name: name.into(),
                upstream: (!f[1].is_empty()).then(|| f[1].into()),
                track: f[2].into(),
                current: f[3] == "*",
            });
        } else if let Some(name) = f[0].strip_prefix("refs/remotes/") {
            if !name.ends_with("/HEAD") {
                remote.push(name.into());
            }
        }
    }
    Ok(Branches { local, remote })
}

#[tauri::command]
pub async fn git_switch(repo: String, name: String, create: bool) -> Result<(), String> {
    let args: &[&str] = if create { &["switch", "-c", &name] } else { &["switch", &name] };
    run(&repo, args).await.map(drop)
}

#[tauri::command]
pub async fn git_branch_delete(repo: String, name: String, force: bool) -> Result<(), String> {
    run(&repo, &["branch", if force { "-D" } else { "-d" }, &name]).await.map(drop)
}

#[tauri::command]
pub async fn git_fetch(repo: String) -> Result<(), String> {
    run(&repo, &["fetch", "--prune"]).await.map(drop)
}

#[tauri::command]
pub async fn git_pull(repo: String) -> Result<(), String> {
    run(&repo, &["pull"]).await.map(drop)
}

#[tauri::command]
pub async fn git_push(repo: String) -> Result<(), String> {
    if run(&repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).await.is_ok() {
        return run(&repo, &["push"]).await.map(drop);
    }
    let remotes = run(&repo, &["remote"]).await?;
    let remote = remotes
        .lines()
        .find(|r| *r == "origin")
        .or_else(|| remotes.lines().next())
        .ok_or("No remote configured")?;
    run(&repo, &["push", "-u", remote, "HEAD"]).await.map(drop)
}

// ---------- worktrees ----------

#[tauri::command]
pub async fn git_worktree_add(repo: String, path: String, branch: String, create: bool) -> Result<(), String> {
    let args: &[&str] = if create {
        &["worktree", "add", "-b", &branch, &path]
    } else {
        &["worktree", "add", &path, &branch]
    };
    run(&repo, args).await.map(drop)
}

#[tauri::command]
pub async fn git_worktree_remove(repo: String, path: String, force: bool) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path);
    run(&repo, &args).await.map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = [
            "# branch.oid 1234abcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa aaa src/with space.ts",
            "2 R. N... 100644 100644 100644 aaa aaa R100 new.ts",
            "old.ts",
            "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
            "? untracked/",
            "",
        ]
        .join("\0");
        let st = parse_status(&out);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.oid.as_deref(), Some("1234abcd"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.files.len(), 4);
        assert_eq!(st.files[0], FileEntry { path: "src/with space.ts".into(), orig: None, x: '.', y: 'M', conflict: false });
        assert_eq!(st.files[1].orig.as_deref(), Some("old.ts"));
        assert_eq!((st.files[1].x, st.files[1].path.as_str()), ('R', "new.ts"));
        assert!(st.files[2].conflict);
        assert_eq!((st.files[3].x, st.files[3].path.as_str()), ('?', "untracked/"));

        let unborn = parse_status("# branch.oid (initial)\0# branch.head main\0");
        assert!(unborn.oid.is_none());
        let detached = parse_status("# branch.oid abc\0# branch.head (detached)\0");
        assert!(detached.branch.is_none());
    }

    #[test]
    fn parses_worktree_list() {
        let out = "worktree /r/main\nHEAD a\nbranch refs/heads/main\n\nworktree /r/feat\nHEAD b\nbranch refs/heads/feat\n\nworktree /r/gone\nHEAD c\nprunable gitdir file points to non-existent location\n\n";
        assert_eq!(parse_worktrees(out), vec!["/r/main", "/r/feat"]);
    }

    fn sh(dir: &Path, cmd: &str) {
        let ok = std::process::Command::new("sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success();
        assert!(ok, "{cmd}");
    }

    const COMMIT: &str = "git -c user.email=t@t -c user.name=t commit -qm";

    #[tokio::test]
    async fn status_stage_and_worktrees_end_to_end() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let r = root.to_string_lossy().to_string();
        sh(&root, &format!("git init -q -b main && echo a > a.txt && git add -A && {COMMIT} init"));
        // Nested repo NOT ignored by the outer one: the gitlink trap.
        std::fs::create_dir(root.join("inner")).unwrap();
        sh(&root.join("inner"), &format!("git init -q -b dev && echo x > x && git add -A && {COMMIT} init"));
        sh(&root, "echo b >> a.txt && echo new > new.txt");

        let repos = git_discover(r.clone(), vec![]).await.unwrap();
        assert_eq!(repos.iter().map(|x| x.kind).collect::<Vec<_>>(), vec!["primary", "nested"]);

        let st = git_status(r.clone(), vec!["inner".into()]).await.unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        let paths: Vec<&str> = st.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["a.txt", "new.txt"], "nested repo must be hidden");

        git_stage(r.clone(), vec![], vec!["inner".into()]).await.unwrap();
        let staged = run(&r, &["diff", "--cached", "--name-only"]).await.unwrap();
        assert_eq!(staged.lines().collect::<Vec<_>>(), vec!["a.txt", "new.txt"], "inner must not be staged as a gitlink");

        git_unstage(r.clone(), vec!["new.txt".into()]).await.unwrap();
        let st = git_status(r.clone(), vec!["inner".into()]).await.unwrap();
        assert!(st.files.iter().any(|f| f.path == "new.txt" && f.x == '?'));

        git_commit(r.clone(), "feat: test".into()).await.unwrap();
        let v = git_file_versions(r.clone(), "a.txt".into(), None, false).await.unwrap();
        assert_eq!((v.original.as_str(), v.modified.as_str()), ("a\nb\n", "a\nb\n"));

        let wt = format!("{r}-feat");
        git_worktree_add(r.clone(), wt.clone(), "feat".into(), true).await.unwrap();
        let repos = git_discover(r.clone(), vec![]).await.unwrap();
        let w = repos.iter().find(|x| x.kind == "worktree").expect("worktree discovered");
        assert_eq!((w.path.as_str(), w.parent.as_deref()), (wt.as_str(), Some(r.as_str())));
        let b = git_branches(r.clone()).await.unwrap();
        assert!(b.local.iter().any(|x| x.name == "main" && x.current));
        git_worktree_remove(r.clone(), wt.clone(), true).await.unwrap();
        assert!(!Path::new(&wt).exists());
    }

    #[test]
    fn discovers_ignored_nested_repo_and_skips_node_modules() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let init = |p: &Path| {
            std::fs::create_dir_all(p).unwrap();
            assert!(std::process::Command::new("git").arg("init").arg("-q").current_dir(p).status().unwrap().success());
        };
        init(root);
        std::fs::write(root.join(".gitignore"), "inner/\n").unwrap();
        init(&root.join("inner"));
        init(&root.join("node_modules/pkg"));
        let mut found = find_repos(root);
        found.sort();
        assert_eq!(found, vec![root.to_path_buf(), root.join("inner")]);
    }
}
