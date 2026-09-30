# Plan: Mac-first multi-project IDE (Tauri 2 + React)

## Context
Greenfield repo (no commits). Goal: Mac desktop IDE (Windows later) for working on many projects at once: per-project scripts in in-app terminals, per-repo git (nested repos + worktrees), Monaco editor/diff, AI commit messages. UI inspired by Orca: left = projects/scripts, center = tabs, right = files/git, bottom = status bar with memory + terminal list.

Decisions from Q&A:
- Stack: Tauri 2 + React/TS
- Editor: Monaco, no LSP
- Project cards show git status, script run status, and worktrees (no AI-agent detection)
- Config lives in one global app store
- Terminals are killed on quit; the layout is restored on relaunch
- Main area uses tabs (no splits)
- Git staging is file-level

## Architecture
Rust backend owns everything OS-level: PTYs, processes, git (shells out to the `git` CLI, reusing the user's SSH keys and credential helpers), fs + watching, keychain, HTTP to AI providers, memory sampling. React frontend is UI only and talks to the backend through `invoke` commands, events and `Channel`s.

**Every command is `async`.** Tauri runs sync commands on the main thread, so push, pull or a commit hook would freeze the UI. Git uses `tokio::process::Command`.

Cross-cutting pieces:
- **Shell env resolution**: apps launched from Finder get a bare PATH and no `LANG`.
  - At startup, run `$SHELL -ilc 'echo __ENV_START__; env -0; echo __ENV_END__'`:
    - 5s timeout
    - `DISABLE_AUTO_UPDATE=true` set, so oh-my-zsh can't block on an update prompt
    - only the text between the markers is parsed, so rc-file echoes can't corrupt it
  - Merge the result into the process env. Set `LANG=en_US.UTF-8` if it is still unset.
  - Store the result in a `OnceCell`. PTY spawn and `which` wait on it.
- **Data model**: global `config.json` in the app config dir. Saved with an atomic write (write to a temp file, then rename).
  ```ts
  Script  { id, name, runner, command, cwd, ownerProjectId: string | null }
          // cwd is relative to the owner project; absolute when ownerProjectId is null (external)
  Project { id, name, path, scriptIds: string[], extraRepos: string[], hiddenRepos: string[] }
  Config  { projects, scripts: Record<id, Script>,
            settings { theme, uiFont, monoFont, fontSize, terminalWebgl, ai { provider, model } },
            layout { tabs, activeProjectId, panelSizes, runningAtQuit } }
  ```
  - Scripts are global entities and projects reference them by id.
  - Interlink (req 11): another project's script id is added to `scriptIds`.
  - External script (req 11.1): `ownerProjectId: null` with an absolute cwd.
  - Every spawn gets a fresh session id. The store maps `scriptId → current sessionId`, so one process shows as running everywhere the script is linked, and a late exit from an old run can't mark the restarted run as exited.
  - On load, dangling `scriptIds` are removed.
- **Runners** (req 10.1): one table in `src/lib/runners.ts` with entries `{ id, label, detect(files), toCommand(target) }`:
  - npm, pnpm, yarn and bun (picked from the lockfile)
  - python and uv
  - java (mvn or gradle)
  - cargo, go, make
  - custom
  
  The backend checks which runners are installed with `which`.
- **Security**:
  - Strict CSP (the template ships `csp: null`).
  - Navigation away from the app is blocked.
  - SVGs render only through `<img>`.
  - Markdown renders without raw HTML.
  - fs commands canonicalize the path and reject anything outside the opened project roots (and their worktrees).

## Backend — `src-tauri/src/`
- `lib.rs`:
  - Tauri builder, plugins (`dialog`, `opener`), env resolution, command registration.
  - Custom menu: Cmd+W closes the current tab instead of the window, and the standard Edit menu stays (clipboard shortcuts need it).
  - On `RunEvent::ExitRequested`:
    - if scripts are running, stop the exit and ask the frontend to confirm
    - once confirmed, write `runningAtQuit` and kill every session synchronously (a 3s timer thread would die with the app)
- `pty.rs`: uses `portable-pty` 0.9, with sessions kept in a `Mutex<HashMap<id, Session>>`.
  - A plain terminal runs `$SHELL -l`. A script runs `$SHELL -c "<command>"`.
  - **Streaming**: `pty_spawn{cwd, command?, cols, rows}` takes a `Channel<InvokeResponseBody>`.
    - The reader thread batches output (flush at 16ms or 64KB) and sends it as `Raw` bytes, which arrive in JS as an ArrayBuffer.
    - The exit `{exit: code}` is sent as the last JSON message on the same channel, so it can't overtake the final output.
    - Flow control: the frontend calls `pty_ack(id, bytes)` after `term.write` finishes. The reader pauses while more than 2MB is unacked.
  - `pty_write` and `pty_resize`.
  - **`pty_kill`**:
    1. Write `\x03`.
    2. After a short wait, SIGTERM every pid in the child's session plus all its descendants (from `sysinfo`: session id + parent chain). Interactive shells ignore SIGTERM, and their jobs live in other process groups, so a plain killpg misses them.
    3. SIGKILL whatever is left after 3s.
    
    Restart waits for the exit message before spawning again.
- `mem.rs`:
  - A thread refreshes every 2s with `refresh_processes_specifics(All, true, ProcessRefreshKind::nothing().with_memory())`.
  - For each session it sums RSS over the process tree rooted at the child pid, then emits `mem-stats{sessions:{id:bytes}, app:bytes}`.
  - `// ponytail:` this is RSS (not Activity Monitor's footprint), and the WebKit content process isn't our child, so it isn't counted.
- `git.rs`: every call is `git -C <repo> --no-optional-locks ...` with `GIT_TERMINAL_PROMPT=0` set. `--no-optional-locks` stops status from taking `index.lock`, which would otherwise trigger the watcher and cause a refresh loop.
  - **Repo discovery**:
    - `walkdir` from the project root, depth ≤4. Skips `.git/`, node_modules, target, dist, build and .venv.
    - A `.git` directory or file marks a repo.
    - Discovery doesn't respect `.gitignore`, because inner repos are often ignored by the outer one. `extraRepos` adds repos manually.
  - **Status**: `status --porcelain=v2 --branch -z`, parsed into branch, upstream, ahead/behind, and staged, unstaged, untracked and conflicted entries.
  - **Nested repos in the outer repo's status**: their paths are hidden from the outer repo's list. "Stage all" excludes them with `:(exclude)inner/`, so they aren't added as gitlinks.
  - **Diff sources**: `show HEAD:path`, `show :path`, and the working file. These feed Monaco's DiffEditor, so no patch parsing is needed.
  - **Staging and discard**: `add`, `restore --staged`, `restore`. Discarding an untracked file uses `clean -f -- path` and asks for confirmation first.
  - **Commit**: `commit -m`.
  - **Branches**: list, create and delete with `branch`; `switch`.
  - **Sync**: `fetch`, `pull` (the user's pull config decides the strategy), `push`. `push -u origin HEAD` is used when the branch has no upstream.
  - **Worktrees**: `worktree list --porcelain`, `worktree add`, `worktree remove`.
  - `log -10 --oneline` supplies commit style examples for the AI.
  - A non-git project gets a card with no git lines and a `git init` button.
- `fs.rs`:
  - Files: `read_dir` (lazy, dirs first, hides `.git`), `read_file`, `read_file_bytes` (returns `tauri::ipc::Response`, used for images as blob URLs), `write_file`.
  - Config: `load_config` and `save_config`.
  - **Watcher**: `notify-debouncer-full` 0.7 via `new_debouncer_opt(..., NoCache, ...)`. The default file-id cache walks all of node_modules.
    - Watches each project root plus each worktree path (worktrees can live outside the root).
    - Events under ignored dirs are dropped in Rust.
    - Inside `.git/`, only HEAD, index and refs events count.
    - Events route to the innermost repo. Each repo refresh runs single-flight, with a trailing 300ms debounce.
    - Emits `fs-changed{root, paths}` and `repo-changed{repo}`.
- `ai.rs`:
  - API keys live in the macOS Keychain via `keyring` v4, using `keyring-core` + `apple-native-keyring-store` as its docs recommend. Keys are never sent to the webview. HTTP goes through `reqwest` (rustls).
  - `generate_commit_message(repo)` builds its input from:
    - the staged diff, or all changes if nothing is staged
    - truncated to about 60k chars, plus `--stat`
    - recent log lines as style examples
  - Providers:
    - Anthropic Messages API: `x-api-key`, `anthropic-version: 2023-06-01`, default model `claude-haiku-4-5`
    - OpenRouter chat completions: default model `anthropic/claude-haiku-4.5`
    
    The model can be changed in settings.

## Frontend — `src/`
Libraries:
- React + Vite + TS
- `zustand`
- `react-resizable-panels`
- `@xterm/xterm` with the fit and web-links addons, plus webgl as opt-in
- `monaco-editor` + `@monaco-editor/react`, bundled locally with `loader.config({ monaco })`. Workers come from `monaco-editor/editor/editor.worker?worker` (the path used by 0.57).
- `vscode-material-icons` for file icons. `// ponytail:` the package is stale (2024) but works; swap in `material-icon-theme` SVGs plus our own extension table if it breaks.
- `material-symbols` for UI icons (`outlined.css` only)
- `react-markdown` for markdown preview

Tauri config:
- `titleBarStyle: Overlay` + `hiddenTitle`, with the `core:window:allow-start-dragging` capability.
- The window `userAgent` includes `Safari`, so xterm applies its Safari workarounds (xterm #3575).

Files:
- `App.tsx`: layout is Left | Main tabs | Right, with the StatusBar at the bottom and a drag region at the top.
- `store.ts` (zustand) holds:
  - config, saved with a debounce
  - tabs
  - sessions `{id, name, scriptId?, projectId, status, exitCode, startedAt}`
  - the `scriptId → sessionId` map
  - git status cache per repo
  - memory stats
- `LeftPanel.tsx` + `ProjectCard.tsx` (reqs 1, 2, 6, 11, 12):
  - "Open folder(s)" uses the multi-select dialog.
  - Each project is collapsible and contains one card per repo or worktree. A card shows:
    - a dot: green = script running, red = last run failed, grey = idle
    - the name `project/relpath`
    - a badge: primary, nested or worktree
    - the branch with ↑↓ and the change count
    - an activity line, e.g. "dev running · 16m" or "build failed (1) · 3m"
  - Below the cards is the script list:
    - ▶/■ on each script, and a link icon on interlinked ones
    - "+ Add script", "Link script" and "Run all"
  - Clicking a script opens or focuses its terminal tab. Clicking a card makes it the active repo for the Git panel.
- `ScriptDialog.tsx`:
  - Fields: name, runner picker (runners not installed are greyed out), target or command.
  - The cwd defaults to the project root; a folder picker handles external scripts.
  - A "detected" list shows package.json scripts, Makefile targets and similar.
- `MainTabs.tsx`: tab strip with tab kinds terminal | editor | preview | diff. Single-clicking a file opens a reusable preview tab; double-clicking or editing pins it.
- `TerminalView.tsx`:
  - A registry `Map<sessionId, {term, el}>` lives outside React. Each xterm is opened once in its own div, and the div is moved into the tab when the tab is shown.
  - The DOM renderer is the default. WebGL is opt-in, used only on the active tab, and falls back on `onContextLoss`. WebKit caps live WebGL contexts at 16, and WebGL rendering is broken on macOS 26.5 (xterm #5816).
  - Scrollback is capped at 5000 lines.
  - An exited session shows a bar with the exit code and a Restart button.
- `EditorView.tsx`:
  - Monaco with Cmd+S save and a dirty dot.
  - On a watcher event, the file reloads only if the buffer is clean and the disk content differs. This keeps our own save from resetting the cursor and undo history.
  - For `package.json` (req 10): the lines of the `scripts` object get glyph-margin ▶ decorations. Clicking one opens ScriptDialog prefilled, with the runner taken from the lockfile.
  - Images preview via blob URLs; markdown via react-markdown.
- `DiffView.tsx`: Monaco DiffEditor.
- `RightPanel.tsx` (req 13): toggles between Files and Git.
  - `FileTree.tsx`: lazy tree with material icons and git status colors.
  - `GitPanel.tsx`:
    - repo picker (primary, nested or worktree)
    - branch dropdown (switch, create, delete)
    - staged and unstaged lists with stage, unstage and discard per file or for all
    - commit box with ✨ generate
    - commit, fetch, pull and push buttons
    - worktrees section (add, remove, open a terminal there)
- `StatusBar.tsx` (req 6.3):
  - Left: active project and branch.
  - Right: total memory, and a popover listing active terminals with name, project, memory and status. Click to focus, double-click to rename, and a kill button.
- `Settings.tsx` (reqs 7, 8):
  - Theme: dark, light or system. CSS vars live in `theme.css`, and the xterm and Monaco themes stay in sync.
  - Fonts: UI font, and mono font + size applied live to xterm and Monaco.
  - Terminal WebGL toggle.
  - AI: provider, model and key fields.
- Restore on launch: projects, tabs (terminal tabs come back stopped, with a Re-run button), panel sizes, and a "Re-run N scripts that were running" banner.

## Milestones (each ends runnable)
1. **Scaffold**: `bun create tauri-app` (React-TS), overlay titlebar, custom menu, CSP, 3 panels + status bar, theme + fonts, config load/save, env resolution.
2. **Projects, terminals, scripts**:
   - open folders and plain terminals with flow control
   - script CRUD with runners; run, stop, restart and run all
   - interlinked and external scripts
   - tabs, naming and rename
   - status bar terminal list + memory
   - quit confirmation and layout restore
3. **Files + editor**: tree + icons + watcher, Monaco edit/save, preview, package.json ▶.
4. **Git**: nested repo discovery, cards (including non-git), Git panel, diff tabs, commit, branches, push/pull/fetch, worktrees.
5. **AI commit messages**: keychain, providers, generate.

Deferred:
- Windows: portable-pty supports ConPTY; the mac-only bits (env resolution, session kill) are isolated in `lib.rs` and `pty.rs`
- hunk staging
- LSP
- running scripts inside worktrees (relative `cwd` already allows it)
- a daemon so terminals survive quit
- search in files
- tree virtualization
- auto-fetch

## Verification
- `cargo test` in `src-tauri`:
  - the porcelain v2 status parser and the worktree list parser, on fixture strings
  - the env marker parser
  - repo discovery on a temp dir containing a nested `git init` that the outer repo ignores
- `bun tauri dev`, manual end-to-end checks:
  1. Open 2 folders, quit and relaunch: both are restored, and theme and fonts are kept.
  2. Run a `bun run dev` script: output is colored. Stop it: the port is freed (`lsof -i :3000` is empty).
  3. In a plain terminal, start `sleep 999 &` and a dev server. Kill the terminal: no survivors (`pgrep sleep`).
  4. Run all: tabs are named `project · script`. Renaming from the status bar updates the tab.
  5. Link project A's script into project B: the running dot shows in both, and clicking it in B focuses the same tab.
  6. Memory per terminal roughly matches the summed `ps -o rss=` of its tree.
  7. Flood test: `yes | head -c 200000000` in a hidden tab keeps the UI responsive.
  8. With the project idle, the app sits near 0% CPU in Activity Monitor (no status refresh loop).
  9. A folder with a nested repo shows 2 cards with independent git panels. Stage all in the outer repo doesn't add the inner one.
  10. Edit a file: it shows as modified in the Git panel and opens in a diff tab. Stage, unstage, commit. Push and pull against a local bare remote (`git init --bare`). Cmd+S doesn't reset the cursor.
  11. Create and switch a branch. Add a worktree: a new card appears, and `pwd` in its terminal is correct.
  12. The package.json ▶ opens the dialog prefilled with the lockfile's runner.
  13. Cmd+W closes the tab, not the window. Cmd+Q with scripts running asks for confirmation.
  14. Generate a commit message with an Anthropic key, then with an OpenRouter key.
  15. `bun tauri build`, then launch from Finder: scripts find `node` and `bun`, and Unicode renders correctly.

---

## Implementation status (2026-09-29)
All 5 milestones implemented. Run: `bun tauri dev`. Tests: `cd src-tauri && cargo test`.

### Deviations from the plan
- **No `@monaco-editor/react`.** Monaco is driven directly (`src/lib/monaco.ts`), because the wrapper disposes models on unmount, which would lose unsaved edits on every tab switch. Models live in a module registry until their tab closes.
- **No project-root guard on fs commands.** `pty_spawn` already gives the webview arbitrary exec, so the guard would be theater. The real boundary is a strict CSP plus never rendering raw HTML. See the comment in `src-tauri/src/fs.rs`.
- **No `ai_has_key` command.** `settings.ai.keySaved` stores the flag in config, so opening Settings doesn't trigger a Keychain prompt.
- **Git refresh routing is in the frontend** (`handleFsChange` in `src/store.ts`); the backend only filters events.
- **`runningAtQuit` is written by the frontend** in the quit flow, not by Rust.
- **Undo/Redo are left out of the Edit menu** so ⌘Z reaches Monaco's own undo stack. Clipboard items stay.
- **Stopping via Stop is tracked as `stopped`**, shown neutral rather than as a failure.
- **Closing a plain-shell tab kills the shell.** Closing a script tab keeps the script running (reopen it from the sidebar).

### Verified
- `cargo test` (7 tests):
  - the env marker parser, the porcelain v2 and worktree parsers, the watch-event filter
  - nested-repo discovery (ignored inner repo, skips node_modules)
  - an end-to-end git flow on a temp repo: status hides the nested repo, stage-all doesn't create a gitlink, unstage, commit, diff sources, worktree add → discover → remove
  - PTY kill of zsh job-control background jobs
- A Playwright UI pass with mocked IPC covered layout, script run/stop, interlinked script state, the package.json ▶ → prefilled dialog, git panel, diff, AI generate, branch menu, terminals popover, settings, and light theme.
- Real app in WKWebView, dev and production bundles:
  - streamed PTY output, per-terminal memory, Stop frees the port with no survivors
  - login-shell env when launched via `open` (npm found, `LANG=en_US.UTF-8`)
  - watcher → git status refresh, Monaco + gutter ▶ under the production CSP

### Not verified / known gaps
- Manual visual QA on a real screen: resize, drag-collapse panels, WebGL toggle.
- Real push/pull against a remote, and AI calls with real keys.
- The Keychain prompt: unsigned dev builds prompt again after each rebuild.
- No app icon/branding (Tauri default icons). No code signing.
