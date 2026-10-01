# Plan 006: Changes asked after plan 005 (sidebar, scripts, git)

## Context
While plan 005 (the commit panel) was being built, and after it, the user asked for a series of smaller changes on 2026-10-01. This plan records all of them in one place. Items 1–6 are already built. Items 7–8 are new.

Two earlier asks were never written into a plan, so they are also recorded here:
- **Collapsed project bracket:** centred on the header.
- **Breathing card:** a space whose agent finished while you weren't watching breathes softly. The curve is an exp(sin) brightness curve over 4s, after Apple's breathing-LED patent US6658577. It stops once that space is opened.

## Already built
1. **Collapse by name:** clicking the project name collapses or expands the project. A double-click on the name still renames it; a 220ms timer tells the two apart.
2. **Starred cards:** in the Spaces view, the doubled left line is replaced by a single project-color border.
3. **Scripts tab:** Scripts is a third sidebar tab, next to Projects and Spaces, with a "Running only · N" filter across all projects.
4. **Scripts out of projects:** scripts no longer show inside the project block or its spaces; they live only in the Scripts tab.
5. **Multi-repo space card:**
   - one line: git icon, "N Git Repos", then the combined changed count
   - no branch (there's no single branch to show)
   - the tooltip breaks the count down per repo
   - single-repo cards keep branch, ↑↓ and the change count
6. **Notifications say "Terminal":** under `bun tauri dev`, the notification plugin deliberately posts as `com.apple.Terminal`. A built `.app` posts as "IDE". No code change.

## New
7. **No branch switching on repos with changes** (`GitPanel.tsx`): switching branches with uncommitted changes isn't safe.
   - Changed repos show their branch as plain text: an icon plus the name, with no menu.
   - The branch menu (switch, create, delete) stays only on clean repos, behind "N repos with no changes · Show".
8. **Scripts tab looks like the bottom Terminals list, not the Projects tab** (`LeftPanel.tsx`, `styles.css`):
   - **Rows:** one flat list, with no project brackets or headers. Each row has:
     - a small **squircle** in the project's color, so projects can be told apart
     - a status dot
     - the script name
     - the project name, dimmed
     - hover actions: Include in Start, Run/Restart/Stop, Edit, Delete/Unlink
   - **Toolbar:** "Running only · N", plus Start, Add script and Link, which act on the active project and name it in their tooltips. The script dialog can still switch the project.

## Verification
- `bunx tsc --noEmit`.
- Playwright (mocked IPC):
  - a changed repo has no `.branch-btn`, and a clean one shown via Show has one
  - the Scripts tab has no `.project` sections, and each row has a `.squircle` in its project color
  - "Running only" filters the rows
  - row actions still run and stop scripts

## Implementation status (2026-10-01)
- **Items 1–6:** built earlier (see Context).
- **Item 7:** changed repos show `.branch-label`; clean repos keep `BranchMenu`.
- **Item 8:** `ScriptsView` is a flat list of `ScriptRow`s (project-color `.squircle`); the per-project groups were removed.
- **Checks:**
  - `tsc` is clean.
  - Playwright (`p006.mjs`):
    - no branch menus on changed repos, 1 on the shown clean repo
    - no project sections in the Scripts tab
    - squircles in project colors
    - Run works, and Running only filters

## Follow-up (2026-10-01): Scripts tab, running first
**Asked:** the Include-in-Start checkbox wasn't visible. Show only running scripts, and collapse the rest under "Inactive", sorted by when each was last started.

**Built:**
- **Checkbox:** always visible, first in the row.
- **Layout:**
  - A "Running · N" heading over the running scripts.
  - Below it, an "Inactive · N" toggle, collapsed by default.
  - The "Running only" chip was removed.
- **Order:** both lists are sorted newest first by `Script.lastRunAt`.
  - `startSession` sets it on every run, restart and Start.
  - It is kept in the config, so the order survives restarts, and editing a script keeps it.
  - Scripts never run sort last, in config order.

**Checked** (Playwright `p006b.mjs`):
- the checkbox is visible (opacity 1) and toggles
- running scripts are listed under Running
- a stopped script moves to the top of Inactive

## Follow-up 2 (2026-10-01)
9. **Scripts back under each project (Projects tab).**
   - Each project gets a collapsible "Scripts" section below its spaces:
     - header actions: ▶ Start, Add, Link
     - each row: Start checkbox, status dot, name; no squircle or project name
   - Folding is stored as `Project.scriptsCollapsed`. The Scripts tab stays the cross-project Running / Inactive view.
10. **An agent in a space shows even before it starts working.**
    - Agents opened with "+" already show "Idle – <agent>" right away.
    - New: an agent CLI typed into a plain terminal is detected too.
      - The memory sampler (`mem.rs`, every 2s) also reports each session's command names: argv[0], plus the script path when argv[0] is an interpreter such as node, bun or python.
      - The frontend marks the terminal as that agent (`detected`), and clears the mark when the process ends.
      - Status comes from the activity heuristic, since hooks can't be injected into a process that's already running.
11. **Multi-repo card shows changed repos too:** "2 of 5 Git Repos · 53 changed". With no changes it shows "5 Git Repos".
12. **Git tab:** repos with changes don't offer Pull or Push either (Commit and Push covers them). Clean repos keep Pull, Push and the branch menu.

**Status (follow-up 2):**
- Items 9–12 are built. `tsc` is clean and the Rust build is clean.
- Playwright (`p006c.mjs`):
  - every project has a Scripts section; collapsing it shows "Scripts (3)"
  - the multi-repo card reads "2 of 2 Git Repos · 5 changed"
  - a changed repo has no pull/push buttons
  - a plain terminal whose session reports `claude` shows "Idle – Claude Code" under its space and gets the agent tab icon, and the row goes away when the process ends
  - `node gemini` is recognised as Gemini CLI
