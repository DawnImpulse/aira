//! Samples RSS per terminal session (summed over its process tree) every 2s.
//! ponytail: RSS, not Activity Monitor's "memory footprint"; the WebKit content
//! process is not our child so it is not counted in `app`.

use crate::pty::Ptys;
use std::collections::HashMap;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct MemStats {
    sessions: HashMap<String, u64>,
    app: u64,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        let me = Pid::from_u32(std::process::id());
        loop {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_memory(),
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
            let sessions = app
                .state::<Ptys>()
                .pids()
                .into_iter()
                .map(|(id, pid)| (id, tree_rss(Pid::from_u32(pid))))
                .collect();
            let app_rss = sys.process(me).map_or(0, |p| p.memory());
            let _ = app.emit("mem-stats", MemStats { sessions, app: app_rss });
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
