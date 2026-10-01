//! Samples RSS per terminal session (summed over its process tree) every 2s, plus the
//! command names running in it (so an agent CLI typed into a plain shell is recognised).
//! ponytail: RSS, not Activity Monitor's "memory footprint"; the WebKit content
//! process is not our child so it is not counted in `app`.

use crate::pty::Ptys;
use std::collections::HashMap;
use std::time::Duration;
use std::path::Path;
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct MemStats {
    sessions: HashMap<String, u64>,
    app: u64,
    /// Session id → command names of the shell's descendants.
    procs: HashMap<String, Vec<String>>,
}

/// argv[0]'s file name; for interpreters (`node /…/gemini`) the script's too.
fn command_names(p: &Process) -> Vec<String> {
    let base = |s: &std::ffi::OsString| Path::new(s).file_name().map(|n| n.to_string_lossy().into_owned());
    let cmd = p.cmd();
    let mut out: Vec<String> = cmd.first().and_then(base).into_iter().collect();
    if matches!(out.first().map(String::as_str), Some("node" | "bun" | "deno" | "python" | "python3" | "ruby")) {
        out.extend(cmd.iter().skip(1).find(|a| !a.to_string_lossy().starts_with('-')).and_then(base));
    }
    out
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        let me = Pid::from_u32(std::process::id());
        loop {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_memory().with_cmd(UpdateKind::OnlyIfNotSet),
            );
            let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
            for (pid, p) in sys.processes() {
                if let Some(parent) = p.parent() {
                    children.entry(parent).or_default().push(*pid);
                }
            }
            let tree_rss = |root: Pid| {
                let (mut total, mut stack) = (0, vec![root]);
                while let Some(pid) = stack.pop() {
                    total += sys.process(pid).map_or(0, |p| p.memory());
                    stack.extend(children.get(&pid).into_iter().flatten().copied());
                }
                total
            };
            let descendants = |root: Pid| {
                let (mut out, mut stack) = (Vec::new(), children.get(&root).cloned().unwrap_or_default());
                while let Some(pid) = stack.pop() {
                    out.extend(sys.process(pid).map(command_names).unwrap_or_default());
                    stack.extend(children.get(&pid).into_iter().flatten().copied());
                }
                out.sort();
                out.dedup();
                out
            };
            let pids = app.state::<Ptys>().pids();
            let sessions = pids.iter().map(|(id, pid)| (id.clone(), tree_rss(Pid::from_u32(*pid)))).collect();
            let procs = pids.iter().map(|(id, pid)| (id.clone(), descendants(Pid::from_u32(*pid)))).collect();
            let app_rss = sys.process(me).map_or(0, |p| p.memory());
            let _ = app.emit("mem-stats", MemStats { sessions, app: app_rss, procs });
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
