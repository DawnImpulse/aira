# 015 · Update without losing anything: fd handoff relaunch

Goal: an update (or Aira → Restart Aira) restarts the process, and everything comes back as it was:
the same live shells and agents, their scrollback, browser tabs on their pages, the window where it was.

## Mechanism

No daemon. The PTY master of every terminal is a plain fd (`pty.rs` `Master`). `relaunch` dups each one
without CLOEXEC, lists them in `AIRA_INHERIT=id:fd:pid,…`, spawns the binary on disk (already the new
version after an update) via fork+exec, marks `handoff` so exit does not kill the shells, and exits.
The new process adopts the fds in `setup` (`pty::adopt`), parks them in `Ptys::inherited`, and the
frontend reattaches each one (`pty_attach`) instead of spawning. Scrollback is serialized by the old
frontend into `<app config>/handoff.json` (key → sessionId + xterm buffer) and replayed before attach.

Browser tabs already reopen on their saved URL. Window geometry: `tauri-plugin-window-state` (main only).

## Not covered

- A crash or a normal quit still ends the shells (quit is the user's choice; a crash has no handoff).
- Browser pop-outs dock back into their tab on restart.
- Exit codes of inherited sessions are unknown (reported as 0): they are not the new process's children.
- Agent status/subagent trees rebuild from the next hook events; in-memory heuristics start fresh.
- Unsaved editor buffers: warned about before restarting, not carried over.

## Update UI

Bottom-right card (Orca-style) driven by `updates.ts` state: available → downloading (progress) →
installed (Restart now / Later). A status-bar pill brings a dismissed card back.
