//! Listening TCP ports with their process, and which IDE terminal (if any) started it.
//! ponytail: `lsof` (ships with macOS, ~40ms) instead of a socket-table crate. Only the
//! user's own processes are visible, which is what we can kill anyway.

use crate::pty::{terminate, Ptys};
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize)]
pub struct PortInfo {
    port: u16,
    pid: u32,
    /// Process name, e.g. `node`.
    name: String,
    /// Full command line.
    cmd: String,
    cwd: Option<String>,
    /// PTY session whose process tree holds it.
    session: Option<String>,
}

/// `lsof -F pn` output → unique (pid, port); IPv4 and IPv6 listeners of one process collapse.
fn parse(out: &str) -> Vec<(u32, u16)> {
    let mut found = Vec::new();
    let mut pid = 0;
    for line in out.lines() {
        if let Some(v) = line.strip_prefix('p') {
            pid = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix('n') {
            if let Some(port) = v.rsplit(':').next().and_then(|p| p.parse().ok()) {
                if pid != 0 && !found.contains(&(pid, port)) {
                    found.push((pid, port));
                }
            }
        }
    }
    found
}

fn list(sessions: Vec<(String, u32)>) -> Result<Vec<PortInfo>, String> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"])
        .output()
        .map_err(|e| e.to_string())?; // exit 1 just means "nothing listening"
    let found = parse(&String::from_utf8_lossy(&out.stdout));
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always).with_cwd(UpdateKind::Always),
    );
    let roots: HashMap<u32, String> = sessions.into_iter().map(|(id, pid)| (pid, id)).collect();
    Ok(found
        .into_iter()
        .map(|(pid, port)| {
            let p = sys.process(Pid::from_u32(pid));
            let mut session = None;
            let mut cur = Some(Pid::from_u32(pid));
            while let Some(c) = cur {
                if let Some(id) = roots.get(&c.as_u32()) {
                    session = Some(id.clone());
                    break;
                }
                cur = sys.process(c).and_then(|x| x.parent());
            }
            PortInfo {
                port,
                pid,
                name: p.map(|x| x.name().to_string_lossy().into_owned()).unwrap_or_default(),
                cmd: p.map(|x| x.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")).unwrap_or_default(),
                cwd: p.and_then(|x| x.cwd()).map(|c| c.to_string_lossy().into_owned()),
                session,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn ports_list(app: AppHandle) -> Result<Vec<PortInfo>, String> {
    let sessions = app.state::<Ptys>().pids();
    tauri::async_runtime::spawn_blocking(move || list(sessions)).await.map_err(|e| e.to_string())?
}

/// SIGTERM the process and its children, SIGKILL whatever is left after 3s.
#[tauri::command]
pub async fn kill_pid(pid: u32) -> Result<(), String> {
    if pid <= 1 || pid == std::process::id() {
        return Err("Refusing to kill this process".into());
    }
    tauri::async_runtime::spawn_blocking(move || terminate(&[pid], Duration::from_secs(3))).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lsof_and_dedupes_ipv4_ipv6() {
        let out = "p740\nf10\nn*:7000\nf11\nn*:7000\nf12\nn[::1]:5000\np99\nf3\nn127.0.0.1:5173\n";
        assert_eq!(parse(out), vec![(740, 7000), (740, 5000), (99, 5173)]);
    }

    #[test]
    fn finds_a_real_listener() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let me = std::process::id();
        let all = list(vec![("s1".into(), me)]).unwrap();
        let hit = all.iter().find(|p| p.port == port).expect("own listener not listed");
        assert_eq!(hit.pid, me);
        assert_eq!(hit.session.as_deref(), Some("s1")); // its own root counts as the session
    }
}
