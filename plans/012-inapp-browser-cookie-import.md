# Plan: In-app Browser tab + cookie import for quick login

## Context

TODO item: "Browser tab with screenshot, debugging and other options." Aira is a Tauri 2
IDE. Devs constantly jump to an external browser to check a dev server, a dashboard, docs,
or a logged-in service. Goal: an embedded **Browser** tab inside the IDE (real native
webview, not an iframe — most sites block framing via `X-Frame-Options`/CSP) with full
controls, plus **cookie import** from the user's existing browsers so they're instantly
logged into the things they already use ("quick login into existing things").

User chose: **both** import modes (all-at-once per browser + per-site on demand) and the
**full** browser (address bar, back/forward/reload, devtools, screenshot, zoom, find,
user-agent toggle).

All 7 installed browsers are Chromium-family (Chrome, Arc, Brave, Edge, Dia, Vivaldi,
Opera). Safari is sandboxed (`Operation not permitted` without Full Disk Access) and
Firefox isn't installed — **both deferred**, Chromium-family covers every installed browser.

## Key findings (verified against local crate source)

- **Child webview**: `tauri 2.12` + `wry 0.57` support a second webview inside the main
  window behind the `unstable` Cargo feature. `Window::add_child(WebviewBuilder, pos, size)
  -> Webview`. Get the `Window` from the config-created main via
  `app.get_webview_window("main").as_ref::<Webview>().window()`.
- **No IPC breakage**: no Rust command takes `WebviewWindow` as an arg (all use `AppHandle`),
  so adding a child webview (which flips `main.is_webview_window()` to false) doesn't break
  command resolution. Verified in `lib.rs:128-175`.
- **Cookies are settable natively**: `Webview::set_cookie(tauri::Cookie)` (wry maps it to
  `WKHTTPCookieStore.setCookie`). No raw objc2 needed. Also `navigate(Url)`, `set_bounds(dpi::Rect)`,
  `open_devtools()`/`close_devtools()` (needs `devtools` feature in release), `set_zoom(f64)`,
  `show()`/`hide()`/`close()`. No `go_back`/`go_forward` — use `eval("history.back()")`.
- **Isolated persistent store**: `WebviewBuilder::data_store_identifier([u8;16])` (macOS 14+,
  we're on 27) gives the embedded browser its own persistent cookie/store, separate from the
  app webview. `data_directory` is a no-op on macOS.
- **Chromium cookie format** (schema v24 here): SQLite `Cookies` DB, `encrypted_value` is
  `v10` + AES-128-CBC (key = PBKDF2-HMAC-SHA1(keychain secret, salt `saltysalt`, 1003 iters,
  16 bytes), IV = 16×0x20), PKCS7 padding; schema ≥24 prepends a 32-byte domain hash to
  plaintext that must be stripped. Keychain secret = generic password, service `"<Browser> Safe
  Storage"`, account `"<Browser>"`. Confirmed entries exist for Chrome/Arc/Dia/Chromium/Opera.

## Security boundary (must-do, not optional)

The embedded browser loads arbitrary web content. It must **not** reach Tauri IPC.
- Change `capabilities/default.json` from `"windows": ["main"]` to `"webviews": ["main"]`.
  Capability matching is OR over windows/webviews globs; `webviews:["main"]` matches only the
  app webview (label == window label), **not** the browser child (`browser:*`). No capability
  grants the browser webview any permission, so `invoke` is denied there. `withGlobalTauri` is
  already off, so there's no `window.__TAURI__` either.
- The browser child's `on_navigation` allows only `http`/`https` (blocks `file:`, `tauri:`).
- Keychain reads trigger a macOS consent prompt per browser — that's the user's consent gate,
  keep it. Screenshot uses `screencapture`, which prompts for Screen Recording once.

## Implementation

### Commit 1 — Rust: embedded browser webview + controls

- `src-tauri/Cargo.toml`: `tauri = { version = "2", features = ["unstable", "devtools"] }`.
- New `src-tauri/src/browser.rs`, modeled on `agent.rs` (command + `AppHandle` + emit) and
  holding `Browsers(Mutex<HashSet<String>>)` of open tab ids (webview label = `browser:<tabId>`).
  Store registered via `.manage(browser::Browsers::default())` and `mod browser;` + handler
  entries in `lib.rs`.
- Commands (label resolved via `app.get_webview("browser:<id>")`):
  - `browser_open(app, id, url, x,y,w,h, user_agent?)`: `win.add_child(WebviewBuilder::new(label,
    WebviewUrl::External(url)).data_store_identifier(STORE_ID).devtools(true)
    .on_navigation(|u| u.scheme()=="http"||u.scheme()=="https")
    .on_page_load(|wv,_| emit url+title), LogicalPosition, LogicalSize)`. Emits `browser:nav`
    `{id,url,title,canGoBack}` to frontend.
  - `browser_bounds(app,id,x,y,w,h)` → `set_bounds(Rect{LogicalPosition,LogicalSize})`.
  - `browser_navigate(app,id,url)`, `browser_back/forward/reload` (`eval("history.back()"/…/
    "location.reload()")`), `browser_show/hide(app,id,visible)`, `browser_close(app,id)`.
  - `browser_devtools(app,id)` → `open_devtools()`; `browser_zoom(app,id,factor)` → `set_zoom`;
    `browser_find(app,id,text)` → `eval("window.find(<json>)")`.
  - `browser_screenshot(app,id) -> String(path)`: compute global rect from main window outer
    position + the webview's logical bounds, `Command::new("/usr/sbin/screencapture").args(["-o",
    "-x", "-R<x,y,w,h>", out])`, save to `app_data_dir()/screenshots/<ts>.png`, return path.
    `// ponytail: region screencapture; upgrade to WKWebView.takeSnapshot if occlusion matters.`
  - User-agent toggle = `browser_open` again with a mobile UA after `browser_close` (UA can't
    change post-build). `// ponytail: recreate webview to switch UA.`

### Commit 2 — Rust: Chromium cookie read + decrypt + import

- `Cargo.toml` deps: `rusqlite = { version = "0.32", features = ["bundled"] }`, `aes = "0.8"`,
  `cbc = "0.1"`, `pbkdf2 = "0.12"`, `sha1 = "0.10"`, `hmac = "0.12"`. `keyring` already present.
- In `browser.rs`:
  - `const BROWSERS: &[(name, support_subdir)]` for the Chromium family; `browser_sources() ->
    Vec<{browser,profile,path}>` scans `~/Library/Application Support/<subdir>/**/Cookies` that
    exist (profiles = `Default`, `Profile N`, etc.).
  - `keychain_secret(service)` via `keyring::Entry::new("<B> Safe Storage","<B>")` (fallback
    `security find-generic-password -ws`), `derive_key` (pbkdf2 sha1), `decrypt(key,blob,strip32)`
    (CBC + PKCS7, strip 32-byte prefix when meta.version≥24).
  - `cookies_import(app, id, browser, profile, host: Option<String>) -> usize`: copy the
    locked DB to a temp file, open read-only, `SELECT host_key,name,encrypted_value,path,
    expires_utc,is_secure,is_httponly,samesite FROM cookies [WHERE host_key LIKE host]`, decrypt,
    build `cookie::Cookie` (domain/path/secure/http_only/same_site/expires), skip expired, and
    `webview.set_cookie(c)` into the tab's store; return count. One fn serves **all-at-once**
    (`host=None`) and **per-site** (`host=Some(".example.com")`). All Keychain + sqlite work in
    `spawn_blocking` (matches `ai.rs`).
  - **Self-check** (`#[cfg(test)]`): encrypt a known plaintext with a fixed key via the same
    CBC path and assert `decrypt` round-trips, incl. the 32-byte-strip branch.

### Commit 3 — Frontend: Browser tab, store, nav UI, bounds sync

- `src/ipc.ts`: `Tab` union gets `| { id; kind:"browser"; url:string }`. Add `api.browser*` and
  `api.cookies*` wrappers (invoke).
- `src/store.ts`: `openBrowserTab(url?)` (default `about:blank` or a homepage); `closeTab`
  calls `api.browserClose` for browser tabs; `onMenu` handles `"new-browser"`; add menu item
  `new-browser` ("New Browser Tab", e.g. `Cmd+Shift+B`) in `lib.rs` File submenu; add to
  `src/lib/shortcuts.ts`.
- New `src/components/BrowserView.tsx`: toolbar (back/forward/reload, address input, go,
  devtools, zoom ±, find, screenshot, user-agent toggle, **Import cookies** button) + an empty
  `.browser-body` div. On mount: `browser_open` with the body's `getBoundingClientRect()`
  (logical px). `ResizeObserver` on the body + `onLayoutChanged` → `browser_bounds`. Listen
  `browser:nav` → update address/title. On unmount (tab switch): `browser_hide`; on remount:
  `browser_show` + re-send bounds. On store `dialog` open → `browser_hide` (native webview
  floats above React modals/popovers), restore on close. Close → `browser_close`.
- `src/components/MainTabs.tsx`: render `{current?.kind==="browser" && <BrowserView key={id}
  tab={current}/>}`; `TabButton` globe icon + hostname title for browser kind.

### Commit 4 — Frontend: cookie import UI + remaining controls

- Cookie import popover (reuse `Modal`/`useOutsideClose`): lists `browser_sources()` grouped by
  browser → profile, with **"Import all logins"** (host=None) and, when the browser is on a
  site, **"Import login for <host>"** (host=current domain). Shows count + a "<n> cookies
  imported" toast, then `browser_reload`.
- Wire screenshot (save → reveal/toast), devtools, zoom, find bar, UA toggle to the
  commands from Commit 1.

### Commit 5 — Docs

- `TODO.md`: tick the Browser item, move to Done with version + date.
- Copy this plan to `plans/012-inapp-browser-cookie-import.md` (plans-folder convention) and add
  an implementation-status note like plan 011.

## Files touched

- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, **new** `src-tauri/src/browser.rs`,
  `src-tauri/capabilities/default.json`
- `src/ipc.ts`, `src/store.ts`, `src/lib/shortcuts.ts`, `src/components/MainTabs.tsx`,
  **new** `src/components/BrowserView.tsx`, `src/styles.css` (toolbar), `TODO.md`

## Verification

1. `cd src-tauri && cargo test --lib` — decrypt round-trip passes.
2. `bun run typecheck && bun run build` clean (check `package.json` for exact script names).
3. `bun tauri dev`:
   - New Browser Tab (`Cmd+Shift+B`), navigate to a dev server + an external site.
   - Resize left/right panels and the window — the webview tracks the body rect.
   - Switch to another tab and open Settings — the browser webview hides (no float-over).
   - Devtools opens; zoom ±; find highlights; screenshot writes a PNG (grant Screen Recording).
   - Import all logins from Arc/Default (approve the Keychain prompt) → reload `github.com` →
     logged in. Then per-site import on a second site.
   - Confirm a site in the browser cannot call Tauri (`window.__TAURI__` undefined; invoke denied).

## Risks / notes

- `add_child` flips `main.is_webview_window()` to false. Safe here (no `WebviewWindow` command
  args) — re-check if any such command is added later.
- Native webview floats above all React UI in its rect; handled by hide-on-dialog + hide-on-
  tab-switch. Context menus/popovers that overlap the browser body also need the webview hidden
  while open (same `dialog`/open-state hook).
- All-at-once import may set thousands of cookies (one round-trip each). Skip expired; if slow,
  filter to `is_persistent`. `// ponytail: per-cookie set_cookie; batch if it drags.`
- `screencapture` and Keychain prompts are expected first-run consent dialogs, not bugs.

---

## Implementation status (2026-11-10)

Built. Backend compiles, 25 Rust tests pass (3 new cookie-decrypt tests), frontend `tsc && vite build` clean.

- **Rust** `src-tauri/src/browser.rs` (new): child-webview commands (`browser_open` idempotent for
  tab re-activation, `browser_bounds`, `browser_navigate`, `browser_nav_action`, `browser_show`,
  `browser_close`, `browser_devtools`, `browser_zoom`, `browser_find`, `browser_screenshot`) +
  Chromium cookie read/decrypt/import (`cookie_sources`, `cookie_import`). `Browsers` state tracks
  each webview's logical bounds for screenshots.
- `Cargo.toml`: `tauri` features `unstable` + `devtools`; added `rusqlite` (bundled), `aes`, `cbc`,
  `pbkdf2`, `sha1`.
- `lib.rs`: `mod browser`, state, 12 commands, `New Browser Tab` menu item (`⇧⌘B`).
- `capabilities/default.json`: `windows:["main"]` → `webviews:["main"]` (security: child webviews
  get no IPC).
- **Frontend**: `ipc.ts` (Tab `browser` kind, `CookieSource`, `api.browser*`/`cookie*`), `store.ts`
  (`openBrowserTab`, `setBrowserUrl`, `closeTab`/`onMenu` wiring), `shortcuts.ts`,
  `MainTabs.tsx` (render + tab icon/title), **new** `BrowserView.tsx` (toolbar, bounds sync,
  hide-on-dialog, cookie import popover), `styles.css`.

### Pending runtime verification (needs `bun tauri dev`, GUI)
- Child webview positions over the body and tracks panel/window resize.
- Hides on tab switch and when a modal opens; shows again on return.
- Devtools, zoom, find, screenshot (grant Screen Recording), mobile/desktop UA toggle.
- Cookie import: Keychain prompt per browser, then reload lands logged in (all-logins + per-site).
- Confirm embedded sites cannot reach Tauri IPC (`window.__TAURI__` undefined).

---

## Revision (2026-11-10): native webview → iframe

Runtime testing showed the floating native child webview had unavoidable problems: it rendered
over the app UI (covering the `+` popover and side panels), its bounds landed full-width instead
of in the tab column, and its devtools docked over everything and didn't restore. The native
overlay fundamentally fights the React layout and couldn't be verified headlessly.

Switched to an in-layout **iframe** (user decision). This removes the overlay entirely: popovers,
panels, and devtools behave normally, sizing is pure CSS, and loading is visible via a top bar.
Aimed at localhost dev servers. Trade-offs accepted: sites that block framing (X-Frame-Options /
CSP frame-ancestors, e.g. google, github) won't embed — use the open-in-system-browser button — and
the cookie-import "quick login" feature was dropped (it needs real cross-origin navigation the
iframe can't do).

Reverted: `browser.rs` deleted; `Cargo.toml` (removed `unstable`/`devtools` features + rusqlite/
aes/cbc/pbkdf2/sha1); `lib.rs` (module/state/commands); `capabilities/default.json`. Kept: the
`New Browser Tab` menu item + `⇧⌘B` shortcut + `+`-menu entry. Added `frame-src 'self' http: https:`
to the CSP so the iframe can load pages. `BrowserView.tsx` rewritten as an iframe with its own
back/forward history stack (cross-origin iframes don't expose in-page navigation), reload, zoom,
and loading bar.

---

## Revision 2 (2026-11-10): native webview, done right

The iframe couldn't load sites that send `X-Frame-Options` (Google, GitHub), so the tab went back to
a native child webview, this time with the overlay problems fixed:

- **Z-order:** a global `overlays` counter in the store (`useOverlay` in `ui.tsx`) is raised by the
  `+` menu and the status-bar popovers; the webview hides while any is open, and under modals.
- **Bounds:** `browser_open` reasserts `set_bounds` after `add_child`, `browser_show` reasserts on
  every show, and the frontend keeps them in sync with a `ResizeObserver`.
- **Devtools:** the docked Web Inspector stretches the webview across the window and WebKit leaves it
  there on close; `browser_devtools` now watches `is_devtools_open()` and restores the tab's rect.
- **Loading:** `on_page_load` Started/Finished events drive the loading bar (no timeouts).
- **Security:** `capabilities/default.json` is scoped to `webviews: ["main"]`, so the browser
  webview gets no IPC.

Added on top:

- **New-tab page** (blank tabs create no webview until a page is opened): the space's dev servers
  (named after their script, renamable, right-click menu), per-space pinned links (`Space.pins`) and
  recent pages (`Config.browserHistory`, excluding what the space already shows).
- **Favicons:** `browser_favicon` fetches the page's `<link rel=icon>` (else `/favicon.ico`) in Rust
  and returns a data URL, so localhost servers get their icon; also used on browser tabs.
- **Launcher:** hovering `+` shows the quick menu; clicking opens an "Open…" tab (`Tab.kind =
  "launcher"`) with the space's servers and pins, a terminal, a browser tab and each installed agent.
  The empty state renders the same page.
- **Agents:** only installed agents in the `+` menu; Settings → Coding agents hides any
  (`settings.hiddenAgents`).

Cookie import is not in this revision; it's back on the TODO list.

### Follow-ups (2026-11-10)

- One `LinkTile` for dev servers, pins and recent pages: rename by double-click, hover pencil or
  right-click (`Space.serverNames`, `BrowserPin.title`, `BrowserHistoryEntry.title`).
- Dev-server cards show running servers only; any can be hidden per space (`Space.hiddenServers`),
  with "N hidden" to reveal and unhide them.
- Recent: Pin to This Workspace, Remove from Recent.
- Tabs reorder by dragging (pointer events, not HTML5 drag-and-drop, which Tauri's file-drop
  handler can swallow).
