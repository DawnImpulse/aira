//! PTY sessions. Output streams over a Tauri Channel as raw bytes with ack-based
//! flow control; the exit code is the last message on the same channel so it
//! can never overtake trailing output.

use crate::env;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

const BATCH: usize = 64 * 1024;
const HIGH_WATER: usize = 2 * 1024 * 1024;

#[derive(Default)]
struct Flow {
    unacked: Mutex<usize>,
    cv: Condvar,
}

impl Flow {
    fn wait_for_room(&self, n: usize) {
        let mut unacked = self.unacked.lock().unwrap();
        let start = Instant::now();
        while *unacked > HIGH_WATER {
            unacked = self.cv.wait_timeout(unacked, Duration::from_millis(500)).unwrap().0;
            // ponytail: no ack for 10s means the webview reloaded and lost its channel; stop waiting.
            if start.elapsed() > Duration::from_secs(10) {
                *unacked = 0;
            }
        }
        *unacked += n;
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pid: u32,
    flow: Arc<Flow>,
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<String, Session>>);

impl Ptys {
    pub fn pids(&self) -> Vec<(String, u32)> {
        self.0.lock().unwrap().iter().map(|(id, s)| (id.clone(), s.pid)).collect()
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    id: String,
    cwd: String,
    command: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || spawn(app, id, cwd, command, cols, rows, env.unwrap_or_default(), on_data))
        .await
        .map_err(err)?
}

fn spawn(
    app: AppHandle,
    id: String,
    cwd: String,
    command: Option<String>,
    cols: u16,
    rows: u16,
    extra_env: HashMap<String, String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system().openpty(size).map_err(err)?;
    let mut cmd = CommandBuilder::new(env::shell());
    match &command {
        Some(c) => cmd.args(["-c", c]),
        None => cmd.arg("-l"),
    }
    cmd.env_clear();
    for (k, v) in env::get() {
        cmd.env(k, v);
    }
    for (k, v) in &extra_env {
        cmd.env(k, v); // e.g. IDE_AGENT_EVENTS for Claude hook events
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.cwd(&cwd);
    let mut child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave); // otherwise the reader never sees EOF
    let pid = child.process_id().unwrap_or(0);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;
    let flow = Arc::new(Flow::default());
    app.state::<Ptys>().0.lock().unwrap().insert(
        id.clone(),
        Session { master: pair.master, writer: Arc::new(Mutex::new(writer)), pid, flow: flow.clone() },
    );

    // Bounded queue: when the frontend stops acking, the reader blocks, the PTY
    // buffer fills and the child is throttled by the kernel.
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(64);
    std::thread::spawn(move || {
        let mut buf = vec![0u8; BATCH];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            // No timer: batching happens naturally whenever we fall behind the reader.
            while batch.len() < BATCH {
                match rx.try_recv() {
                    Ok(more) => batch.extend(more),
                    Err(_) => break,
                }
            }
            flow.wait_for_room(batch.len());
            let _ = on_data.send(InvokeResponseBody::Raw(batch));
        }
        let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
        app.state::<Ptys>().0.lock().unwrap().remove(&id);
        let _ = on_data.send(InvokeResponseBody::Json(format!("{{\"exit\":{code}}}")));
    });
    Ok(pid)
}

/// Async + per-session writer lock: a write can block when the child stops reading
/// stdin, and that must not stall the main thread or other sessions.
#[tauri::command]
pub async fn pty_write(state: State<'_, Ptys>, id: String, data: String) -> Result<(), String> {
    let writer = state.0.lock().unwrap().get(&id).ok_or("session gone")?.writer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut w = writer.lock().unwrap();
        w.write_all(data.as_bytes())?;
        w.flush()
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[tauri::command]
pub fn pty_resize(state: State<Ptys>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let s = map.get(&id).ok_or("session gone")?;
    s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(err)
}

#[tauri::command]
pub fn pty_ack(state: State<Ptys>, id: String, bytes: usize) {
    if let Some(s) = state.0.lock().unwrap().get(&id) {
        let mut unacked = s.flow.unacked.lock().unwrap();
        *unacked = unacked.saturating_sub(bytes);
        s.flow.cv.notify_all();
    }
}

/// Sessions among `ids` whose shell has a foreground job (not sitting at its prompt).
/// Background helpers (e.g. powerlevel10k's gitstatusd) don't count.
#[tauri::command]
pub fn pty_busy(state: State<Ptys>, ids: Vec<String>) -> Vec<String> {
    let map = state.0.lock().unwrap();
    ids.into_iter()
        .filter(|id| map.get(id).is_some_and(|s| s.master.process_group_leader().is_some_and(|pg| pg as u32 != s.pid)))
        .collect()
}

/// Ctrl-C first (lets dev servers shut down cleanly), then SIGTERM/SIGHUP the whole
/// session + descendants, then SIGKILL survivors. Interactive shells ignore SIGTERM
/// and put jobs in their own process groups, so killpg alone is not enough.
#[tauri::command]
pub async fn pty_kill(app: AppHandle, id: String) -> Result<(), String> {
    let (pid, writer) = {
        let state = app.state::<Ptys>();
        let map = state.0.lock().unwrap();
        let Some(s) = map.get(&id) else { return Ok(()) };
        (s.pid, s.writer.clone())
    };
    if let Ok(mut w) = writer.try_lock() {
        let _ = w.write_all(b"\x03");
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    tauri::async_runtime::spawn_blocking(move || terminate(&[pid], Duration::from_secs(3)))
        .await
        .map_err(err)
}

/// Blocking; used on app exit.
pub fn kill_all(app: &AppHandle) {
    let roots: Vec<u32> = app.state::<Ptys>().pids().into_iter().map(|(_, p)| p).collect();
    terminate(&roots, Duration::from_millis(1500));
}

pub(crate) fn terminate(roots: &[u32], grace: Duration) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    let send = |pids: &HashSet<u32>, sig: Signal| {
        for &p in pids {
            let _ = kill(Pid::from_raw(p as i32), sig);
        }
    };
    let roots_set: HashSet<u32> = roots.iter().copied().filter(|&p| p > 1).collect();
    let pids = tree(&roots_set);
    send(&pids, Signal::SIGTERM);
    send(&roots_set, Signal::SIGHUP); // interactive shells exit on HUP and forward it to jobs
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        if tree(&roots_set).is_empty() {
            return;
        }
    }
    send(&tree(&roots_set), Signal::SIGKILL);
}

/// Live pids in the sessions led by `roots` plus all their descendants (catches
/// children that called setsid). portable-pty makes each child a session leader.
fn tree(roots: &HashSet<u32>) -> HashSet<u32> {
    if roots.is_empty() {
        return HashSet::new();
    }
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let procs = sys.processes();
    let me = std::process::id();
    let mut out: HashSet<u32> = procs
        .iter()
        .filter(|(pid, p)| {
            roots.contains(&pid.as_u32()) || p.session_id().is_some_and(|s| roots.contains(&s.as_u32()))
        })
        .map(|(pid, _)| pid.as_u32())
        .collect();
    loop {
        let before = out.len();
        for (pid, p) in procs {
            if p.parent().is_some_and(|pp| out.contains(&pp.as_u32())) {
                out.insert(pid.as_u32());
            }
        }
        if out.len() == before {
            break;
        }
    }
    // Zombies are already dead (just not reaped yet); don't wait on them.
    out.retain(|&p| p > 1 && p != me && procs.get(&sysinfo::Pid::from_u32(p)).is_some_and(|x| x.status() != ProcessStatus::Zombie));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminate_kills_shell_and_background_jobs() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut cmd = CommandBuilder::new("/bin/zsh");
        // Interactive-style job control: background jobs land in their own process groups.
        cmd.args(["-ic", "setopt monitor; sleep 301 & sleep 302 & wait"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let pid = child.process_id().unwrap();
        let roots = HashSet::from([pid]);
        let start = Instant::now();
        // Interactive zsh loads the user's rc files; give it time when other tests load the CPU.
        while tree(&roots).len() < 3 && start.elapsed() < Duration::from_secs(15) {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(tree(&roots).len() >= 3, "expected shell + 2 sleeps, got {:?}", tree(&roots));
        terminate(&[pid], Duration::from_secs(3));
        let _ = child.wait();
        assert!(tree(&roots).is_empty(), "survivors: {:?}", tree(&roots));
    }

    /// pty_busy's check: at the prompt the shell owns the foreground; a running command takes it.
    #[test]
    fn foreground_job_marks_shell_busy() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.args(["-f", "-i"]); // interactive (job control), no rc files
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let pid = child.process_id().unwrap();
        let busy = || pair.master.process_group_leader().is_some_and(|pg| pg as u32 != pid);
        let until = |want: bool| {
            let start = Instant::now();
            while busy() != want && start.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(50));
            }
            busy() == want
        };
        // Drain output like the app does, or zsh blocks writing its prompt and never reads the command.
        let mut reader = pair.master.try_clone_reader().unwrap();
        std::thread::spawn(move || std::io::copy(&mut reader, &mut std::io::sink()));
        assert!(until(false), "shell never reached its prompt");
        let mut w = pair.master.take_writer().unwrap(); // kept alive: dropping it sends EOF
        w.write_all(b"sleep 30\n").unwrap();
        assert!(until(true), "running `sleep` not seen as busy");
        terminate(&[pid], Duration::from_secs(3));
        let _ = child.wait();
    }
}
