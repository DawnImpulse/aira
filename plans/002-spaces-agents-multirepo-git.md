# Plan 002: Spaces, coding agents, per-repo Git, more AI providers

## Context
Today the sidebar auto-shows every discovered repo (primary, nested, worktree) as a card. The user wants a curated, Orca-like model:
- **Spaces** are opt-in working directories inside a project. The primary space is the project root.
- Each space shows its git status and the status of every coding agent running in it.
- Coding agents launch from the tab bar.
- The Git tab lists all repos, WebStorm-style, one color per repo.
- The IDE's own AI (commit messages) gains many providers.
- Right-click on files stops showing WebKit's "Inspect" menu.

Save this plan to `plans/002-spaces-agents-multirepo-git.md` before coding (repo convention).

Decisions from Q&A:
- **Folders:** "register as space" never moves files, and it has its own icon. **+** in Files creates a real file or folder.
- **Agents:** Claude Code, Codex, Gemini, OpenCode, Aider, Cursor Agent, Copilot CLI, Amp, Goose, Qwen Code, Crush, Droid, plus a custom command. Real logos.
- **Git tab:** a commit box per repo. It shows every repo found in the project, plus repos behind outside spaces.
- **Agent status:** comes from terminal activity.
- **Files root:** the selected space's folder.
- **Start with nothing ticked:** runs all scripts.
- **Worktrees:** become spaces only when added manually.
- **AI providers:** cloud APIs with a key, installed agent CLIs, local models, and a custom endpoint, all compliant with each provider's terms.
- **Libraries** (both MIT, React ≥18, no runtime dependencies):
  - `border-beam` 1.4.1: `<BorderBeam size colorVariant theme borderRadius strength active>`
  - `thinking-orbs` 0.3.2, canvas-based: `<ThinkingOrb state size={20|32|64} color theme paused>`

## Data model (`src/ipc.ts`; migrated in `normalize` in `src/store.ts`)
```ts
Space   { id, name, dir /*abs, required*/, icon?, color?, starred? }
Project { id, name, path, icon?, color?, scriptIds, startScriptIds: string[], spaces: Space[], collapsed? }  // extraRepos deleted
TermSnapshot += agent?                         // agent id; a term's space is DERIVED from cwd (innermost space dir), not stored
Settings.ai  = { provider, models: Record<providerId,string>, baseUrls: Record<providerId,string>, keySaved }
layout      += activeSpaceId: string|null, leftView: "projects"|"spaces"   // also added to DEFAULT_CONFIG.layout
```

`normalize` rules:
- `startScriptIds ??= []`.
- The primary space is the one with `dir === p.path`. Insert it if missing, and dedupe spaces by dir.
- Migrate old `ai {provider, model}`.
- `activeSpace()` falls back to the active project's primary space when `activeSpaceId` belongs to another project or is missing.

`saveNow` builds term snapshots with an explicit field pick, so add `agent` to that pick (`store.ts:163`).

## Store (`src/store.ts`)
**New helpers**, following the `updateConfig` pattern:
- `activeSpace()`, `spaceOfPath(path)` (innermost space containing the path)
- `setActiveSpace(projectId, spaceId)`, which replaces `setActiveProject(id, repo)`
- `addSpace(projectId, {name, dir, icon, color})`: dedupes by dir, then calls `discover` and `syncWatch`
- `removeSpace` (with `ask` confirm; primary blocked)
- `updateSpace`, `updateProject(id, patch)` (which replaces `renameProject`), `toggleStar`, `toggleStartScript`

**`discover(projectId)`** calls `git_discover(project.path)` plus `git_discover(space.dir)` for spaces outside the project, merged and deduped.
- **Keep every kind in `repos`**, including worktrees. `excludesFor`, `repoOf`, the worktree refresh in `handleFsChange` and `syncWatch` all depend on that, and it stops a worktree from being staged as a gitlink.
- The Git tab filters out worktree repos that aren't spaces.

**`syncWatch`** watches:
- project roots
- dirs of spaces outside the project
- `<repo>/.git` for any enclosing repo above an outside space, never the whole enclosing root (it could be `$HOME`)

**`spaceStatus(space)`**:
- uses the `repoOf(dir)` status
- for a subfolder space, it filters files under `dir`, and also counts collapsed untracked entries (`packages/`) whose path contains the dir

**Consumers to update** (from the review):
- `store.ts:197` `addProject`: create the primary space and `startScriptIds: []`
- `:249` `discover`
- `:457` ⌘T: use the active space's dir
- `App.tsx:14` TitleBar, `StatusBar.tsx:8`: use `repoOf(activeSpace().dir)`
- `Editors.tsx:70`: use `repoOf(savedPath)`
- `ScriptDialog.tsx:172`: move to the new `newTerminal(projectId, opts)` signature
- `GitPanel.tsx:13-14,79,332,336`
- `LeftPanel.tsx:44,56,71,72,97,100,108,147,186`
- `RightPanel.tsx:33`: key the tree by `space.dir`, not `project.id`, so it doesn't keep a stale tree

**zustand 5:** never return freshly built arrays from selectors (e.g. starred spaces). Select raw state and derive in render, or use `useShallow`.

## Agents
**`src/lib/agents.ts`** (new): `{ id, label, bin, command, icon, color }`.
- `bin` is the executable name checked on PATH (e.g. `goose` for `goose session`).
- `availableAgents()` checks installs via `api.which`, cached like `availableRunners` in `src/lib/runners.ts`.
- CLI names and flags are verified against each tool's docs while implementing.

**Brand icons**, vendored into `src/assets/agents/*.svg` with a `NOTICE` file for the MIT attribution (instead of adding the 2.4 MB icon package):
- From `@lobehub/icons-static-svg` 1.95.1:
  - color: `claudecode-color`, `codex-color`, `geminicli-color`, `amp-color`, `qwen-color`
  - mono, rendered with `currentColor` in the theme's text color: `githubcopilot`, `cursor`, `opencode`, `goose`
- From official sources:
  - Aider: an aider.chat mark (the site logo is a wordmark, so use the favicon or crop the mark)
  - Crush: the Charm logo
  - Droid: `factory.ai/favicon.svg`
- Fallback when there's no square mark: a colored monogram.

**`src/lib/terminals.ts`:**
- `newTerminal(projectId, opts {cwd, command, label, agent})`
- `runStart(projectId)` runs `startScriptIds ∩ scriptIds`, or all scripts if that's empty. It replaces `runAll`.
- **Activity tracking:**
  - `lastOut[key]` is set in the Channel `onmessage` (`terminals.ts:154`).
  - `lastIn[key]` is set in `term.onData` (`:81`) **and** `term.onResize` (`:85`); a resize makes the agent redraw, and that redraw shouldn't count as work.
  - A 1s interval runs over running agent terms. A term only counts as working after some input has been recorded: `working = lastIn && now - lastOut < 1500 && lastOut - lastIn > 500`.
  - Results go to a separate store key, `agentStatus[key] = { state, since, everWorked }`, written only when changed. It stays out of `terms`, so it doesn't trigger config saves.
  - `// ponytail:` note: heuristic; the upgrade path is Claude hooks.

**Tab bar** (`MainTabs.tsx`): a sticky **+** at the end opens a popover:
- installed agents first, with logos; missing ones dimmed "not installed"
- New terminal
- Custom command…

It opens a terminal in the active space's dir. Agent tabs show the agent's logo, or an orb while it's working.

## Thinking orbs
- Agent row on a space card, and the agent tab icon: `working` in the brand color while Working. Idle shows the static logo.
- Git Generate busy: `composing`. Fetch/pull/push busy: `connecting`. Repo scanning: `searching`.
- Welcome screen: a 64px `breathing` orb.
- Not used on script rows (too many canvases).
- `paused` when `prefers-reduced-motion` is set; `theme` follows settings.

## Left panel (`src/components/LeftPanel.tsx`, rewritten)
**Header:** segmented **Projects | Spaces**, plus Open folder.

**Project view:**
- Header row: project icon/color and name (double-click rename stays), then:
  - ▶ Start (the start set)
  - add space: dialog; its folder picker defaults to the project path and can browse outside it
  - terminal, in the active space
  - ⚙ opens the project dialog
  - remove
- Space cards, then scripts. Each script row gets an "Include in Start" checkbox toggle.

**`SpaceCard`** (compact), also used by the Spaces view so the beam and agent rows appear there too:
- Row 1: colored icon, name, ☆/★ on the right.
- Row 2: branch, ↑↓, N changed, and a green dot if a script in the space is running (scripts map to spaces by cwd).
- One row per agent terminal whose cwd is in the space: logo or orb, "Claude · Working", "Done" (idle after work), "Idle" or "Exited", then age.
- No repo: "Initialize git".
- Hover shows ⚙, plus remove on nested spaces.
- Unselected: flat, no background or border. Selected: background, border, and one `BorderBeam` (`size="line"`, `colorVariant="ocean"`, `theme` from settings, `borderRadius={10}`, `active={!reducedMotion}`).

**Spaces view:** starred spaces from all projects, each labeled with its project. Clicking one activates both project and space. Empty state: "Star a space to pin it here".

## Dialogs
**`SpaceDialog.tsx`** (new, built on the `Modal` in `ui.tsx`):
- Modes: add space, edit space, edit project.
- Fields:
  - name
  - dir: spaces only, required, set with Choose…
  - an icon grid of ~24 material symbols
  - 10 color swatches, plus none
- Remove: nested spaces only, with confirm.

## Files panel (`src/components/RightPanel.tsx`)
- Root is the active space's dir.
- The header **+** gives New File… / New Folder…. Folder rows show on hover:
  - **+**: new file or folder inside
  - a **workspaces** icon, "Add as nested space": confirms with `ask`; hidden if the folder is already a space
- Right-click opens a **native** menu via `@tauri-apps/api/menu` (`Menu.new({items}).popup()`; `core:default` already allows popups). Items:
  - New File…
  - New Folder…
  - Add as Nested Space
  - Open Terminal Here
  - Reveal in Finder
  - Copy Path

  Menu details:
  - Item ids are prefixed `ctx:`, and `lib.rs` `on_menu_event` ignores `ctx:*`, so the app menu isn't triggered twice.
  - Keep the previous `Menu` and `close()` it before building a new one.
  - Actions are closures over the clicked path.
- **New-path modal**: a name input that rejects `/` and empty names. It calls `api.createPath`, then opens the file.
- **Backend** (`src-tauri/src/fs.rs`, registered in `lib.rs`):
  - `create_path(path, dir)`: `create_dir`, or `OpenOptions::create_new` for files. Errors if the path exists.
- **`src/main.tsx`**: a global `contextmenu` listener calls `preventDefault`, except inside `input`, `textarea`, `.monaco-editor` and `.xterm`, or when some text is selected (so Copy still works on selections).

## Git tab (`src/components/GitPanel.tsx`), WebStorm-style
- The repo `<select>` goes away. One outer scroll holds a collapsible **RepoSection** per repo: the non-worktree repos, plus worktree repos that are spaces.
- Each section:
  - a colored left bar and dot: the space's color if `space.dir === repo.path`, otherwise palette[i]
  - labeled by the space name, else the path relative to the project
  - header: `BranchMenu`, fetch ↓↑, change count
  - expanded by default: `open ?? files.length > 0`
- Each section has **its own commit box**: Generate per repo, plus Commit / Commit all and the staged/changes/conflicts `FileSection`s. This reuses the `RepoGit` internals, but drops their inner `.scroll`.
- **Worktrees** list per section (existing component, with `main = repo.parent ?? repo.path`): add/remove as today, plus **"Add as space"**. Its row click now activates the space if there is one.

## AI providers (commit messages)
- **Where it lives:**
  - The provider table is in `src/lib/aiProviders.ts`.
  - The backend (`src-tauri/src/ai.rs`, refactored) takes a config `{kind: "anthropic"|"openai"|"cli", baseUrl?, keyId?, model, cli?}`.
  - New command `ai_list_models(cfg)`.
- **Cloud, with key** (Keychain, per provider):
  - **Anthropic:** native Messages API (`x-api-key`, `anthropic-version: 2023-06-01`).
  - **OpenAI** (GPT/Codex models): `https://api.openai.com/v1`.
  - **Gemini:** Google's official OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`.
  - **OpenRouter:** `https://openrouter.ai/api/v1`, with its documented `HTTP-Referer` / `X-Title` headers.
  - **Groq, Mistral, DeepSeek, xAI:** their official OpenAI-compatible base URLs.
  - All non-Anthropic providers share one `chat/completions` path.
- **Local, no key:**
  - Ollama: `http://localhost:11434/v1`
  - LM Studio: `http://localhost:1234/v1`
- **Custom:** any OpenAI-compatible base URL, an optional key, and a model.
- **Installed CLIs**, in each tool's documented non-interactive mode, and only when found on PATH:
  - `claude -p`, `codex exec`, `gemini -p`; others (opencode, qwen, cursor-agent, copilot) only if their headless flags check out in their docs
  - The prompt goes via stdin where supported. The process runs in the repo dir with a 120s timeout and the login-shell env.
- **Models:** from the provider's official `GET /models`. The combobox allows free text, so no model id is hard-coded.
- **Compliance:**
  - official endpoints and auth only; keys go in headers, never in URLs
  - never reads a CLI's stored OAuth/session tokens
  - a diff is sent only on an explicit Generate click
  - Settings shows "Diff will be sent to <provider>", or "stays on this machine" for local and CLI
  - 429 and quota errors are surfaced without retry loops
  - `User-Agent: IDE/<version>`
  - keys never reach the webview or logs
- **Settings UI:**
  - a provider select grouped Cloud / Local / CLI / Custom
  - model combobox with a refresh button
  - a base URL field (local/custom)
  - a key field (cloud/custom)
  - the privacy note

## Dependencies
`bun add border-beam thinking-orbs`

## Critical files
- `src/ipc.ts`, `src/store.ts`, `src/lib/terminals.ts`
- New: `src/lib/agents.ts`, `src/lib/aiProviders.ts`, `src/assets/agents/`, `src/components/SpaceDialog.tsx`
- Components: `LeftPanel.tsx`, `MainTabs.tsx`, `RightPanel.tsx`, `GitPanel.tsx`, `SettingsDialog.tsx`, `ScriptDialog.tsx`, `StatusBar.tsx`, `Editors.tsx`
- `src/App.tsx`, `src/main.tsx`, `src/styles.css`
- `src-tauri/src/fs.rs`, `ai.rs`, `lib.rs`

## Verification
- `bunx tsc --noEmit`, `bun run build`
- `cargo test`:
  - `create_path`: creates a file and a dir; a second create errors
  - OpenAI-compatible request/response shaping against a local mock HTTP server (`std::net::TcpListener`)
  - the CLI path with a fake `claude` on PATH that echoes stdin
- Playwright with mocked IPC (scratchpad `pw/`, mock extended with `create_path`, `ai_list_models`, `plugin:menu|*`):
  1. An old config migrates to a primary space only; no nested cards.
  2. Folder "Add as nested space": confirm, a card appears, selecting it moves the Files root. Remove it with confirm.
  3. A space inside a worktree still shows git status.
  4. Star a space: it appears in Spaces view (same SpaceCard); clicking it activates the right project.
  5. Only the selected card has a background and the beam.
  6. Agent **+** → Claude spawns `command: "claude"` with cwd = the space dir.
     - Mock output every 100ms after input gives "Working"; silence gives "Done"; exit gives "Exited".
     - A resize alone never shows Working.
     - Two agent tabs give two rows.
  7. Start set: tick 2 of 3; Start spawns exactly those 2. Untick all; Start spawns 3. Unlinked scripts are skipped.
  8. Git tab: 2 repos give 2 colored sections. Commit in one calls `git_commit` for that repo only. Stage all never includes a nested worktree path.
  9. New File from **+**: `create_path` is called and the tab opens. A row right-click calls menu popup. Right-click on empty space is `defaultPrevented`; on selected text it isn't.
  10. The space/project dialog's icon, color and name are reflected on the card.
  11. The agent popover shows every logo with no 404s. An orb canvas appears while Working and on Generate busy; none on script rows.
  12. AI settings: each provider kind shows the right fields and the privacy note; the models come from the mock.
- Real app smoke (`bun tauri dev`):
  - the native file menu appears, with no Inspect
  - `claude` launches in the space dir
  - Generate works via `claude -p` or Ollama, if installed
  - the beam and orbs don't spike CPU (Activity Monitor)

---

## Implementation status (2026-09-30)
Implemented as planned. Tests: `cd src-tauri && cargo test` (12 tests).

### Deviations / additions
- **Agent CLIs for commit messages** are limited to the four whose headless mode was verified against docs or `--help`:
  - `claude -p` (diff on stdin)
  - `codex exec --ephemeral --skip-git-repo-check -o <tmp>` (read-only by default; diff on stdin)
  - `gemini -p --approval-mode plan`
  - `opencode run <msg>`

  Qwen, Cursor Agent and Copilot are available as coding agents, but not as commit-message providers yet.
- **Codex and Qwen** are listed as coding agents but weren't installed here, so their commands weren't tried.
- **Copy Path** uses a small `copy_text` command (`pbcopy`), because the web clipboard API refuses writes from native-menu actions.
- **Crush logo:** Crush has no square mark, so it uses Charm's logo. **Aider logo:** from Aider's site app icon. Attribution is in `src/assets/agents/NOTICE.md`.
- **Mono logos** (OpenCode, Cursor, Copilot, Goose) render as CSS masks in the theme text color. The mask URL must be quoted, because Vite inlines small SVGs as `data:` URIs.
- **Agent CLI privacy note:** the Settings note for agent CLIs says the diff goes to the CLI's own provider under the user's account, not that it "stays on this machine".

### Verified
- `cargo test`:
  - `create_path` never overwrites
  - OpenAI-compatible request shape: path, Bearer auth, User-Agent
  - no key means no auth header
  - Anthropic 429 message surfaced
  - CLI receives the diff on stdin, and ANSI codes are stripped
  - earlier tests for git, PTY and env still pass
- Playwright with mocked IPC (dev server, and the production build served with the app's exact CSP):
  - pre-002 config migrates to a primary space only
  - add a nested space from Files (with confirm): the Files root follows the selected space
  - star → Spaces view
  - only the selected card has the beam
  - agent launcher: 14 entries, no broken logos
  - `claude` spawns in the space dir
  - a resize alone stays Idle; typing then streamed output gives Working (orb in the card and the tab); silence gives Done; exit gives Exited
  - start set runs exactly the ticked scripts
  - 2 colored repo sections; commit goes to one repo only
  - Generate shows the `composing` orb and sends the provider config
  - New File → `create_path`
  - native row menu; the default menu is suppressed elsewhere
  - space dialog: icon, color, name
  - AI settings fields for local / CLI / cloud
  - old AI settings migrate
  - zero CSP violations

### Not verified
- Real native popup menu rendering, the beam and orbs in WKWebView, and CPU use. These need a look on screen.
- A real Generate via a cloud key or an agent CLI; that costs tokens on your account.
- Launching a real `claude` session in the space.

### Follow-up: provider terms review (2026-09-30)
Every AI provider's current terms and data-use pages were reviewed; see `docs/ai-providers.md` for the table and sources. Changes made:
- **Per-provider notes:** accurate data-use notes with a risk level (ok / caution / warning), color-coded in Settings.
- **First-send confirmation:** caution and warning providers must be acknowledged once before the first Generate (`settings.ai.acknowledged`).
- **OpenRouter headers:** attribution now uses `X-OpenRouter-Title`. The made-up `HTTP-Referer` URL was removed.
