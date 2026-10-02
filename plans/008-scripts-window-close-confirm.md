# Plan 008: Scripts window per project, force-close confirmations, sidebar header

## Context
User feedback, 2026-10-01:
1. The left panel's top bar scrolled sideways because the add-project button sat beside the tabs. Put the button on its own row, the same width as the tabs.
2. Closing a terminal that is running something, removing a project or space, or quitting should ask **Cancel** or **Force close**.
3. A project's scripts should get their own window, not open inside a space's window.

## 1. Left panel header (`LeftPanel.tsx`, `styles.css`)
`.left-head` is a centered one-column grid with the "Add project" `.btn` above the segmented tabs. The button stretches to the tabs' width and is 28px tall, the tab strip's outer height.

## 2. Force-close confirmations
- **What counts as running** (`pty.rs` `pty_busy`, `terminals.ts` `busyTerms`):
  - Script, one-off command and agent terminals count while their process is alive.
  - A plain shell counts only when it has a foreground job (`tcgetpgrp` on the PTY master ≠ shell pid).
  - Idle shells and background helpers such as p10k's gitstatusd don't count, so quitting no longer warns about every open shell.
- **Closing a tab** (`store.ts` `closeTab`):
  - Shell, command or agent tab: if it's running, Cancel / Force close.
  - Script tab: Force close / Keep running / Cancel (`message` with custom buttons). Keep running is the old hide-the-tab behavior.
- **Removing a project or space**: the existing dialog lists the running terminals and the OK button becomes "Force close & remove".
  - These terminals are now killed. Before this change they leaked as orphaned processes.
  - Project: its shells and agents, plus the scripts it owns. Scripts owned by other projects keep running.
  - Space: the non-script terminals whose tabs are in that space's window.
- **Quit**: the dialog lists only terminals that are running something, with "Force close & quit".

## 3. Scripts window per project (`store.ts`, `terminals.ts`, `LeftPanel.tsx`, `App.tsx`)
- `scriptsWindow(projectId)` returns `"scripts:<id>"`, a window id that sits alongside the space ids in `layout.activeSpaceId` / `layout.views`.
  - `projectOfWindow` resolves either kind of id.
  - `showSpace`, `normalize` and `focusTerminal` accept both.
- `openTerminalTab(key, activate, win)` routes the tab to window `win`, unless the tab is already open in the current window.
  - When not activating, it inserts into the stashed view.
- `runScript(id, activate, projectId)` / `showScript` / `restart(key, projectId)` / `runStart` open the script in the given project's scripts window, defaulting to the owner's.
  - A linked script clicked under project B opens in B's window.
- Sidebar:
  - Clicking the project's "Scripts" header opens its window and highlights the header the same way as a selected space card.
  - The chevron is now its own collapse button.
  - Space cards are selected by exact `activeSpaceId`.
- The project bar reads "project › Scripts".
- The scripts window's right panel shows the project's primary space (its root folder).
- `normalize` drops script tabs from space windows in older configs.

## Verification
- `bunx tsc --noEmit`: clean.
- `cargo check`: clean.
- `cargo test --lib pty::` passes, including the new `foreground_job_marks_shell_busy` test, which checks against a real zsh that the shell is idle at its prompt and busy while `sleep` runs.
- Playwright against the dev server with mocked IPC: 25/25 checks pass.
  - Scripts window routing, separate windows per project, header select and collapse.
  - The 3-button script close (cancel / keep / force).
  - Busy versus idle shell close.
  - The quit list, and remove-project kill.

## Gaps
- Not run in the real desktop app (`bun tauri dev`).
- "Close others" asks once per running terminal.

## Follow-up (2026-10-01)
- The "Include in Start" checkbox on script rows was misleading. It is now a `push_pin` toggle at the right end of the row (the header Start button uses `playlist_play`).
  - Included: filled and in the project color.
  - Not included: hidden until the row is hovered.
- A running script's green dot (script row and space card) is now steady instead of pulsing. The unused `.pulse` CSS is removed.
- `.icon-btn` gets `padding: 0`. The browser's default button padding was pushing every icon about 2px right of center, and 6px on the compact Scripts chevron.
- Clicking the Scripts header (name included) opens its window and toggles collapse, like the project header. The chevron only toggles collapse.
- Scripts tab (the cross-project running view):
  - Its Start button is gone. A header Stop-all button appears while anything runs, and it stops each unique script once.
  - Each running row has a red Stop button at its right end in place of the Start toggle.
- Under each project, the header's Start button becomes a red **Stop all** while any of the project's scripts is running, whether started by Start or one at a time. It stops every script of the project.
  - The `startRuns` tracking added in an earlier step is gone.
- The header Start icon is now `playlist_play` ("play all").
- In the scripts window, the project bar shows a summary of the project's scripts (running / failed / not running) instead of the git line.
- Git tab: the "N repos with no changes" toggle now sits right after the repos with changes, and the clean repos open below it, not at the bottom of the list. The repo row renderer is extracted as `repoNode`.
