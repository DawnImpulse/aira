# Plan 013: Browser tab — element picker, device views, pop-out, cookie import

## Context

Four open TODO items for the Browser tab (native child webview, `src-tauri/src/browser.rs` +
`src/components/BrowserView.tsx`, see plan 012 rev. 2). User picked all four:

1. **Capture → save or agent**: three capture modes: **element** (click a div), **region** (drag a
   rectangle) and **full page** (auto-scroll top to bottom, stitched). Each result is either **saved**
   as a screenshot or **attached to an agent chat** (selector, when there is one, + PNG path). Agent
   chats are PTY terminals (`Term.agent`), so "attach" = paste text into the PTY via `api.ptyWrite`.
2. **Device views**: presets + custom sizes, **several side by side, scaled to fit**, with an
   **optional Sync switch** (navigation + scroll).
3. **Pop out** a browser tab into its own window and back.
4. **Cookie import** from Chrome/Arc/Brave/Edge/Dia (design already worked out in plan 012 commit 2,
   dropped in the iframe detour).

## Key facts (verified in tauri 2.12.0 / wry 0.57 source)

- `Webview::eval_with_callback` (webview/mod.rs:2190) returns a JS result to Rust: the only channel
  back from a child webview, which has no IPC (capability scoped to `webviews: ["main"]`). Polling it
  drives the picker and scroll sync.
- `Webview::reparent(&Window)` (mod.rs:1737) moves a webview between windows (pop-out).
- `Webview::set_cookie` (mod.rs:2461) writes into the webview's data store; all browser webviews share
  `STORE_ID`, so one import logs in every tab, device and pop-out.
- `Webview::with_webview` gives the `WKWebView`; `objc2-web-kit 0.3.2` is already in the lockfile
  (via wry), so the screenshot uses `takeSnapshotWithConfiguration` — no Screen Recording prompt,
  works when occluded.
- WKWebView `pageZoom` (`set_zoom`) shrinks CSS px, so a 393px phone at scale 0.6 = a 236pt-wide
  webview with zoom 0.6: real 393px viewport, media queries correct. That is how device frames scale.

## Implementation

### Commit 1: panes refactor + capture (element / region / full page)

**Rust `browser.rs`**
- Webview ids become `<tabId>` (single view) or `<tabId>/<device>` (device panes). `browser_close`,
  `browser_show` loop over every webview whose label is `browser:<id>` or starts with `browser:<id>/`
  (`app.webviews()`), so tab close/hide covers all panes.
- `browser_query(app, ids: Vec<String>, js) -> Vec<Option<String>>`: `eval_with_callback` per id, result
  via `std::sync::mpsc` + `recv_timeout(500ms)` in `spawn_blocking`.
- `browser_snapshot(app, id, x, y, w, h) -> String(path)`: `with_webview` → `WKSnapshotConfiguration`
  rect (points, already × zoom) → `takeSnapshotWithConfiguration` → NSImage → TIFF → `NSBitmapImageRep`
  → PNG at `app_data_dir()/screenshots/<ts>.png`. Add direct deps `objc2`, `objc2-web-kit`,
  `objc2-app-kit`, `objc2-foundation`, `block2` (same versions as the lockfile, `cfg(target_os="macos")`).
- `browser_fullpage(app, id, zoom) -> String(path)`: read `scrollHeight`/`innerHeight` via query, scroll
  to `0, h, 2h…`, wait for paint (~150ms), snapshot each viewport, then restore the scroll position.
  From the 2nd slice on, hide `position: fixed/sticky` elements so headers don't repeat (restore after).
  Last slice is cropped to the remainder. Decode slices with `png` 0.18 (already in the lockfile),
  stack rows, encode one PNG. `// ponytail: capped at 20k css px; tile further if needed`.
- `browser_save_shot(app, src) -> String(path)`: copy to `~/Desktop/Aira <date> at <time>.png`
  (macOS screenshot naming/location).

**Frontend**
- Extract `BrowserPane({ wid, url, ua?, zoom, hidden })` from today's `BrowserView` effects (open on
  mount, `ResizeObserver` → `browserBounds`, hide on unmount, show/hide on `hidden`). `BrowserView`
  renders one pane in normal mode. The `browser:nav` listener matches `id === tab.id || id.startsWith(tab.id + "/")`.
- New `src/lib/picker.ts`: one injected JS string, two modes. **element**: an outline overlay follows
  the hovered element; click is captured (`preventDefault`) → `{selector, rect}`. Selector: `#id` if
  unique, else a `tag.class:nth-of-type` path up to the nearest unique ancestor. **region**: crosshair
  + drag marquee → `{rect}`. Both: Escape cancels, the overlay is removed before the result is stored
  in `window.__airaPick`.
- Toolbar "Capture" button (`screenshot_region`) opens a menu: Select Element, Drag Region, Full Page.
  Element/region: eval the picker into the pane(s), poll `browserQuery` every 200ms until a result or
  cancel (`// ponytail: 200ms poll; no push channel from child webviews`), then `browserSnapshot`
  with rect × zoom. Full page: `browserFullpage`.
- After any capture, `popupMenu`: "Save Screenshot" (`browserSaveShot` → toast with Reveal in Finder),
  `-`, "Send to <agent name>" for each agent term in the active space (filter like `store.ts:428`),
  and "Copy Selector" for element picks. Send = `ptyWrite` wrapped in bracketed paste
  (`\x1b[200~…\x1b[201~`), so Claude Code turns the PNG path into an image attachment:
  `` `<selector>` on <url> <png path> `` (selector only for element picks; no newline, the user
  types the prompt). With no agent open, the menu shows a disabled "No agent open in this space".

### Commit 2: device views + Sync

- `ipc.ts` browser Tab gains `devices?: string[]` (preset ids or `"WxH"`) and `sync?: boolean`;
  store setters `setBrowserDevices(id, devices)` / `setBrowserSync(id, on)`.
- Presets (one const array in `BrowserView.tsx`): iPhone 393×852 and Pixel 412×915 (mobile Safari /
  Chrome UA), iPad 820×1180 (iPad UA), Laptop 1280×800, Desktop 1440×900.
- Toolbar "Devices" button (`devices`) opens a popover (reuses `useOverlay` so webviews hide under it):
  preset toggles, a custom `W × H` field, Sync switch. Devices set = device mode; empty = normal view.
- Device row: one frame per device (label + size), scale `s = min(1, bodyH / devH, fitted width)`,
  shared across frames so all fit; each frame is a `BrowserPane` with `wid = tab/device`, UA, `zoom = s ×
  userZoom`, sized `devW·s × devH·s`. Removing a device calls `browserClose(wid)`; switching UA
  recreates the pane (UA is fixed at build).
- Sync (when on): a nav `Finished` event on one pane navigates the others whose URL differs (equality
  guard stops loops). Scroll: picker-style init via eval records `{ratio, t}` on user scroll;
  150ms `browserQuery` poll picks the newest `t` and `scrollTo`s the rest, marking them so the echo is
  ignored (`// ponytail: polled scroll sync`). Off: panes independent; address bar follows the
  last-navigated pane.

### Commit 3: pop out / dock

- Rust `browser_popout(app, id, title, theme)`: `WebviewWindowBuilder` label `popout-<id>`, URL
  `index.html?popout=<id>&url=…&theme=…`, 1100×800; `reparent` the tab's webview into its window.
  `browser_dock(app, id)`: reparent back to main, hide, close the window, emit `browser:docked`. Hook
  `on_window_event` `CloseRequested` for `popout-*` in `lib.rs` → same dock path. `browser_close` also
  closes `popout-<id>`.
- `capabilities/default.json`: `webviews: ["main", "popout-*"]` (browser webviews stay `browser:*`, no IPC).
- Store: runtime-only `popped: Record<tabId, true>` (not persisted; restart = docked).
- `main.tsx`: `?popout=` renders `<BrowserPopout>` (no `boot()`): toolbar (back/forward/reload,
  address, zoom, devtools, Dock) over a body that syncs bounds via `browserBounds`. URL state comes from
  `browser:nav`. Shares a `BrowserToolbar` component with `BrowserView`.
- Main tab when popped: placeholder ("Open in its own window" + Bring back); its `browser:nav` listener
  keeps updating tab URL and history; it skips open/bounds/show.
- Pop-out works in single view only (button disabled in device mode). Picker and cookie import stay in
  the main window. `// ponytail: add the device row to pop-outs if wanted`.

### Commit 4: cookie import (plan 012 commit 2 design)

- Deps: `rusqlite` (bundled), `aes`, `cbc`, `pbkdf2`, `sha1`; `keyring` already present.
- `cookie_sources() -> Vec<{browser, profile}>`: scan `~/Library/Application Support/<dir>/<Profile>/Cookies`
  for Chrome, Arc, Brave, Edge, Dia (+ Chromium, Vivaldi, Opera, which cost nothing). Check the real
  dirs and Keychain service names on disk first.
- `cookie_import(app, browser, profile, host: Option<String>) -> usize`: Keychain secret
  (`"<B> Safe Storage"`; the macOS prompt is the consent gate), PBKDF2-SHA1 key, copy the locked DB to
  temp, `SELECT … [WHERE host_key LIKE %host]`, AES-128-CBC decrypt `v10` blobs, strip the 32-byte
  domain hash when `meta.version >= 24`, skip expired, `set_cookie` on any browser webview (creates a
  hidden temp one if none). All in `spawn_blocking`.
- `#[cfg(test)]` decrypt round-trip incl. the 32-byte strip.
- UI: toolbar "Import logins" (`key`) popover (overlay-hidden) + on the new-tab page: source list,
  "Import all" and, on a page, "Import for <host>". Toast "<n> cookies imported", reload panes.

### Commit 5: docs

- `TODO.md`: move the four items to Done (version + date).
- Copy this plan to `plans/013-browser-picker-devices-popout-cookies.md`, add implementation status.
- Site guide (`docs/`): short browser section on the new features; ask before refreshing screenshots.

## Files

- `src-tauri/src/browser.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`
- `src/components/BrowserView.tsx`, **new** `src/lib/picker.ts`, `src/ipc.ts`, `src/store.ts`,
  `src/main.tsx`, `src/styles.css`, `TODO.md`, `plans/013-…md`, `docs/` guide

## Verification

1. `cd src-tauri && cargo test --lib`: cookie decrypt round-trip, full-page stitch (3 slices, last
   cropped → right height and row order) + existing tests pass.
2. `bun run typecheck && bun run build` clean.
3. Headless mock UI (`bun run screenshots` setup): toolbar, devices popover, device row layout,
   pop-out placeholder, light + dark.
4. `bun tauri dev` (manual, GUI):
   - Element: hover outlines, click → menu → Send to agent: Claude Code shows `[Image #1]` + selector;
     Save writes to Desktop. Esc cancels.
   - Region: drag a box → crop matches the box (also at 150% zoom). Full page on a long page: one tall
     PNG, no repeated sticky header, scroll position restored.
   - Devices: iPhone + iPad + Desktop side by side, media queries match each width, resize keeps fit;
     Sync on mirrors navigation and scroll, off doesn't.
   - Pop out → own window, page keeps state; Dock and the red close both bring it back; closing the tab
     closes the window.
   - Import from Arc/Chrome (Keychain prompt) → github.com logged in; per-host import works.
   - The page still can't reach Tauri (`window.__TAURI__` undefined) in tab, device pane and pop-out.

## Risks

- `reparent` and `eval_with_callback` on child webviews are `unstable`-feature paths: test early (commit 1
  proves query, commit 3 proves reparent).
- Scroll/pick polling costs a little CPU only while active.
- Main-window bounds sync must stay off while popped, or the webview jumps.

---

## Implementation status (2026-11-10)

Built, not yet committed. `cargo test --lib`: 27 pass (new: stitch, cookie crypto, site_of,
cookie domain dot). `tsc && vite build` clean. Headless mock UI checked (toolbar, devices popover,
device row, logins popover; dark + light).

Deviations from the plan:
- **No new crypto/SQLite crates.** PBKDF2 + AES-CBC use macOS CommonCrypto via two `extern "C"`
  decls; the cookie DB is read with `/usr/bin/sqlite3 -json` on an `immutable=1` URI (no temp copy,
  no lock issues). New Rust deps are only the objc2 crates + `png`, all already in the lockfile.
- **Domain cookies:** `cookie::Cookie::domain()` strips one leading dot and wry builds the
  `WKHTTPCookie` from it, which would make `.github.com` host-only. The import passes `..github.com`
  (getter returns `.github.com`); covered by a test.
- **Pop-out ownership:** `browser_open/bounds/show` take the calling webview and ignore calls from
  the window that doesn't hold the page (main vs `popout-<id>`), so command ordering can't misplace it.
  Capture still works from the main tab while popped (query/snapshot aren't window-bound).
- Captures land in `app_data_dir()/screenshots/`; "Save Screenshot" copies to
  `~/Desktop/Aira <date> at <time>.png`.
- `useOutsideClose` moved from `StatusBar.tsx` to `ui.tsx` for reuse.

### Pending runtime verification (`bun tauri dev`, GUI)
- Element / region / full-page capture, Send to agent (Claude Code shows `[Image #1]`), Save.
- Device row: real CSS widths at scaled zoom; Sync navigation + scroll.
- Pop out / Bring Back / red close; closing the tab closes the pop-out.
- Cookie import from Arc/Chrome (Keychain prompt) → signed in; per-site import.
- `window.__TAURI__` undefined in tab, device panes and pop-out.

### Revisions after first runtime test (2026-11-10)
- **Pane ids** use `<tabId>/<device>`: Tauri labels only allow alphanumerics, `-`, `/`, `:`, `_`, and
  a `~` made `add_child` assert silently (empty device frames). `browser_open` now rejects bad ids.
- **Device view is a toggle** (toolbar `devices`), with its own bar in the layout: quick chips
  (`Config.quickDevices`, default iPhone/Pixel/iPad/Laptop/Desktop) plus anything else the tab shows,
  **More devices…** dialog with 25 presets in four groups, pin-to-quick-bar, and saved custom sizes
  (`Config.customDevices`, shared by tabs, deletable). `Tab.deviceView` keeps the selection when off.
- **Scale fits height only**; the row scrolls sideways (centered while it fits).
- **Stills instead of blank:** a pane overlapped by a popover/menu/modal, or scrolled partly out of
  the row (native views ignore CSS clipping), shows a WKWebView snapshot (`browser_still`) and hides
  the live webview until it's clear again. Replaces the global "hide every webview under overlays".
- Panes resend bounds after every render when their rect changed (frames move without resizing).
- **Zoom in device view:** the toolbar's zoom scales every frame together (times the fit-to-height scale); the % resets to fit. Pages keep their device CSS width. No per-device sizes (tried, user preferred one zoom for the whole view).
- **Switching views doesn't reload:** single-view and device webviews stay alive (hidden) across the
  toggle; the side coming back navigates only if its last URL differs from the current one.
- **Pop-out works for device view:** Rust moves every pane (`panes_of`) in and out; the pop-out page
  gets the device list and Sync via its URL, runs the same `useDeviceSync` hook, and has zoom +
  Sync + Dock (devices are picked in the main tab, since the pop-out runs without app state).
  `browser_open` adds webviews to the calling window.
- **Per-device reload** button on each device's label.
- **Panes that never showed after a switch:** a remount's hide and show (and a still-creating open)
  raced, since Tauri runs commands concurrently. Each pane's open/show/hide/bounds calls now go
  through a per-webview queue (`inOrder`), and `browser_open` returns only once the webview exists.
