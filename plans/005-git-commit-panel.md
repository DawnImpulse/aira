# Plan 005: WebStorm-style Commit panel (one repository per commit)

## Context
The user wants the Git tab to look like WebStorm's Commit tool window (reference screenshot, 2026-10-01), and **does not want a single commit message to cover several repositories**. The per-repo commit boxes from plan 002 are replaced by one tree and one commit area.

## Layout (`src/components/GitPanel.tsx`)
1. **Toolbar:**
   - Refresh (re-runs status for every repo)
   - Rollback: reverts the checked files to HEAD, with confirmation
   - Show diff: for the focused file
   - Fetch all
   - Expand all / Collapse all
2. **Tree:**
   - `▾ ☐ Changes  N files` (root)
     - `› ☐ ■ repo-name  N files  [branch]`, one node per repository with changes. The ■ is the repo color; the branch chip opens the existing `BranchMenu`. Hover shows Pull, Push and Fetch.
       - `☐ file-name  dir  M` (file rows)
   - File names are colored by status: modified blue, added green, deleted strike-through grey, untracked red-ish, conflict red. Clicking a row opens the diff (HEAD ↔ working tree).
   - Repos with no changes are hidden behind "N repos with no changes · Show" (unchanged from plan 003).
   - A collapsible **Worktrees** section at the bottom keeps the existing component.
3. **Commit area (bottom):**
   - A row with `☐ Amend last commit`; checking it pre-fills the last commit message. ✨ Generate sits on the same row.
   - The message textarea.
   - **Commit** and **Commit and Push…** buttons, labelled with their target: "Commit 2 files to angeles-api".

## One repository per commit
- Checkbox state is `{ repo, paths }`. Checking anything in another repo **moves the selection** to that repo, and a short inline note explains why: "Commits are per repository — selection moved to X".
- The root "Changes" checkbox is disabled when more than one repo has changes; its tooltip explains why. With a single repo it toggles all files.
- **Default selection:** all changes of the active space's repo, otherwise of the first changed repo.
- The staging area is no longer shown; checkboxes decide what gets committed, as in WebStorm.

## Backend (`src-tauri/src/git.rs`, `ai.rs`)
- `git_commit(repo, message, paths, untracked, amend)`:
  1. `git add -- <untracked>`
  2. `git commit [--amend] -m <msg> -- <paths, plus rename origins>`
  
  The pathspec form commits only those paths (`--only`), and leaves anything else that was staged untouched. Amend may have no paths: then it only changes the message.
- `git_last_message(repo)`: `git log -1 --pretty=%B`.
- `git_file_versions(..., mode)`: adds a `"head"` mode (HEAD ↔ working tree) for this view.
- `git_discard`: tracked files go back to HEAD, index and working tree (`restore --source=HEAD --staged --worktree`), falling back to `--worktree` on an unborn branch. Untracked files are removed with `clean -fd`.
- `ai_commit_message(..., paths)`: when paths are given, the diff covers only those paths, plus the names of any untracked ones.

## Verification
- `cargo test`: extend the git end-to-end test. Commit two of three changed files with a pathspec: the third stays uncommitted and an unrelated staged file stays staged. Then `--amend` with a message only, then rollback to HEAD.
- Playwright (mocked IPC):
  - the tree shows repo groups with colors, file counts and branch chips
  - checking a file in repo B clears repo A and shows the note
  - the root checkbox is disabled when two repos have changes
  - the Commit label shows the file count and repo
  - Amend pre-fills the last message
  - Commit and Push calls commit then push, for the selected repo only

## Implementation status (2026-10-01)
- **Built as planned:**
  - **Backend:** `git_commit` (pathspec + `--amend`), `git_last_message`, the HEAD diff mode, rollback to HEAD, and AI messages limited to the checked paths. The git e2e test was extended.
  - **Panel:** the tree, one-repo selection with its note, Amend, and Commit / Commit and Push.
- **Verified:** Playwright passes all six checks listed under Verification.
- **Changed later in plan 006:** repos with changes no longer offer the branch menu.
