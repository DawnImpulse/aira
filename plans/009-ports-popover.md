# Plan 009: Ports popover in the status bar

## Context
User request, 2026-10-01: an easy way in the bottom bar to free ports, mostly the ones our scripts use.
- Learn a script's port while it runs.
- When it isn't running, list the ports the project's package manager scripts would use.
- Search any port, see what holds it, and force close it.

## Backend (`src-tauri/src/ports.rs`)
- `ports_list` runs `lsof -nP -iTCP -sTCP:LISTEN -F pn` (~40ms on macOS), which needs no new crate. Each listener becomes a `{ port, pid, name, cmd, cwd, session }` entry.
  - IPv4 and IPv6 duplicates collapse into one.
  - The name, command line and cwd come from sysinfo.
  - `session` is found by walking the parent chain up to a PTY root, so it names the IDE terminal the listener runs in.
- `kill_pid` reuses `pty::terminate`: SIGTERM to the process and its children, then SIGKILL after 3s. It refuses pid ≤ 1 and the app itself.
- `lsof` only sees the user's own processes, which is also all we're allowed to kill.

## Frontend
- `lib/ports.ts`:
  - `refreshPorts()` stores the list and records each running script's ports in `script.ports`, which persists in config.
    - It polls every 5s while the window has focus, and also runs when the popover opens.
  - `expectedPorts(project)`, for each script:
    - Ports remembered from earlier runs come first.
    - Otherwise it guesses from the command plus the resolved `package.json` script: an explicit `--port`, `-p` or `PORT=`, else the tool's default (vite 5173, next 3000, astro 4321, ng 4200, django/uvicorn 8000, flask 5000, rails 3000, …).
    - `build`, `lint`, `test` and similar subcommands are skipped.
    - The project root's `package.json` scripts are scanned too, so ports appear before any IDE script is added.
  - `freePort`: a script's port stops that script (no prompt). Any other process is force closed after a Cancel / Force close confirm.
- Status bar: a "N ports" button (ports held by our projects) opens `PortsPopover`.
  - The popover is grouped by project:
    - The project's own listeners, labelled with their terminal name, or "outside the IDE" when matched by working dir.
    - Expected ports held by something else, shown in amber as "blocks dev".
    - Expected ports that are free.
  - A script linked into several projects counts as its own under each one.
  - Searching by port prefix lists any of the user's processes, with Force close.
  - Clicking a row that belongs to a terminal opens that terminal.

## Verification
- `cargo test --lib`: 21 pass. This includes `parses_lsof_and_dedupes_ipv4_ipv6` and `finds_a_real_listener`, which binds a real socket and checks its port, pid and session.
- `bunx tsc --noEmit`: clean.
- Playwright with mocked IPC: 14/14 pass.
  - Attribution to scripts, orphans and blockers.
  - System ports hidden, build/test subcommands not guessed.
  - The script's port remembered in config, and search.
  - Confirm before killing an orphan, and a script stopped instead of killed.
  - A remembered port shown as free after its script stops.

## Gaps
- Not run in the real desktop app.
- TCP listeners only (no UDP).
- A script's ports are learned only while the window has focus during the run.
