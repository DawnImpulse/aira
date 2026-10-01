# Plan 007: Per-space windows, project bar, sidebar/git polish

## Context
User feedback, 2026-10-01. Main tabs and the right panel are global today: switching spaces keeps the same tabs, and the Files/Git choice, tree expansion and commit draft leak between spaces. Each **space** should have its own main and right windows, remembered. A tinted bar over main + right should show which project you're in. The rest are small visual fixes, a ScriptDialog simplification, and a folder-picker fix.

Step 0: save this plan as `plans/007-space-windows-project-bar.md` (repo convention), then implement.

## 1. Per-space main + right windows (`src/ipc.ts`, `src/store.ts`)
Swap model. The active space's view stays in `layout.tabs` / `activeTab` / `rightView`, so `MainTabs`, `openFile`, `openDiff`, `closeTab` and `Editors` are untouched. Every other space's view waits in a new `layout.views`.
- `ipc.ts`: add `interface SpaceView { tabs: Tab[]; activeTab: string | null; rightView: "files" | "git" }` and `layout.views: Record<string, SpaceView>` (spaceId → view). The Rust side stores config as untyped JSON, so no Rust change.
- `store.ts`:
  - `DEFAULT_CONFIG.layout.views = {}`.
  - New `showSpace(c, projectId, spaceId)`:
    - stashes the current view under the old `activeSpaceId`, only if that space still exists
    - loads `views[spaceId]`, or an empty view if there's none (`rightView: "files"`)
    - deletes the loaded entry and sets both active ids
  - Every write of `activeProjectId` / `activeSpaceId` goes through `showSpace`: `setActiveSpace`, `addProject`, `addSpace`, `removeSpace` (falls back to the primary space and drops `views[id]`), and `removeProject` (falls back to the first project's primary space and drops its spaces' views).
  - `normalize`:
    - resolve `activeSpaceId` to a real space (the active project's primary space) **without** swapping, so existing tabs migrate into the current space
    - drop views of unknown spaces
    - filter dangling terminal tabs in every view
  - `saveNow`: the terminal snapshot keys come from the tabs of the active view **and** every stashed view, so background spaces' terminals persist.
  - Export `dropTab(view, id)`, which removes a tab and makes its neighbour active (the existing `closeTab` splice logic). `closeTab` uses it.
  - New `focusTerminal(key)`:
    - finds the space whose view holds `term:key`, checking the active view, then `views`, then `spaceOfPath(cwd)`
    - selects that space, then calls `openTerminalTab`
- Rule: **tabs always open in the active space; anything acting for another space selects it first.** Callers to fix:
  - `lib/terminals.ts`:
    - `runStart(projectId)` calls `setActiveProject(projectId)` first
    - `removeTerm(key, true)` runs `dropTab` over the active view and every view (a shell that exits in a background space leaves no dangling tab)
  - `LeftPanel.tsx`:
    - `AgentRow` click calls `focusTerminal`
    - `ScriptRow` Run/Restart call `setActiveSpace(project.id)` first
  - `StatusBar.tsx`: `TermRow` click calls `focusTerminal`.
- `RightPanel.tsx`: every space visited this session stays mounted, hidden with the `hidden` attribute, so tree expansion, scroll position and the commit draft survive switching. Each body renders `FileTree` or `GitPanel` from its own `rightView` (the active space's comes from `layout`, the others' from `views`). Add a `ponytail:` comment: one tree or panel per visited space; evict the least recently used if that gets heavy.
- `GitPanel.tsx`: take a `space` prop instead of `useStore(selectActiveSpace)`, so hidden panels default-select their own space's repo. Git content stays project-wide.
- CSS: `.right-body { flex:1; min-height:0; display:flex; flex-direction:column }` plus `.right-body[hidden] { display:none }`.

## 2. Project bar over main + right (`src/App.tsx`, `styles.css`)
- Nested layout:
  - the outer `Group` holds `left | work`
  - `work` = `ProjectBar` + an inner `Group` holding `main | right`
  - new `useDefaultLayout` ids (`outer-layout`, `work-layout`); sizes reset once
  - `right` keeps `panelRef` (⌥⌘B still works) with `defaultSize="28%"`
- `ProjectBar`: about 26px tall, with background `color-mix(project-color 16%, panel)` and a bottom border tinted with the project color. It shows `ProjectIcon`, the project name › the space name, then the branch (the logic moved over from `TitleBar`). It renders nothing when there's no project.
- `TitleBar` drops its centre text and keeps the drag region and actions.

## 3. Sidebar and git visuals (`styles.css`, `LeftPanel.tsx`)
- **Project bracket:** `.project::before` becomes a plain vertical bar (`width:3px; border:0; border-radius:2px; background: var(--project-color)`), keeping the symmetric top/bottom so it still centres on a collapsed project. The Spaces tab's `.starred-space` wrap stays as it is.
- **Hover:** add `border-radius: 8px` to `.project-head`.
- **Selected space:** delete the `.space-card.selected { border-color: color-mix(project-color …) }` override. The neutral `--border-strong` remains.
- **Project title:** delete `.project.active .project-name { color: var(--text) }`, and the now-unused `active` selector and class in `ProjectSection`.
- **Git root:** delete `box-shadow: inset 3px 0 0 var(--amber)` from `.tree-node.root`.

## 4. ScriptDialog: owning project only (`ScriptDialog.tsx`)
- Remove the "Show in" chip field, `toggleTarget` and `cwdPinned`.
- `targets` becomes a constant:
  - a new script uses `[projectId]`
  - an edit keeps the script's existing links, so nothing is silently unlinked
- Linking into other projects still works via the Link button.

## 5. Folder picker opens inside the project (`store.ts`, `SpaceDialog.tsx`, `ScriptDialog.tsx`)
**Problem:** macOS NSOpenPanel (via rfd's `setDirectoryURL`) shows a folder given as the start path *selected in its parent*.

**Fix:** add `pickFolder(dir, title)` in `store.ts`. It passes an entry *inside* `dir` (first file from `api.readDir`, falling back to `dir`) as `defaultPath`, so the panel lands inside the folder. Mark it with a `ponytail:` comment.
- Use it in `SpaceDialog.choose` (`dir || project.path`) and `ScriptDialog.pickFolder`, which has the same bug.
- Before wiring it in, confirm with a 10-line Swift NSOpenPanel harness in the scratchpad (start at the folder, at a file inside it, and at a subfolder inside it), and use whichever lands inside.

## Verification
- `bunx tsc --noEmit`.
- Playwright on a Vite build with mocked `__TAURI_INTERNALS__` (fixture in the scratchpad):
  - switch spaces and check each has its own tabs and Files/Git choice; switch back and both are restored
  - tree expansion survives a round trip
  - `.project::before` is 3px wide with no border
  - a selected `.space-card`'s border-color isn't the project color
  - `.tree-node.root` has no box-shadow
  - `.project-name` keeps the project color when active
  - `ProjectBar` shows project › space in a project-color tint
  - ScriptDialog has no "Show in" field
- Manual run of `bun tauri dev`:
  - Add space → Choose… opens inside the project folder
  - restart the app and each space's tabs come back

## Implementation status (2026-10-01)
- **Built:** all five sections.
- **Folder picker:** a Swift NSOpenPanel harness showed how each start point behaves:
  - starting at the folder leaves the panel outside it
  - starting at a file inside it shows the folder's contents
  - so `pickFolder` passes the first non-dot file
- **Clean-up:** deleted the dead pre-005 git CSS (`.repo-section` … `.git.scroll`).
- **Checks:**
  - `tsc` is clean.
  - Playwright (`p007.mjs`, mocked IPC, 21/21):
    - each space keeps its own tabs and Files/Git choice
    - tree expansion survives a round trip
    - views and background terminals persist
    - the agent row jumps to its space
    - all the visual checks pass
    - ScriptDialog has no "Show in"
    - the picker starts at `/fx/web/new.txt`

## Follow-up (2026-10-01)
- **Project bar git line:** shows the same line as the space card. It uses a new shared `SpaceGit`, taken out of `SpaceCard`:
  - several repos: "N of M Git Repos" plus the changed count
  - one repo: branch, ↑↓ and the changed count
- **Beam:** it moved from the project section to the space card whose agent is working.
- **Checks (`p007b.mjs`):**
  - the bar's line equals the card's line
  - the beam wraps only the working space's card
  - `p007` still 21/21
