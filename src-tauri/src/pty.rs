//! PTY sessions. Output streams over a Tauri Channel as raw bytes with ack-based
//! flow control; the exit code is the last message on the same channel so it
//! can never overtake trailing output.
//!
//! The master side of every session is a plain fd, so an in-place relaunch (`relaunch`: after an
//! update, or Aira → Restart Aira) hands the live shells to the next process: the fds are dup'd
//! without CLOEXEC, listed in `AIRA_INHERIT`, and the new process adopts them in `adopt`. Until the
//! frontend reattaches (`pty_attach`) they wait in `Ptys::inherited`.

use crate::env;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

const BATCH: usize = 64 * 1024;
const HIGH_WATER: usize = 2 * 1024 * 1024;
const INHERIT: &str = "AIRA_INHERIT";

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

/// The master side of a PTY as an owned fd. Own sessions dup it out of portable-pty right after
/// spawning and inherited ones arrive as fds, so both kinds run through the same code.
struct Master(OwnedFd);

impl Master {
    fn dup(fd: RawFd) -> Result<Master, String> {
        let d = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        if d < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(Master(unsafe { OwnedFd::from_raw_fd(d) }))
    }

    fn file(&self) -> Result<File, String> {
        self.0.try_clone().map(File::from).map_err(err)
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let ws = libc::winsize { ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0 };
        if unsafe { libc::ioctl(self.0.as_raw_fd(), libc::TIOCSWINSZ, &ws) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    /// The terminal's foreground process group, if any.
    fn foreground(&self) -> Option<u32> {
        let pg = unsafe { libc::tcgetpgrp(self.0.as_raw_fd()) };
        (pg > 0).then_some(pg as u32)
    }
}

struct Session {
    master: Master,
    writer: Arc<Mutex<File>>,
    pid: u32,
    flow: Arc<Flow>,
}

#[derive(Default)]
pub struct Ptys {
    sessions: Mutex<HashMap<String, Session>>,
    /// Handed over by the previous process; waiting for the frontend to attach.
    inherited: Mutex<HashMap<String, (Master, u32)>>,
    /// The next process owns the shells now: exiting must not kill them.
    handoff: AtomicBool,
}

impl Ptys {
    pub fn pids(&self) -> Vec<(String, u32)> {
        let mut v: Vec<_> = self.sessions.lock().unwrap().iter().map(|(id, s)| (id.clone(), s.pid)).collect();
        v.extend(self.inherited.lock().unwrap().iter().map(|(id, (_, pid))| (id.clone(), *pid)));
        v
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
    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave); // otherwise the reader never sees EOF
    let pid = child.process_id().unwrap_or(0);
    let master = Master::dup(pair.master.as_raw_fd().ok_or("pty without fd")?)?;
    drop(pair.master); // our dup keeps the pty open
    register(app, id, master, pid, Some(child), on_data)
}

/// Makes a session addressable by `id` and streams its output to `on_data`.
fn register(
    app: AppHandle,
    id: String,
    master: Master,
    pid: u32,
    mut child: Option<Box<dyn Child + Send + Sync>>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let mut reader = master.file()?;
    let writer = master.file()?;
    let flow = Arc::new(Flow::default());
    app.state::<Ptys>()
        .sessions
        .lock()
        .unwrap()
        .insert(id.clone(), Session { master, writer: Arc::new(Mutex::new(writer)), pid, flow: flow.clone() });

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
        // ponytail: a session inherited across a relaunch is not our child, so its exit code is unknown (0).
        let code = child.as_mut().and_then(|c| c.wait().ok()).map(|s| s.exit_code() as i64).unwrap_or(0);
        app.state::<Ptys>().sessions.lock().unwrap().remove(&id);
        let _ = on_data.send(InvokeResponseBody::Json(format!("{{\"exit\":{code}}}")));
    });
    Ok(pid)
}

/// Async + per-session writer lock: a write can block when the child stops reading
/// stdin, and that must not stall the main thread or other sessions.
#[tauri::command]
pub async fn pty_write(state: State<'_, Ptys>, id: String, data: String) -> Result<(), String> {
    let writer = state.sessions.lock().unwrap().get(&id).ok_or("session gone")?.writer.clone();
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
    let map = state.sessions.lock().unwrap();
    map.get(&id).ok_or("session gone")?.master.resize(cols, rows)
}

#[tauri::command]
pub fn pty_ack(state: State<Ptys>, id: String, bytes: usize) {
    if let Some(s) = state.sessions.lock().unwrap().get(&id) {
        let mut unacked = s.flow.unacked.lock().unwrap();
        *unacked = unacked.saturating_sub(bytes);
        s.flow.cv.notify_all();
    }
}

/// Sessions among `ids` whose shell has a foreground job (not sitting at its prompt).
/// Background helpers (e.g. powerlevel10k's gitstatusd) don't count.
#[tauri::command]
pub fn pty_busy(state: State<Ptys>, ids: Vec<String>) -> Vec<String> {
    let map = state.sessions.lock().unwrap();
    ids.into_iter()
        .filter(|id| map.get(id).is_some_and(|s| s.master.foreground().is_some_and(|pg| pg != s.pid)))
        .collect()
}

/// Sessions handed over by the previous process that nobody has attached yet.
#[tauri::command]
pub fn pty_inherited(state: State<Ptys>) -> Vec<String> {
    state.inherited.lock().unwrap().keys().cloned().collect()
}

/// Resumes streaming an inherited session. The resize (through a size one row off) raises SIGWINCH,
/// so full-screen programs redraw into the reattached terminal.
#[tauri::command]
pub fn pty_attach(app: AppHandle, id: String, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>) -> Result<u32, String> {
    let (master, pid) = app.state::<Ptys>().inherited.lock().unwrap().remove(&id).ok_or("no such inherited session")?;
    master.resize(cols, rows.saturating_sub(1))?;
    master.resize(cols, rows)?;
    register(app, id, master, pid, None, on_data)
}

/// Ctrl-C first (lets dev servers shut down cleanly), then SIGTERM/SIGHUP the whole
/// session + descendants, then SIGKILL survivors. Interactive shells ignore SIGTERM
/// and put jobs in their own process groups, so killpg alone is not enough.
#[tauri::command]
pub async fn pty_kill(app: AppHandle, id: String) -> Result<(), String> {
    let (pid, writer) = {
        let state = app.state::<Ptys>();
        let map = state.sessions.lock().unwrap();
        match map.get(&id) {
            Some(s) => (s.pid, Some(s.writer.clone())),
            // Inherited but never attached (its tab was closed before the relaunch): dropping the master hangs it up.
            None => match state.inherited.lock().unwrap().remove(&id) {
                Some((_, pid)) => (pid, None),
                None => return Ok(()),
            },
        }
    };
    if let Some(w) = writer {
        if let Ok(mut w) = w.try_lock() {
            let _ = w.write_all(b"\x03");
        }
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    tauri::async_runtime::spawn_blocking(move || terminate(&[pid], Duration::from_secs(3)))
        .await
        .map_err(err)
}

/// Blocking; used on app exit. A no-op after a handoff: the next process owns the shells.
pub fn kill_all(app: &AppHandle) {
    let state = app.state::<Ptys>();
    if state.handoff.load(Ordering::Relaxed) {
        return;
    }
    let roots: Vec<u32> = state.pids().into_iter().map(|(_, p)| p).collect();
    terminate(&roots, Duration::from_millis(1500));
}

/// Starts a fresh Aira process (the binary on disk: after an update, the new version) that takes over
/// every live shell, then exits this one. The fds are dup'd without CLOEXEC so the child inherits them;
/// `AIRA_INHERIT` tells it which is which.
#[tauri::command]
pub fn relaunch(app: AppHandle) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    let state = app.state::<Ptys>();
    let sessions = state.sessions.lock().unwrap();
    let inherited = state.inherited.lock().unwrap();
    let all = sessions
        .iter()
        .map(|(id, s)| (id, s.master.0.as_raw_fd(), s.pid))
        .chain(inherited.iter().map(|(id, (m, pid))| (id, m.0.as_raw_fd(), *pid)));
    let mut spec = Vec::new();
    let mut fds = Vec::new();
    let close_all = |fds: &[RawFd]| {
        for &f in fds {
            unsafe { libc::close(f) };
        }
    };
    for (id, fd, pid) in all {
        let d = unsafe { libc::dup(fd) }; // plain dup: no CLOEXEC, meant to be inherited
        if d < 0 {
            close_all(&fds);
            return Err(std::io::Error::last_os_error().to_string());
        }
        fds.push(d);
        spec.push(format!("{id}:{d}:{pid}"));
    }
    let exe = tauri::process::current_binary(&app.env()).map_err(err)?;
    let mut cmd = std::process::Command::new(exe);
    cmd.env(INHERIT, spec.join(","));
    // Any pre_exec forces fork+exec, which inherits fds by their CLOEXEC flag; std's posix_spawn
    // fast path is not guaranteed to.
    unsafe { cmd.pre_exec(|| Ok(())) };
    let spawned = cmd.spawn();
    close_all(&fds); // the child has its copies
    spawned.map_err(err)?;
    state.handoff.store(true, Ordering::Relaxed);
    drop(sessions);
    drop(inherited);
    app.exit(0);
    Ok(())
}

/// Reads and clears `AIRA_INHERIT`. Called first thing at startup, before anything snapshots the
/// environment for child processes.
pub fn take_inherit() -> Vec<(String, RawFd, u32)> {
    let Ok(spec) = std::env::var(INHERIT) else { return Vec::new() };
    std::env::remove_var(INHERIT);
    parse_inherit(&spec)
}

fn parse_inherit(spec: &str) -> Vec<(String, RawFd, u32)> {
    spec.split(',')
        .filter_map(|entry| {
            let mut p = entry.split(':');
            Some((p.next()?.to_string(), p.next()?.parse().ok()?, p.next()?.parse().ok()?))
        })
        .collect()
}

/// Takes ownership of the handed-over fds; returns how many sessions are waiting to be attached.
pub fn adopt(app: &AppHandle, handed: Vec<(String, RawFd, u32)>) -> usize {
    let state = app.state::<Ptys>();
    let mut map = state.inherited.lock().unwrap();
    for (id, fd, pid) in handed {
        if unsafe { libc::isatty(fd) } != 1 {
            continue;
        }
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) }; // ours now; not for the shells we spawn
        map.insert(id, (Master(unsafe { OwnedFd::from_raw_fd(fd) }), pid));
    }
    map.len()
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

    /// pty_busy's check through `Master`: at the prompt the shell owns the foreground; a running command takes it.
    #[test]
    fn foreground_job_marks_shell_busy() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.args(["-f", "-i"]); // interactive (job control), no rc files
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let pid = child.process_id().unwrap();
        let master = Master::dup(pair.master.as_raw_fd().unwrap()).unwrap();
        drop(pair.master);
        let busy = || master.foreground().is_some_and(|pg| pg != pid);
        let until = |want: bool| {
            let start = Instant::now();
            while busy() != want && start.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(50));
            }
            busy() == want
        };
        // Drain output like the app does, or zsh blocks writing its prompt and never reads the command.
        let mut reader = master.file().unwrap();
        std::thread::spawn(move || std::io::copy(&mut reader, &mut std::io::sink()));
        assert!(until(false), "shell never reached its prompt");
        let mut w = master.file().unwrap();
        w.write_all(b"sleep 30\n").unwrap();
        assert!(until(true), "running `sleep` not seen as busy");
        terminate(&[pid], Duration::from_secs(3));
        let _ = child.wait();
    }

    /// The handoff premise: a dup'd fd without CLOEXEC survives fork+exec into the child.
    #[test]
    fn child_inherits_non_cloexec_fd() {
        use std::os::unix::process::CommandExt;
        let mut fds = [0 as RawFd; 2];
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let [r, w] = fds;
        let inheritable = unsafe { libc::dup(w) };
        unsafe { libc::close(w) };
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.args(["-c", &format!("echo ok >&{inheritable}")]);
        unsafe { cmd.pre_exec(|| Ok(())) };
        let status = cmd.status().unwrap();
        unsafe { libc::close(inheritable) };
        assert!(status.success());
        let mut out = String::new();
        File::from(unsafe { OwnedFd::from_raw_fd(r) }).read_to_string(&mut out).unwrap();
        assert_eq!(out.trim(), "ok");
    }

    /// A `Master` built from a bare fd (how an inherited session arrives) can write, read back and resize.
    #[test]
    fn master_from_raw_fd_roundtrip() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let cmd = CommandBuilder::new("/bin/cat");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let handed = unsafe { libc::dup(pair.master.as_raw_fd().unwrap()) };
        drop(pair.master);
        let master = Master(unsafe { OwnedFd::from_raw_fd(handed) });
        master.resize(100, 40).unwrap();
        let mut w = master.file().unwrap();
        w.write_all(b"hello\n").unwrap();
        let mut r = master.file().unwrap();
        let mut buf = [0u8; 64];
        let mut got = String::new();
        let start = Instant::now();
        while !got.contains("hello\r\nhello") && start.elapsed() < Duration::from_secs(5) {
            // echo of the input, then cat's copy
            let n = r.read(&mut buf).unwrap();
            got.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        assert!(got.contains("hello\r\nhello"), "got {got:?}");
        assert_eq!(parse_inherit("a:3:10,b:4:11"), vec![("a".into(), 3, 10), ("b".into(), 4, 11)]);
        let _ = child.kill();
        let _ = child.wait();
    }
}
