# Plan 004: Nested subagents and exact status for every agent that allows it

## Context
Plan 003 §7 added a nested subagent tree and exact status for Claude Code, using `claude --settings` hooks. The user asked for the same for **any agent**. Research covered all 12 supported CLIs (2026-10-01) and found that each exposes subagents differently, or not at all.

The user chose: **zero-touch where possible, plus an opt-in that writes a hooks file into the repo** for agents that only read hooks from project files.

## Research summary
| Agent | Subagents / nesting | Observation | Injection |
|---|---|---|---|
| Claude Code | yes / yes | hooks: `SubagentStart`/`SubagentStop`, `PreToolUse`/`PostToolUse(Agent)`, `UserPromptSubmit`, `Stop`, `Notification` | `--settings <file>`, merges with the user's settings (done) |
| OpenCode | yes (sessions with `parentID`) / possible | plugin bus events: `session.created` (has `parentID`), `session.idle`, permission events | `OPENCODE_CONFIG_CONTENT`, merges with the user's config. Plugin loading from a path still to be verified |
| Qwen Code | yes / not documented | Claude-compatible hooks, including `SubagentStart`/`SubagentStop` | `QWEN_CODE_SYSTEM_SETTINGS_PATH`. Whether this merges or replaces still to be verified |
| Gemini CLI | yes / **no** | hooks: `BeforeAgent`/`AfterAgent`, `BeforeTool`/`AfterTool`, `Notification`. No dedicated subagent events | `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. Merge behavior still to be verified |
| Codex | yes / not documented | hooks: `SubagentStart`/`SubagentStop`, `UserPromptSubmit`, `PermissionRequest`, `Stop` | **repo** `.codex/hooks.json` (needs Codex's project-trust prompt) |
| Factory Droid | yes / no | hooks: `PreToolUse(Task)`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Notification` | **repo** `.factory/hooks.json` |
| Copilot CLI | yes / not documented | hooks: `subagentStart`/`subagentStop`, `userPromptSubmitted`, `agentStop`, `permissionRequest` | **repo** `.github/hooks/*.json` (a file of our own) |
| Cursor Agent | yes / not documented | hooks: `subagentStart`/`subagentStop` (reported **not firing** in the CLI), `beforeSubmitPrompt`, `stop` | **repo** `.cursor/hooks.json` |
| Amp | yes / not documented | plugin API: `agent.start`/`agent.end`, `tool.call`; no parent field | **repo** `.amp/plugins/` |
| Goose | yes / **no** | hooks: `UserPromptSubmit`, `Stop`; no subagent ids (status only) | **repo** `.agents/plugins/<name>/hooks/hooks.json` |
| Crush | yes / no | hooks are preliminary (`PreToolUse` only, top-level agent only) | none useful: activity heuristic |
| Aider | no subagents | none | activity heuristic |

## Design
1. **Normalized events** (`src/lib/agentEvents.ts`).
   - Each adapter maps raw payloads to `{ kind, id?, parent?, type?, description? }`, with kind one of:
     - `prompt` / `stop` / `waiting` (main agent status)
     - `spawn` (a pending child, before it starts)
     - `sub_start` / `sub_stop`
     - `link` (an explicit parent → child edge)
   - The existing tree-folding logic in `terminals.ts` consumes normalized events, so Claude's adapter becomes one adapter among many.
2. **Shared hook command.** One shell command (the existing `HOOK_CMD`, which writes its stdin JSON to `$IDE_AGENT_EVENTS`) serves every hook-based agent.
   - It's a no-op unless the IDE launched that terminal (the env var is unset otherwise).
   - Each tool's own hook file format wraps the same command.
3. **Zero-touch adapters**, set up at spawn:
   - **Qwen and Gemini:** the env var points at a generated settings file. Ship each only if its source confirms the system-settings layer *merges* hooks rather than replacing the user's.
   - **OpenCode:** a generated plugin (`ide-opencode-plugin.js`, which writes its events to `$IDE_AGENT_EVENTS`), loaded through `OPENCODE_CONFIG_CONTENT`. Ship only if loading a plugin from a path is confirmed.
4. **Opt-in repo hooks** (Codex, Droid, Copilot, Cursor, Goose, Amp):
   - **Asking:** the first time such an agent launches in a project, a dialog asks, naming the exact file it would create. The answer is stored as `project.agentHooks[agentId] = "on" | "off"`, and Project settings gets a toggle for it.
   - **Writing:** the file is created **only if absent**; an existing file is never edited. Its path is appended to `.git/info/exclude` (local only, never committed).
   - **Turning it off:** removes the file and its exclude line, but only if the file is still exactly what the IDE wrote.
5. **Everything else** (Crush, Aider, and any agent before it emits an event) keeps the activity heuristic.

## Backend (`src-tauri/src/agent.rs`)
- `agent_setup(agent, key, cwd)` returns `{ args, env }` for the zero-touch adapters. It writes the generated settings or plugin files under app data.
- `agent_repo_hooks(agent, cwd, enable)`:
  - enabling creates the file if absent and adds the exclude line
  - disabling removes both, only if the file is unchanged
  - returns the status: `created` / `exists-foreign` / `removed`
- Rust tests:
  - each generated file's shape matches the tool's documented schema
  - an existing file is never overwritten
  - the exclude line is added once and removed cleanly

## Verification
- **Per adapter:** Playwright with recorded payload fixtures (taken from each tool's docs) checks the normalized tree, the status, and the opt-in dialog flow.
- **Live (installed here):**
  - OpenCode: start the TUI in a scratch repo and check that the plugin loads and `session.created` events arrive (no prompt, so no tokens).
  - Gemini: start the TUI and check that our system-settings hooks fire on session start, and that the user's own settings still apply.
- **Not installed here:** Qwen, Codex, Droid, Copilot, Cursor, Amp and Goose are verified against docs and fixtures only. Each such adapter is marked "unverified live" in the UI tooltip.

## Implementation status (2026-10-01)
- **Backend** (`src-tauri/src/agent.rs`):
  - `agent_setup` and `agent_repo_hooks` are done; `cargo test` reports 18 passed and 1 ignored (the Keychain test).
  - System settings: any admin system-settings file that already exists is merged into the generated one. Hook arrays concatenate under Gemini and Qwen's `settingsSchema`.
  - Repo hook files: created only when absent, git-excluded through `.git/info/exclude`, and removed only if unchanged.
- **Frontend:**
  - `src/lib/agentEvents.ts` has the normalizers and the shared `fold`.
  - `terminals.ts`:
    - `withAgentHooks` applies the per-launch setup.
    - `ensureRepoHooks` asks once per project.
    - Only agents with `exactStatus` turn off the activity heuristic.
  - The Project dialog lists the agents with tracking files, with "Remove files" / "Enable".
- **Playwright fixtures (mocked IPC), all passing:**
  - Codex: the opt-in prompt appears, then a repo-hooks call. Tagged `SubagentStart`/`Stop` build the tree; `Stop` sets Done.
  - OpenCode: `OPENCODE_CONFIG_CONTENT` is set; `{ide_event}` passthrough builds a 2-level tree.
  - Copilot: subagents are matched by `agentName`.
  - Droid: `PreToolUse(Task)` starts subagents; `SubagentStop` matches them by name.
  - Cursor: subagent tree only.
  - Gemini: exact status only, via `GEMINI_CLI_SYSTEM_SETTINGS_PATH`.
  - Qwen: `QWEN_CODE_SYSTEM_SETTINGS_PATH` is set.
  - Dialog: "Remove files" calls `agent_repo_hooks(..., false)` for every non-worktree repo.
- **Not verified live:**
  - Qwen, Codex, Droid, Copilot, Cursor and Goose (not installed here).
  - Cursor's subagent hooks are reported not to fire in the CLI.
  - The OpenCode 1.2.6 and Gemini 0.29.5 live TUI checks are still pending.
- **Activity heuristic only:** Aider, Amp, Crush.
