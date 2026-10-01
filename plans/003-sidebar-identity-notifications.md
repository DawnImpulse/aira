# Plan 003: Sidebar polish, project identity, agent notifications, fonts, tooltips

## Context
User feedback on the plan-002 sidebar (screenshot: two projects, Angeles and cloudvry) asked for these changes:
- **Grouping:** a clearer visual grouping per project, plus a project-level beam only while an agent works.
- **Project identity:** distinct colors and icons per project, an image icon, a richer settings dialog.
- **Spaces and scripts:** simpler spaces (no icon or color), aligned bold headings.
- **Agents:** renamable agent tabs, a plain spinner instead of thinking orbs, macOS notifications.
- **Settings and UI:** more fonts, hover tooltips, a Git tab that shows only changed repos.

Save as `plans/003-sidebar-identity-notifications.md` before coding (repo convention).

Decisions from Q&A:
- **Project bar:** on the **left**, as a bracket that wraps the top and bottom corners. Starred-space cards get the same left bar in their project's color.
- **Beam:** around the whole project block, only while one of its agents is **Working**.

## 1. Sidebar (`src/components/LeftPanel.tsx`, `src/styles.css`)
- **Project block:**
  - `<section class="project" style="--project-color">`.
  - A `::before` bracket runs from the header down through the spaces to the scripts: `border-left` plus short top and bottom ticks with rounded corners.
  - The heading gets bigger (16px, weight 700). The header icon and name use the project color.
- **Header actions:** ▶ Start, add space, ⚙.
  - The **New terminal** button is removed (⌘T still works).
  - **Remove project** moves into the project dialog.
- **Beam:** the selected space card no longer has one. `BorderBeam` wraps the whole project section when any agent terminal in the project has `agentStatus.state === "working"`.
- **SpaceCard:** no icon and no color. Selected = background plus a project-color border. The title is bold.
- **Agent rows:**
  - One row per agent terminal, sorted by start time and stacked vertically.
  - The label is the terminal's **name**, so renames show up. Status reads Working / Done / Idle / Exited.
- **Scripts:** the "Scripts" sub-head lines up with the space titles and is bold, in the project color.
- **Project color applied** to:
  - the start-set checkboxes
  - the script-row hover tint
  - the selected space border
  - the bracket
  - the header icon
  
  Semantic colors stay as they are: green = running, red = failed.
- **Spaces view:** each starred card gets a project-color left bracket and its project name.

## 2. Project identity (`src/store.ts`, `src/ipc.ts`, `src/components/SpaceDialog.tsx`)
- `Project.icon` becomes `{ type: "symbol" | "emoji" | "image"; value: string }`:
  - symbol: a material symbol name
  - emoji: one emoji
  - image: an absolute path to a png/svg inside the project
  - `normalize` migrates the old string `icon` to `{ type: "symbol" }`.
  - Spaces drop `icon` and `color`; `normalize` deletes them.
  - The **space dialog** has only name and folder.
- `PROJECT_COLORS`: 24 swatches. `PROJECT_ICONS`: about 80 material symbols.
- `addProject` picks the **first color and icon not used by any existing project**, cycling once all are taken.
- **Project dialog:**
  - **Preview:** the chosen icon or image, in the chosen color, sits **left of the name input**. Icon tiles and the image preview use the selected color.
  - **Icon type:** a segmented **Icon | Emoji | Image** control picks the type.
  - **Icon:** 3 rows (30 icons) visible; a collapsible **"More icons"** section holds the rest, collapsed by default.
  - **Emoji:**
    - a grid of about 40 common emojis, same layout: 3 rows visible, the rest under **More**
    - an input for any emoji: type, paste, or ⌃⌘Space for the macOS picker
    - it is validated as a single grapheme with `Intl.Segmenter`
  - **Image:** "Use image from project…" opens a file picker (`png`/`svg`, defaulting to the project path). The path is rejected unless it's inside the project.
  - **Colors:** 24 swatches plus a default.
  - **Remove project:** a danger button that calls the existing `removeProject` (with confirm).
- **`ProjectIcon` component** (`ui.tsx`):
  - **image:** via `api.readFileBytes`, turned into a blob URL (SVG as `image/svg+xml`, cached per path)
  - **emoji:** as text
  - **symbol:** a material symbol in the project color
  - Used in the header, the Spaces view and the dialog preview.
  - Auto-assignment for new projects always picks a symbol.

## 3. Agents (`src/lib/terminals.ts`, `src/components/MainTabs.tsx`)
- **Thinking orbs removed:**
  - `bun remove thinking-orbs`; delete `Orb`.
  - A CSS `.spinner` (a 12px ring in currentColor, respecting reduced motion) replaces it on agent rows, agent tabs, Generate, fetch/pull/push and scanning.
  - The welcome screen goes back to a static icon.
- **Rename agent tabs:**
  - Right-clicking any tab opens a native menu (via the existing `popupMenu` in `src/lib/menu.ts`): **Rename…** (starts the existing inline rename; `renameTerm` already exists), **Close**, **Close others**.
  - Double-click rename stays.
- **Notifications** use `tauri-plugin-notification` 2.5.1 (Rust plugin + `@tauri-apps/plugin-notification`, capability `notification:default`). Triggers, for agent terminals only:
  - Working → idle after at least 4s of work: "‹name› finished · ‹space›".
  - The xterm `onBell` event, debounced 10s: "‹name› needs your input" (agent CLIs ring the bell when they wait).
  - Process exit: "‹name› exited (code)".
  - A notification is sent only when the window isn't focused or that terminal's tab isn't the active one.
  - Settings toggle "Notify when agents finish or need input" (on by default). Permission is requested on first use.

## 4. Settings (`src/components/SettingsDialog.tsx`, `src-tauri/src/fs.rs`)
- **Fonts:**
  - New command `list_fonts() -> { all, mono }` (macOS) using the `core-text` 22 crate: `create_for_all_families().get_descriptors()`, then `family_name()` + `traits().symbolic_traits().is_monospace()`, deduped and sorted.
  - The UI font becomes a searchable select over all installed families. The editor/terminal font becomes a select over monospace families.
  - The current value always stays selectable, and a curated fallback list is used if the call fails.
- **Keychain:**
  - Already true: every provider key goes through `ai_set_key` → `keyring` v4 → macOS Keychain (service `com.codevry.ide`, account = provider id). The config only stores `keySaved` booleans.
  - Settings states "Stored in your macOS Keychain; never written to disk by the IDE."
  - Verify with `security find-generic-password -s com.codevry.ide` (no `-w`, so the secret isn't shown).

## 5. Tooltips (`src/main.tsx` + `ui.tsx`)
WKWebView doesn't reliably show native `title` tooltips, so a single global implementation handles them:
- On `pointerover`, the nearest `[title]` has its title moved to `data-tip`, which suppresses the native tooltip.
- After 350ms a styled `.tip` element is shown below the element (above it when space is short).
- It hides on pointerout, scroll, mousedown and Escape.
- Every `IconButton` and titled element gets this with no per-component changes. Titles are added where missing (status dots, agent rows, chips).

## 6. Git tab (`src/components/GitPanel.tsx`)
- Only repos with working-tree changes (`files.length > 0`) get sections.
- A footer "‹N› repos with no changes · Show" (collapsed by default) reveals the rest, so branch, pull and worktree tools stay reachable.
- When nothing has changed: "No changes in any repository", plus the same Show link.

## Dependencies
- `cargo add tauri-plugin-notification@2 core-text@22`
- `bun add @tauri-apps/plugin-notification`
- `bun remove thinking-orbs`

## Critical files
- `src/components/LeftPanel.tsx`, `SpaceDialog.tsx`, `MainTabs.tsx`, `GitPanel.tsx`, `SettingsDialog.tsx`, `ui.tsx`
- `src/store.ts`, `src/ipc.ts`, `src/lib/terminals.ts`, `src/main.tsx`, `src/styles.css`
- `src-tauri/src/fs.rs`, `lib.rs`, `Cargo.toml`, `capabilities/default.json`

## Verification
- `bunx tsc --noEmit`, `bun run build`
- `cargo test`, plus a `list_fonts` test: non-empty, and Menlo is in `mono` but not Helvetica.
- Playwright with mocked IPC (scratchpad `pw/`; mock adds `list_fonts`, `plugin:notification|*`, `read_file_bytes` for an svg):
  1. Each project shows a left bracket in its color. A newly added project gets a different color and icon than the existing ones.
  2. Agent mocked Working: the project section is wrapped by the beam. When it's idle there's no beam anywhere.
  3. Space cards have no icon or color; the Scripts heading lines up with the space title and is bold.
  4. Project dialog:
     - icon preview next to the name, in the selected color
     - 30 icons visible, the rest behind More
     - choosing an image from inside the project renders an `<img>`; one outside is rejected
     - picking an emoji from the grid, or typing one, shows it in the header; multi-character input is rejected
     - Remove project asks for confirmation
  5. Right-click a tab, Rename…: the name updates on the tab and the agent row.
  6. With `document.hasFocus` mocked false: a working→idle agent gives a "finished" notification, a bell gives "needs your input", exit gives "exited".
  7. Hovering a header icon shows a `.tip` with its title, and no native title is left.
  8. Git tab: clean repos are hidden behind "Show".
  9. Settings font selects are filled from the mocked `list_fonts`.
  10. Agent rows use a `.spinner`, and no canvas exists anywhere (orbs gone).
- Real app smoke (`bun tauri dev`):
  - a notification appears after an agent finishes, with the window unfocused
  - the font lists show installed fonts
  - tooltips appear
  - `security find-generic-password -s com.codevry.ide` lists saved providers

---

## Implementation status (2026-10-01)
Implemented as planned. `cargo test`: 14 tests, plus an on-demand `keychain_roundtrip`.

### Notes
- **Font listing:** `list_fonts` uses only CoreText calls that can't panic: family names, then `new_from_name(..).symbolic_traits().is_monospace()`. `CTFontDescriptor::traits()` asserts, and release builds use `panic = "abort"`, so it is avoided.
- **Identity migration:** projects created before 003 get distinct colors and icons when the config loads. The palette is 24 hues 15° apart, and auto-assignment steps 75° at a time so neighbours look clearly different.
- **Spinner and reduced motion:** with reduced motion on, the spinner slows down instead of stopping, so activity stays visible.
- **Notifications:** sent through the plugin's `window.Notification` bridge.
- **Notification deduplication:** finish, bell and exit are deduplicated per terminal (5s; 10s for bells), and none is sent while that agent's tab is focused.
- **Keychain:** verified with an on-demand test (`cargo test -- --ignored keychain`). It writes a throwaway entry, `security find-generic-password` sees it, then it is removed. The config only holds `keySaved` booleans.
- **Dev server:** adding `@tauri-apps/plugin-notification` while `bun tauri dev` was running left Vite's pre-bundled dependencies stale ("504 Outdated Optimize Dep"). Restart `bun tauri dev` once.

### Verified
Playwright with mocked IPC, run against the production build served with the app's exact CSP:
- **Brackets and identity:**
  - project-color brackets; a newly added project gets a different color
  - spaces have no icon; Scripts lines up exactly with the space titles and is bold
- **Header and tooltips:**
  - header actions are now Start, Add space and Settings
  - styled tooltips, with the native `title` removed
- **Project dialog:**
  - preview left of the name; 30 icons, 103 after More
  - emoji validation; an emoji or an image from the project shows in the header; an image outside the project is rejected
- **Agents:**
  - tab rename via right-click shows in the tab and the agent row
  - a spinner (no canvas anywhere)
  - the beam only around the project whose agent is working, and it goes away when idle
  - notifications for bell, finish and exit
- **Git:** only changed repos, with "N repos with no changes · Show"
- **Settings:** font lists come from `list_fonts`

### Not verified
On-screen look in WKWebView, a real macOS notification banner, and real installed-font lists in the app.

## 7. Nested subagents for Claude Code (added 2026-10-01)
The user asked to show the subagents a Claude agent spawns, nested properly: main → subagent → sub-subagent.

**Mechanism:** Claude Code's documented hooks (https://code.claude.com/docs/en/hooks), injected only for sessions the IDE launches:
- `claude --settings <app-data>/claude-hooks.json`. The flag merges with the user's own settings; their files are never touched.
- Hooks registered: `PreToolUse` and `PostToolUse` (matcher `Agent|Task`), `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Notification`.
- The hook command writes its stdin JSON to its own file in `$IDE_AGENT_EVENTS`, a per-terminal directory: `mktemp`, write, then `mv` to `*.json` so readers only ever see complete files. It prints nothing and always exits 0, so it never affects Claude.
- `pty_spawn` gains an `env` map, used to set `IDE_AGENT_EVENTS`.

**Backend commands:**
- `agent_hooks_settings()`: writes the settings file and returns its path
- `agent_events_dir(key)`: creates the per-terminal directory
- `agent_events(dir)`: reads complete event files ordered by modification time (nanoseconds), deletes them, and returns the JSON
- the directories are cleared when a terminal is removed, and the whole events folder at startup

**Tree building** (`src/lib/terminals.ts`, inside the existing 1s ticker, Claude terminals only):
- A `PreToolUse(Agent)` event records a pending spawn: caller = `agent_id`, or the main agent if absent; plus the description and type.
- `SubagentStart` creates a node: id = `agent_id`, type from the event. It takes the first pending spawn with the same type (FIFO) for its parent and description.
- `PostToolUse(Agent)` confirms the parent edge: caller `agent_id` → `tool_response.agentId`.
- `SubagentStop` marks the node done.
- **Main-agent status:** `UserPromptSubmit` = Working, `Stop` = Done, `Notification` = Needs input (this also triggers the macOS notification). Hook status overrides the activity heuristic for Claude; other agents keep the heuristic.
- A new prompt clears finished nodes.

**UI:** under each Claude agent row, an indented tree with guide lines. Each node shows type · description, a spinner or check, and its age. Nesting is shown to any depth (Claude allows 3 levels by default).

**Compliance:**
- Hooks and `--settings` are documented features. The user's unmodified binary and own login are used.
- Event files stay on the machine and are deleted as soon as they're read.

### Section 7 status (2026-10-01)
Implemented.
- **Rust tests:** `agent::tests` runs the real hook shell command, checks events are read in order and then consumed, and checks the hook registrations.
- **Playwright** (scripted hook events, production build with CSP):
  - Launch command: `claude --settings '<hooks file>'` with `IDE_AGENT_EVENTS` set.
  - Tree: main → Explore → general-purpose (nested, indented), plus a parallel Plan subagent.
  - Done marks, then "Needs input" (with a notification), then "Done".
  - A new prompt clears finished subagents.
- **Not verified:** a live Claude session, which would spend tokens on the user's account.
