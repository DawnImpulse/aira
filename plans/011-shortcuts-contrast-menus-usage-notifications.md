# Plan: TODO items 1, 5, 9, 10, 11

Repo: `/Users/saksham/dev-data/codevry/projects/ide` (Aira — Tauri 2.12 + React, bun, xterm.js 6). Save as `plans/011-shortcuts-contrast-menus-usage-notifications.md` once approved.

## Context

Five open `TODO.md` items, clarified with the user on 2026-10-12:

- **1** Keyboard shortcuts info in Settings.
- **5** Dark text on the primary button (white on `#6aa8ff` is 2.4:1, below WCAG AA).
- **9** "Notification support" → Dock badge, click-to-focus, an in-app notification list, and "System Settings shows Terminal instead of Aira".
- **10** "Bar usage of AI agent" → per-terminal tokens/cost for Claude Code, read from the session transcript.
- **11** "Fix the right-click context menu" → WebKit's stock menu (Reload / Inspect Element / Spelling / Services…) shows up; the IDE should only ever show its own menus.

Each ships as its own commit, smallest first.

---

## 5. Primary button contrast

**Findings**
- Single offender: `.btn.primary` `src/styles.css:176-180` → `color: #fff` on `var(--accent)`.
- Dark accent `#6aa8ff` (`styles.css:13`), light accent `#2563eb` (`:32`). White passes on light (~5.2:1), fails on dark (2.4:1); dark ink `#06101f` passes on dark, fails on light (~2.5:1) → the token must be per-theme.
- Website already has it: `docs/site.css:52` `--on-accent: #06101f`. `DESIGN.md:32-33` defines `on-accent`, but the `button-primary` block `DESIGN.md:155-160` still says `textColor: "#ffffff"`.
- No other accent-fill + white-text elements (checked `.tab.active`, `.segmented`, `.chip-btn.on`, `.badge`…).

**Changes**
- `src/styles.css`: `--on-accent: #06101f` in the dark block (`:1-20`), `--on-accent: #ffffff` in the light block (`:21-39`); `:179` → `color: var(--on-accent)`.
- `DESIGN.md:157`: `textColor` → the `on-accent` token.

**Verify**: Settings → Theme dark/light; `Save` (Settings) and `Commit` (GitPanel) buttons: dark ink on blue in dark, white in light. Contrast ≥ 4.5:1 in DevTools.

---

## 1. Keyboard shortcuts in Settings

**Findings**
- `src/components/SettingsDialog.tsx`: flat `.form`, one `.section-title` ("AI (commit messages)") at `:102`, checkboxes end at `:100`.
- A static list already exists in the Welcome empty state `src/components/MainTabs.tsx:177-183` (`<dl className="shortcuts">`, 5 entries); CSS `.shortcuts` `src/styles.css:791-805`. Fullest list anywhere: `docs/guide.html:115-134`.
- No hotkey lib, no registry: menu accelerators in `src-tauri/src/lib.rs:13-80` → `app.emit("menu", id)` → `store.ts:752-762`; local handlers for ⌘S (`Editors.tsx:67`), ⌘K (`terminals.ts:75`), ⌘⏎ (`GitPanel.tsx:342`), Esc (`ui.tsx:45`).

**List to show** (app-defined; macOS predefined ⌘H/⌘M/⌘Q are already in the menu bar)

| Combo | Action |
|---|---|
| ⌘O | Open folder |
| ⌘T | New terminal in the active space |
| ⌘W | Close tab |
| ⌘B | Toggle Projects panel |
| ⌥⌘B | Toggle Files/Git panel |
| ⌘, | Settings |
| ⌘S | Save file |
| ⌘K | Clear terminal |
| ⌘⏎ | Commit |
| Esc | Close dialog / cancel rename |

**Changes**
- New `src/lib/shortcuts.ts`: `export const SHORTCUTS: { keys: string; label: string }[]` (the table). Single source of truth.
- `MainTabs.tsx:177-183`: render from `SHORTCUTS.slice(0, 5)`.
- `SettingsDialog.tsx`: `.section-title` "Keyboard shortcuts" + `<dl className="shortcuts">` from `SHORTCUTS`, after the checkboxes (`:100`), before the AI block. Reuses `.shortcuts` CSS (adjust `margin-top` inside `.form` if needed).
- Skipped: customisable bindings, a registry that drives handlers. Add when a second keymap is wanted.

**Verify**: ⌘, shows the section; Welcome still shows its 5. `bun run build` passes; `bun run screenshots` if Settings is in the set.

---

## 11. Right-click context menu

**Findings**
- One menu mechanism: `popupMenu()` in `src/lib/menu.ts` → native NSMenu via `@tauri-apps/api/menu`, popped at the cursor. Used by tabs (`MainTabs.tsx:59-66`) and the file tree (`RightPanel.tsx:134-153`). Rust ignores `ctx:*` ids (`src-tauri/src/lib.rs:102-107`).
- WebKit's stock menu leaks through the whitelist in `src/main.tsx:24-29` (`input, textarea, .monaco-editor, .xterm`, or any selected text). Worst case is the terminal: no menu of its own, so right-click shows WebKit's textarea menu.
- Predefined `Cut/Copy/Paste/SelectAll` items in a popup act on the first responder via `cut:/copy:/paste:/selectAll:` (muda macOS impl) — same path as the app's Edit menu (`lib.rs:55-58`); they never reach `on_menu_event`. They are always enabled (muda `setAutoenablesItems(false)`, no `enabled` option) — Copy with nothing selected is a no-op. Fine.
- xterm 6's own `contextmenu` handler (on the inner `.xterm`) runs first: moves the hidden textarea under the cursor, right-click-selects the word (`rightClickSelectsWord`, default on macOS like Terminal.app), puts the selection into the textarea and `select()`s it. So native `copy:` copies xterm's selection and `paste:` fires the textarea `paste` event → xterm `onData` → `ptyWrite` (what ⌘V does today). No Rust needed.
- xterm instances are built in `src/lib/terminals.ts:57-100` (`xterm(key)`), host `el.className = "xterm-host"`.

**Changes**
- `src/lib/menu.ts` (2 lines): `MenuEntry = { text; action; enabled? } | "-" | "Cut" | "Copy" | "Paste" | "SelectAll"`; mapper `typeof e === "string" ? PredefinedMenuItem.new({ item: e === "-" ? "Separator" : e }) : MenuItem.new(...)`.
- `src/main.tsx:24-29`: keep `return` for `.monaco-editor` (Monaco's own IDE menu) **and `.xterm`** (handled below; otherwise two menus). Else `e.preventDefault()` then `popupMenu(t.closest("input, textarea") ? ["Cut", "Copy", "Paste", "-", "SelectAll"] : ["Copy"])`. Drop the `getSelection()` branch (`SelectAll` outside an input would select the page, hence the split).
- `src/lib/terminals.ts` in `xterm(key)`: `el.addEventListener("contextmenu", (e) => { e.preventDefault(); popupMenu(["Copy", "Paste", "-", { text: "Select All", action: () => term.selectAll() }, { text: "Clear", action: () => term.clear() }]); })`. No `stopPropagation` — xterm's handler must run first.
- `docs/guide.html:150-158`: document the terminal menu.

**Verify**: right-click in terminal (with/without selection) → Copy/Paste/Select All/Clear; copy → paste round-trips into the shell. Settings text field → Cut/Copy/Paste/Select All. Sidebar text, tab, file row, Monaco: never a WebKit menu.

---

## 10. Per-terminal Claude Code tokens/cost

**Findings**
- No usage code exists. Claude hooks are injected per launch (`src-tauri/src/agent.rs:54-62`); event files polled every 1s (`terminals.ts:473-484`), folded in `applyHookEvents` (`:487-509`). Raw payloads carry `transcript_path`, `session_id`, `cwd` (untyped `Raw`, `src/lib/agentEvents.ts:17`).
- Transcript JSONL (real file checked, ~700 KB): `"type":"assistant"` lines carry `message.id`, `message.model`, `message.usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`. Several lines share one `message.id` with identical usage → **dedupe by `message.id`** (34 lines / 14 ids in the sample).
- Hooks doc: the transcript "is written asynchronously … may not yet include the current turn's most recent messages when a hook fires" → refresh 2s after `stop`, and again on the next `prompt` (previous turn complete by then).
- Rust over TS: `read_file` rejects >10 MB (`fs.rs:46-48`) and long sessions get there; shipping MBs over IPC + `JSON.parse` on the main thread every turn is a permanent tax.
- Display: `AgentRow` `src/components/LeftPanel.tsx:279-296`, `TermRow` `StatusBar.tsx:183-240` (shows RSS). No k/M formatter exists (`formatBytes` is bytes-only) → `Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })`.
- `AgentStatus` objects are replaced wholesale (`terminals.ts:373`, `:501-506`) → usage must be its own slice, like `subagents`. `forgetHooks` (`terminals.ts:463-472`) is where per-terminal maps are cleaned.

**Changes**
- `src/ipc.ts`: `transcript_path?: string` on `HookEvent`; `api.agentUsage(path)`.
- `src-tauri/src/agent.rs`: `agent_usage(path) -> Vec<{ model, input, output, cache_read, cache_create }>` — guard `path` starts with `~/.claude` and ends `.jsonl` (hook-written, still untrusted); `spawn_blocking`, `BufReader::lines`, prefilter `line.contains("\"type\":\"assistant\"")` before `serde_json`, `HashMap<message.id, (model, usage)>` keeping the last, sum per model. `// ponytail: full re-read per turn (~1 MB); byte-offset cache if it shows in profiles`. Register in `generate_handler` (`lib.rs:~138-150`).
- `src/lib/usage.ts` (new, small): `PRICES` per model family (opus/sonnet/haiku — numbers from the `claude-api` skill at implementation time, not memory), `costOf(rows)`, `formatTokens(n)` one-liner. Unknown model → tokens only, no `$`.
- `src/store.ts`: `usage: Record<string, UsageRow[]>` slice next to `agentStatus` (never saved).
- `terminals.ts`: module `transcripts: Map<key, string>` filled from `events.find(e => e.transcript_path)`; `refreshUsage(key)` called via `setTimeout(…, 2000)` on `stop` and immediately on `prompt`; delete both entries in `forgetHooks`.
- `AgentRow` + `TermRow`: `const u = useStore(s => s.usage[t.key])`; render a `dim mono` span `48K tok · $0.42` only when `u` exists (tooltip: input / output / cache read / cache write; "API-equivalent cost" for subscription users).
- Ceilings (comments): Claude only; subagent transcripts (separate files) excluded; `--resume` keeps one file so totals span the resumed session.

**Verify**: launch Claude from Aira, send a prompt; ~2s after the turn the AgentRow and Terminals popover show tokens/cost; compare with `/cost` in Claude Code (within rounding). A hand-typed `claude` terminal (no hooks) shows nothing. `cargo test` passes.

---

## 9. Notifications: click-to-focus, Dock badge, in-app list, "Terminal" name

**Findings**
- OS banners already ship (plan 003): `notifyAgent()` `src/lib/terminals.ts:393-408` via `tauri-plugin-notification`; triggers bell `:90-92`, exit `:196`, heuristic finish `:374`, hooks `:507-508`. Setting `notifyAgents` (`SettingsDialog.tsx:92`).
- **"Terminal" in System Settings**: the plugin poses as `com.apple.Terminal` under `bun tauri dev` (plugin `desktop.rs:233`, `tauri::is_dev()`); a built `.app` posts as `com.codevry.ide` = "Aira" (plan 006 item 6). Under the hood `mac-notification-sys` swizzles `bundleIdentifier`: when `set_application(id)` fails (bundle unknown to LaunchServices) it already falls back to `com.apple.Terminal` — no fallback code needed.
- The plugin discards the notification response (`desktop.rs:240`), so no click on desktop (`onAction` mobile-only); its permission functions are stubs returning `Granted`. `mac-notification-sys 0.6.15` (already in Cargo.lock via the plugin, so delivery parity on Darwin 25) exposes `wait_for_click(true).send() -> NotificationResponse::Click`. Waiting parks a thread + a 0.5s main-loop poll until the banner is clicked or cleared from Notification Center — must be `spawn_blocking`, and needs a cap.
- Dock badge: `getCurrentWindow().setBadgeCount(n)` (`@tauri-apps/api` 2.12, `window.d.ts:1455-1473`) needs `core:window:allow-set-badge-count` (`src-tauri/capabilities/default.json`).
- In-app truth today: `agentStatus[key].unseen` (`store.ts:45-52`) — but set only on working→idle (`terminals.ts:373,504`); `waiting`, bell and exit never set it. Cleared by `markSeen` at `store.ts:405` (space select), `:587` (`activateTab`), `:594` (`openTerminalTab`, which `focusTerminal` `:615` calls).
- Popover pattern: `useOutsideClose` (module-private) + `.popover.up` in `StatusBar.tsx:60-70,165-181`. Store subscribe for side effects already at `store.ts:773`; Rust→JS `listen`s at `:783-789`.
- Side bug: `agentEvents.ts:47` maps every Claude `Notification` hook to `waiting`; `notification_type` also covers `auth_success`, `agent_completed`, `quota_auto_resume_*` → spurious "Needs your input".

**Changes**
1. **Direct macOS notifications with click** — replace the plugin.
   - `Cargo.toml`: drop `tauri-plugin-notification`; add `mac-notification-sys = "0.6"` under the existing `[target.'cfg(target_os = "macos")'.dependencies]`. `package.json`: drop `@tauri-apps/plugin-notification`. `capabilities/default.json`: `notification:default` → `core:window:allow-set-badge-count`. `lib.rs:98`: remove plugin init; in `setup`: `let _ = mac_notification_sys::set_application(&app.config().identifier);` (prod → Aira; dev → Terminal unless an `Aira.app` is registered, then Aira).
   - `agent.rs`: `notify_agent(app, key, title, body)`: `spawn_blocking` → `Notification::new().title().message().wait_for_click(true).send()`; on `Click` → main window `unminimize()` + `set_focus()` + `app.emit("notification-clicked", key)`. `static WAITERS: AtomicUsize`; above 8 outstanding send without `wait_for_click` (`// ponytail: waiters park a thread each until clicked/cleared`).
   - `terminals.ts` `notifyAgent`: drop the plugin import (`:10`) and permission dance (`:386,:401-404`); after the watching + dedupe checks: `api.notifyAgent(key, title, body)`, set `agentStatus[key].unseen = true`, push a notice. `store.ts`: `listen("notification-clicked", key => focusTerminal(key))` next to `:788`.
   - Dev ceiling (comment + plan status): posing as Terminal means a banner click activates Terminal.app alongside our callback; once `bun tauri build` has registered `Aira.app` with LaunchServices the name and click are right in dev too.
2. **In-app list** — `notices: { key; title; body; at }[]` slice (cap 50, not persisted), appended exactly where the OS banner fires (no log for events the user watched). `NoticesPopover` inside `StatusBar.tsx` (reuses `useOutsideClose`): bell `status-btn` on the right with the unseen count; rows `AgentIcon · title · body · ago`, highlighted iff `agentStatus[key]?.unseen`; click → `focusTerminal(key); onClose()`; "Clear" → `set({ notices: [] })`. Unseen = `agentStatus.unseen` (one truth; `markSeen` already clears it on focus, and the space "breathing" picks up waiting/exit for free).
3. **Dock badge** — second branch in the existing `useStore.subscribe` (`store.ts:773`): count terminals with `unseen`; on change `getCurrentWindow().setBadgeCount(n || undefined)`.
4. `agentEvents.ts:47`: map `Notification` → `waiting` only for `permission_prompt | idle_prompt | agent_needs_input | elicitation_*`.

**Verify**: two Claude terminals, switch away → banner (Aira in a built app / Terminal in dev), Dock badge 1, bell 1; click banner → window focuses that terminal, badge clears; bell lists the event; "Clear" empties it. Exit and needs-input also badge. `cargo test` + `bun run build` pass; `bun tauri build` once to register `Aira.app` and confirm the name in System Settings → Notifications.

---

## Order and commits

1. `fix(ui): dark ink on primary buttons in the dark theme` — item 5
2. `feat(settings): keyboard shortcuts section` — item 1
3. `fix(menu): IDE context menus everywhere, terminal copy/paste/clear` — item 11
4. `feat(agents): tokens and cost per Claude Code terminal` — item 10
5. `feat(notifications): click to focus, Dock badge, in-app list` — item 9

Each commit moves its `TODO.md` line to Done (version + date). Plan saved to `plans/011-…` first; implementation-status section appended at the end.

---

## Implementation status (2026-11-09)

Shipped in six commits on `aira-website`: `e45333a` (5), `945a824` (1), `945e02d` (11), `7a09afa` (10), `541e837` (stale user-agent test), `6c39964` (9).

**Deviations from the plan**
- Item 11: no `paste_text` Rust command and no `copyText` for selections. Native `Cut/Copy/Paste/SelectAll` items act on the focused field through the responder chain (same path as the Edit menu); xterm's own right-click handler leaves the selection in its hidden textarea, so native Copy/Paste reach the terminal. `MenuEntry` takes those four names as strings.
- Item 9: no `set_application` fallback code — `mac-notification-sys` already poses as Terminal when the bundle id is unknown. `tauri-plugin-notification` removed (Rust + JS + capability). Unseen state stays on `agentStatus.unseen` (now also set for needs-input and exit); `notices` holds only `{ key, title, body, at }`. Waiter cap of 8 parked threads. Bonus: Claude `Notification` hooks count as "Needs input" only for `permission_prompt`, `idle_prompt`, `agent_needs_input`, `elicitation*`.
- Item 10: usage re-read 2s after `stop` and on the next `prompt` (transcript lags hooks); Rust reads the file with a `"type":"assistant"` prefilter; `Intl.NumberFormat` compact for `48K`.

**Verified**: `tsc`, `vite build`, `cargo test` (22 pass, incl. a new dedupe test for `read_usage`).

**Not yet verified at runtime** (needs `bun tauri dev`): terminal right-click Copy/Paste round-trip, banner click focusing the terminal, Dock badge, bell popover, usage numbers vs `/cost`. Sender name "Aira" needs a built `Aira.app` registered with LaunchServices (`bun tauri build` once).
