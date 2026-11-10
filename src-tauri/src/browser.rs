//! Embedded browser: a native child webview the frontend positions over the Browser tab's body.
//! Being a real top-level webview (not an iframe), it loads any site — X-Frame-Options doesn't
//! apply. The frontend keeps it sized to the tab's content rect and hides it under menus/dialogs.

use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Separate persistent data store (macOS 14+) so the embedded browser's cookies/storage live apart
/// from the app webview.
const STORE_ID: [u8; 16] = [
    0xa1, 0x7a, 0xb2, 0x05, 0x4c, 0x0d, 0x4e, 0x11, 0x9c, 0x56, 0xb3, 0x7a, 0x62, 0x01, 0xde, 0x50,
];

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn label(id: &str) -> String {
    format!("browser:{id}")
}

#[derive(Clone, Copy, Default)]
struct Bounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct Browsers(Mutex<HashMap<String, Bounds>>);

/// Browser tabs currently in a pop-out window (`popout-<id>`).
#[derive(Default)]
pub struct Popped(Mutex<HashSet<String>>);

pub fn popout_label(id: &str) -> String {
    format!("popout-{id}")
}

/// Placement (bounds/show) belongs to whichever window holds the webview: the pop-out while popped,
/// else the main window. Commands from the other one are ignored, so a late hide or resize from the
/// main tab can't yank a popped-out page around.
fn owns(app: &AppHandle, caller: &tauri::Webview, id: &str) -> bool {
    let tab = id.split('/').next().unwrap_or(id);
    let popped = app.state::<Popped>().0.lock().unwrap().contains(tab);
    popped == (caller.label() == popout_label(tab))
}

fn webview(app: &AppHandle, id: &str) -> Option<tauri::Webview> {
    app.get_webview(&label(id))
}

fn rect(b: Bounds) -> tauri::Rect {
    tauri::Rect {
        position: LogicalPosition::new(b.x, b.y).into(),
        size: LogicalSize::new(b.w, b.h).into(),
    }
}

/// Creates the child webview over the given logical rect and loads `url`. Idempotent: on a tab
/// re-activation the webview already exists, so it just repositions and shows.
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    caller: tauri::Webview,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    user_agent: Option<String>,
    zoom: Option<f64>,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(err)?;
    // Tauri asserts on bad labels inside add_child (on the main thread), which fails silently.
    if !label(&id).chars().all(|c| c.is_alphanumeric() || "-/:_".contains(c)) {
        return Err(format!("bad browser id: {id}"));
    }
    if !owns(&app, &caller, &id) {
        return Ok(());
    }
    let bounds = Bounds { x, y, w, h };
    app.state::<Browsers>().0.lock().unwrap().insert(id.clone(), bounds);

    if let Some(wv) = webview(&app, &id) {
        let _ = wv.set_bounds(rect(bounds));
        if let Some(z) = zoom {
            let _ = wv.set_zoom(z);
        }
        return wv.show().map_err(err);
    }

    let app2 = app.clone();
    let ev_id = id.clone();
    // Into the window that asked (the main tab, or a pop-out). add_child must run on the main thread.
    let host = caller.window();
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let emit = app2.clone();
        let nav_id = ev_id.clone();
        let mut builder = tauri::webview::WebviewBuilder::new(label(&ev_id), WebviewUrl::External(parsed))
            .data_store_identifier(STORE_ID)
            .devtools(true)
            .on_page_load(move |_wv, payload| {
                use tauri::webview::PageLoadEvent;
                let loading = matches!(payload.event(), PageLoadEvent::Started);
                let _ = emit.emit("browser:nav", json!({ "id": nav_id, "url": payload.url().to_string(), "loading": loading }));
            });
        if let Some(ua) = user_agent {
            builder = builder.user_agent(&ua);
        }
        let made = host.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h)).map(|wv| {
            // add_child's initial placement can be unreliable; reassert the latest bounds (the
            // frontend may have moved the pane while this was queued).
            let latest = app2.state::<Browsers>().0.lock().unwrap().get(&ev_id).copied().unwrap_or(bounds);
            let _ = wv.set_bounds(rect(latest));
            if let Some(z) = zoom {
                let _ = wv.set_zoom(z);
            }
        });
        let _ = tx.send(made.map_err(err));
    })
    .map_err(err)?;
    // Return once the webview exists, so a show/hide/open queued behind this one finds it.
    rx.await.map_err(err)?
}

#[tauri::command]
pub async fn browser_bounds(app: AppHandle, caller: tauri::Webview, id: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if !owns(&app, &caller, &id) {
        return Ok(());
    }
    let b = Bounds { x, y, w, h };
    app.state::<Browsers>().0.lock().unwrap().insert(id.clone(), b);
    if let Some(wv) = webview(&app, &id) {
        wv.set_bounds(rect(b)).map_err(err)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(err)?;
    webview(&app, &id).ok_or("no browser")?.navigate(parsed).map_err(err)
}

/// Back / forward / reload via the page's own history (wry exposes no go_back/go_forward).
#[tauri::command]
pub async fn browser_nav_action(app: AppHandle, id: String, action: String) -> Result<(), String> {
    let js = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("bad action".into()),
    };
    webview(&app, &id).ok_or("no browser")?.eval(js).map_err(err)
}

/// Shows or hides the webview, reasserting bounds when showing.
#[tauri::command]
pub async fn browser_show(app: AppHandle, caller: tauri::Webview, id: String, visible: bool) -> Result<(), String> {
    let Some(wv) = webview(&app, &id).filter(|_| owns(&app, &caller, &id)) else { return Ok(()) };
    if visible {
        let b = app.state::<Browsers>().0.lock().unwrap().get(&id).copied();
        if let Some(b) = b {
            let _ = wv.set_bounds(rect(b));
        }
        wv.show().map_err(err)
    } else {
        wv.hide().map_err(err)
    }
}

/// Closes the tab's webview and its device panes (`<id>/<device>`).
#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
    let pane = format!("{id}/");
    app.state::<Browsers>().0.lock().unwrap().retain(|k, _| k != &id && !k.starts_with(&pane));
    for wv in panes_of(&app, &id) {
        let _ = wv.close();
    }
    if app.state::<Popped>().0.lock().unwrap().remove(&id) {
        if let Some(w) = app.get_window(&popout_label(&id)) {
            let _ = w.destroy();
        }
        let _ = app.emit("browser:docked", &id);
    }
    Ok(())
}

// ---------- pop-out windows ----------

/// Moves the tab's webview into a window of its own. That window loads the app UI in pop-out mode
/// (`?popout=<id>`): a toolbar that drives the same webview, which it then positions.
#[tauri::command]
pub async fn browser_popout(app: AppHandle, id: String, url: String, zoom: f64, theme: String, devices: Vec<String>, sync: bool) -> Result<(), String> {
    let panes = panes_of(&app, &id);
    if panes.is_empty() {
        return Err("no browser".into());
    }
    let mut q = tauri::Url::parse("http://x/").map_err(err)?;
    q.query_pairs_mut()
        .append_pair("popout", &id)
        .append_pair("url", &url)
        .append_pair("zoom", &zoom.to_string())
        .append_pair("theme", &theme)
        .append_pair("devices", &devices.join(","))
        .append_pair("sync", if sync { "1" } else { "" });
    let page = format!("index.html?{}", q.query().unwrap_or(""));
    let title = tauri::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "Browser".into());
    let win = tauri::WebviewWindowBuilder::new(&app, popout_label(&id), WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(1100.0, 800.0)
        .min_inner_size(420.0, 320.0)
        .build()
        .map_err(err)?;
    app.state::<Popped>().0.lock().unwrap().insert(id.clone());
    for wv in panes {
        let _ = wv.hide(); // until the pop-out lays out and shows it
        wv.reparent(&win.as_ref().window()).map_err(err)?;
    }
    Ok(())
}

/// The tab's webviews: its single view (`browser:<id>`) and device panes (`browser:<id>/<device>`).
fn panes_of(app: &AppHandle, id: &str) -> Vec<tauri::Webview> {
    let (one, pre) = (label(id), label(&format!("{id}/")));
    app.webviews().into_iter().filter(|(l, _)| *l == one || l.starts_with(&pre)).map(|(_, w)| w).collect()
}

/// Puts a popped-out webview back in the main window (hidden; the tab re-shows it) and closes the
/// pop-out. Safe to call twice: the window's own close runs it too.
pub fn dock(app: &AppHandle, id: &str) {
    if !app.state::<Popped>().0.lock().unwrap().remove(id) {
        return;
    }
    if let Some(main) = app.get_webview("main") {
        for wv in panes_of(app, id) {
            let _ = wv.hide();
            let _ = wv.reparent(&main.window());
        }
    }
    if let Some(w) = app.get_window(&popout_label(id)) {
        let _ = w.destroy();
    }
    let _ = app.emit("browser:docked", id);
}

#[tauri::command]
pub async fn browser_dock(app: AppHandle, id: String) -> Result<(), String> {
    let a = app.clone();
    app.run_on_main_thread(move || dock(&a, &id)).map_err(err)
}

// ---------- page scripts & capture ----------

/// Runs `js` in the page and returns its result. Scripts must evaluate to a string or number: wry
/// JSON-encodes the value (and panics on DOM objects). `None` on error/timeout or a void result.
async fn eval(wv: &tauri::Webview, js: &str) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    wv.eval_with_callback(js, move |s| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(s);
        }
    })
    .ok()?;
    let raw = tokio::time::timeout(std::time::Duration::from_millis(800), rx).await.ok()?.ok()?;
    match serde_json::from_str::<serde_json::Value>(&raw).ok()? {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Null => None,
        v => Some(v.to_string()),
    }
}

/// Evaluates `js` in each of `ids`' pages (the frontend's only way to read page state, since the
/// browser webviews have no IPC). Results line up with `ids`.
#[tauri::command]
pub async fn browser_query(app: AppHandle, ids: Vec<String>, js: String) -> Result<Vec<Option<String>>, String> {
    let mut out = Vec::with_capacity(ids.len());
    for id in &ids {
        out.push(match webview(&app, id) {
            Some(wv) => eval(&wv, &js).await,
            None => None,
        });
    }
    Ok(out)
}

/// PNG of the webview's visible content, or of `rect` (points, top-left origin) within it.
/// WKWebView's own snapshot: no Screen Recording permission, unaffected by windows on top.
#[cfg(target_os = "macos")]
async fn snapshot_png(wv: &tauri::Webview, rect: Option<(f64, f64, f64, f64)>) -> Result<Vec<u8>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    wv.with_webview(move |p| unsafe {
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
        use objc2_core_foundation::{CGPoint, CGRect, CGSize};
        use objc2_foundation::{NSDictionary, NSError};
        use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
        let wk: &WKWebView = &*(p.inner() as *const WKWebView);
        let cfg = WKSnapshotConfiguration::new(objc2::MainThreadMarker::new_unchecked());
        if let Some((x, y, w, h)) = rect {
            cfg.setRect(CGRect::new(CGPoint::new(x, y), CGSize::new(w, h)));
        }
        let tx = Mutex::new(Some(tx));
        let done = block2::RcBlock::new(move |img: *mut NSImage, _e: *mut NSError| {
            let png = img
                .as_ref()
                .and_then(|i| i.TIFFRepresentation())
                .and_then(|t| NSBitmapImageRep::imageRepWithData(&t))
                .and_then(|r| r.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()))
                .map(|d| d.to_vec())
                .ok_or_else(|| "snapshot failed".to_string());
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(png);
            }
        });
        wk.takeSnapshotWithConfiguration_completionHandler(Some(&cfg), &done);
    })
    .map_err(err)?;
    rx.await.map_err(err)?
}

/// Writes a capture under app data (agents get this path) and returns it.
/// ponytail: never cleaned up; prune old files if the folder grows.
fn write_shot(app: &AppHandle, png: &[u8]) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join("screenshots");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_millis();
    let path = dir.join(format!("{ms}.png"));
    std::fs::write(&path, png).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Captures `rect` (logical points within the webview, i.e. CSS px × zoom) of browser `id`.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_snapshot(app: AppHandle, id: String, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    let wv = webview(&app, &id).ok_or("no browser")?;
    let png = snapshot_png(&wv, Some((x, y, w, h))).await?;
    write_shot(&app, &png)
}

/// The visible page as a PNG data URL: a still the tab shows in place of the webview while app UI
/// (a popover) covers it, since the native webview would draw over that UI.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_still(app: AppHandle, id: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let wv = webview(&app, &id).ok_or("no browser")?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(snapshot_png(&wv, None).await?)))
}

/// One decoded PNG slice of a full-page capture; `skip` = top rows already covered by the slice before.
struct Slice {
    data: Vec<u8>,
    width: u32,
    height: u32,
    skip: u32,
}

/// Stacks slices top to bottom, dropping each one's `skip` rows. All slices share width and pixel format.
fn stitch(slices: &[Slice], bpp: usize) -> (Vec<u8>, u32, u32) {
    let width = slices.first().map_or(0, |s| s.width);
    let row = width as usize * bpp;
    let mut out = Vec::new();
    for s in slices {
        let skip = s.skip.min(s.height) as usize;
        out.extend_from_slice(&s.data[skip * row..s.height as usize * row]);
    }
    let height = (out.len() / row.max(1)) as u32;
    (out, width, height)
}

fn decode_png(png: &[u8]) -> Result<(Vec<u8>, png::OutputInfo), String> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(png)).read_info().map_err(err)?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("png too large")?];
    let info = reader.next_frame(&mut buf).map_err(err)?;
    buf.truncate(info.buffer_size());
    Ok((buf, info))
}

/// Whole-page capture: scroll top to bottom one viewport at a time, snapshot each, stitch. Fixed and
/// sticky elements are hidden after the first slice so headers don't repeat. Restores scroll after.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_fullpage(app: AppHandle, id: String) -> Result<String, String> {
    const HIDE_FIXED: &str = "(()=>{const h=[];for(const e of document.querySelectorAll('body *')){const p=getComputedStyle(e).position;if(p==='fixed'||p==='sticky'){h.push([e,e.style.visibility]);e.style.visibility='hidden'}}window.__airaHidden=h;return 'ok'})()";
    const RESTORE: &str = "(()=>{(window.__airaHidden||[]).forEach(([e,v])=>e.style.visibility=v);window.__airaHidden=null;return 'ok'})()";
    let wv = webview(&app, &id).ok_or("no browser")?;
    let dims = eval(&wv, "JSON.stringify([document.documentElement.scrollHeight,innerHeight,scrollX,scrollY])").await.ok_or("page not ready")?;
    let [total, vh, sx, sy]: [f64; 4] = serde_json::from_str(&dims).map_err(err)?;
    // ponytail: capped at 20k CSS px; tile further if needed.
    let total = total.min(20_000.0);
    let mut slices = Vec::new();
    let (mut covered, mut bpp, mut color, mut depth) = (0.0_f64, 4, png::ColorType::Rgba, png::BitDepth::Eight);
    while covered < total - 0.5 {
        let target = covered.min((total - vh).max(0.0));
        let at = eval(&wv, &format!("(()=>{{scrollTo(0,{target});return String(scrollY)}})()")).await.and_then(|s| s.parse::<f64>().ok()).unwrap_or(target);
        tokio::time::sleep(std::time::Duration::from_millis(200)).await; // let it paint (and lazy images start)
        let (data, info) = decode_png(&snapshot_png(&wv, None).await?)?;
        let px_per_css = info.height as f64 / vh;
        bpp = info.color_type.samples() * (info.bit_depth as usize).div_ceil(8);
        (color, depth) = (info.color_type, info.bit_depth);
        slices.push(Slice { data, width: info.width, height: info.height, skip: ((covered - at).max(0.0) * px_per_css).round() as u32 });
        if slices.len() == 1 {
            eval(&wv, HIDE_FIXED).await;
        }
        if at + vh >= total - 0.5 {
            break; // bottom reached (or the page can't scroll further)
        }
        covered = at + vh;
    }
    eval(&wv, RESTORE).await;
    eval(&wv, &format!("(()=>{{scrollTo({sx},{sy});return 'ok'}})()")).await;

    let (pixels, w, h) = stitch(&slices, bpp);
    let mut png_out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut png_out, w, h);
        enc.set_color(color);
        enc.set_depth(depth);
        enc.write_header().map_err(err)?.write_image_data(&pixels).map_err(err)?;
    }
    write_shot(&app, &png_out)
}

/// Copies a capture to the Desktop, named like macOS screenshots.
#[tauri::command]
pub async fn browser_save_shot(src: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(err)?;
    let out = std::process::Command::new("date").arg("+%Y-%m-%d at %H.%M.%S").output().map_err(err)?;
    let stamp = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let dest = std::path::Path::new(&home).join("Desktop").join(format!("Aira {stamp}.png"));
    std::fs::copy(&src, &dest).map_err(err)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Puts the webview back in the tab's last-known rect.
fn restore_bounds(app: &AppHandle, id: &str, wv: &tauri::Webview) {
    let b = app.state::<Browsers>().0.lock().unwrap().get(id).copied();
    if let Some(b) = b {
        let _ = wv.set_bounds(rect(b));
    }
}

#[tauri::command]
pub async fn browser_devtools(app: AppHandle, id: String) -> Result<(), String> {
    let wv = webview(&app, &id).ok_or("no browser")?;
    let opening = !wv.is_devtools_open();
    let w = wv.clone();
    app.run_on_main_thread(move || if opening { w.open_devtools() } else { w.close_devtools() }).map_err(err)?;

    // The docked Web Inspector resizes the webview to the whole window, and WebKit leaves it that
    // size when the inspector closes (our toggle or its own close button). Watch for the close and
    // restore the tab's rect. ponytail: 250ms poll, ~1h cap; swap for an inspector delegate if needed.
    std::thread::spawn(move || {
        let tick = std::time::Duration::from_millis(250);
        let mut seen_open = !opening;
        for i in 0..14_400 {
            std::thread::sleep(tick);
            let Some(wv) = webview(&app, &id) else { return };
            if wv.is_devtools_open() {
                seen_open = true;
                continue;
            }
            if seen_open {
                restore_bounds(&app, &id, &wv);
                std::thread::sleep(tick);
                restore_bounds(&app, &id, &wv); // WebKit can relayout once more after detaching
                return;
            }
            if i > 8 {
                return; // asked to open but it never did
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn browser_zoom(app: AppHandle, id: String, factor: f64) -> Result<(), String> {
    webview(&app, &id).ok_or("no browser")?.set_zoom(factor).map_err(err)
}

// ---------- cookie import (Chromium-family browsers) ----------

/// (name shown, dir under ~/Library/Application Support, Keychain "<x> Safe Storage" name)
const COOKIE_BROWSERS: &[(&str, &str, &str)] = &[
    ("Arc", "Arc/User Data", "Arc"),
    ("Chrome", "Google/Chrome", "Chrome"),
    ("Brave", "BraveSoftware/Brave-Browser", "Brave"),
    ("Edge", "Microsoft Edge", "Microsoft Edge"),
    ("Dia", "Dia/User Data", "Dia"),
    ("Chromium", "Chromium", "Chromium"),
    ("Vivaldi", "Vivaldi", "Vivaldi"),
    ("Opera", "com.operasoftware.Opera", "Opera"),
];

fn support_dir(dir: &str) -> std::path::PathBuf {
    std::path::Path::new(&std::env::var("HOME").unwrap_or_default()).join("Library/Application Support").join(dir)
}

/// A profile's cookie DB: `<profile>/Network/Cookies` (newer) or `<profile>/Cookies`. Profile "" = the
/// browser dir itself (Opera keeps one profile there).
fn cookie_db(dir: &str, profile: &str) -> Option<std::path::PathBuf> {
    let base = support_dir(dir).join(profile);
    [base.join("Network/Cookies"), base.join("Cookies")].into_iter().find(|p| p.is_file())
}

#[derive(serde::Serialize)]
pub struct CookieSource {
    browser: String,
    profile: String,
    /// The profile's display name from the browser's `Local State`, else its folder name.
    name: String,
}

#[tauri::command]
pub async fn cookie_sources() -> Vec<CookieSource> {
    let mut out = Vec::new();
    for (browser, dir, _) in COOKIE_BROWSERS {
        let root = support_dir(dir);
        let names: serde_json::Value = std::fs::read(root.join("Local State")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut profiles: Vec<String> = std::fs::read_dir(&root)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|p| p == "Default" || p.starts_with("Profile "))
            .collect();
        profiles.sort();
        profiles.insert(0, String::new());
        for profile in profiles.into_iter().filter(|p| cookie_db(dir, p).is_some()) {
            let name = names["profile"]["info_cache"][&profile]["name"].as_str().map(str::to_string).unwrap_or_else(|| if profile.is_empty() { "Default".into() } else { profile.clone() });
            out.push(CookieSource { browser: browser.to_string(), profile, name });
        }
    }
    out
}

/// macOS CommonCrypto (in libSystem): Chromium's cookie crypto without extra crates.
#[cfg(target_os = "macos")]
mod cc {
    extern "C" {
        fn CCKeyDerivationPBKDF(alg: u32, pw: *const u8, pw_len: usize, salt: *const u8, salt_len: usize, prf: u32, rounds: u32, out: *mut u8, out_len: usize) -> i32;
        fn CCCrypt(op: u32, alg: u32, opts: u32, key: *const u8, key_len: usize, iv: *const u8, data: *const u8, data_len: usize, out: *mut u8, out_avail: usize, out_moved: *mut usize) -> i32;
    }
    /// PBKDF2-HMAC-SHA1 → 16-byte key.
    pub fn pbkdf2_sha1(pw: &[u8], salt: &[u8], rounds: u32) -> [u8; 16] {
        let mut k = [0u8; 16];
        // kCCPBKDF2 = 2, kCCPRFHmacAlgSHA1 = 1
        unsafe { CCKeyDerivationPBKDF(2, pw.as_ptr(), pw.len(), salt.as_ptr(), salt.len(), 1, rounds, k.as_mut_ptr(), k.len()) };
        k
    }
    /// AES-128-CBC with PKCS7 padding.
    pub fn aes_cbc(encrypt: bool, key: &[u8; 16], iv: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> {
        let mut out = vec![0u8; data.len() + 16];
        let mut n = 0;
        // kCCEncrypt = 0 / kCCDecrypt = 1, kCCAlgorithmAES128 = 0, kCCOptionPKCS7Padding = 1
        let status = unsafe { CCCrypt(u32::from(!encrypt), 0, 1, key.as_ptr(), 16, iv.as_ptr(), data.as_ptr(), data.len(), out.as_mut_ptr(), out.len(), &mut n) };
        (status == 0).then(|| {
            out.truncate(n);
            out
        })
    }
}

const CBC_IV: [u8; 16] = [b' '; 16];

/// Chromium's macOS cookie key, from the browser's Keychain secret.
#[cfg(target_os = "macos")]
fn cookie_key(secret: &[u8]) -> [u8; 16] {
    cc::pbkdf2_sha1(secret, b"saltysalt", 1003)
}

/// Decrypts a `v10` cookie blob. Schema ≥ 24 prefixes the plaintext with a 32-byte SHA-256 of the domain.
#[cfg(target_os = "macos")]
fn decrypt_cookie(key: &[u8; 16], blob: &[u8], domain_hash: bool) -> Option<String> {
    let plain = cc::aes_cbc(false, key, &CBC_IV, blob.strip_prefix(b"v10")?)?;
    let plain = if domain_hash { plain.get(32..)? } else { &plain[..] };
    String::from_utf8(plain.to_vec()).ok()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).filter_map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()).collect()
}

/// Rows as JSON from the system `sqlite3`, opened immutable so a running browser's lock doesn't matter.
/// ponytail: CLI instead of a bundled SQLite; swap for rusqlite if this ever needs to be faster.
fn sqlite_rows(db: &std::path::Path, sql: &str) -> Result<Vec<serde_json::Value>, String> {
    let path = db.to_string_lossy().replace('%', "%25").replace('?', "%3f").replace('#', "%23");
    let out = std::process::Command::new("/usr/bin/sqlite3").args(["-readonly", "-json", &format!("file:{path}?immutable=1"), sql]).output().map_err(err)?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    if out.stdout.iter().all(u8::is_ascii_whitespace) {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&out.stdout).map_err(err)
}

/// The site a host belongs to, so a per-site import also brings cookies set on parent domains
/// (`app.example.com` → `example.com`). ponytail: naive two-label rule plus short ccSLDs (`co.uk`).
fn site_of(host: &str) -> String {
    let labels: Vec<&str> = host.trim_start_matches('.').split('.').collect();
    let n = labels.len();
    let keep = if n >= 3 && labels[n - 1].len() == 2 && labels[n - 2].len() <= 3 { 3 } else { 2 };
    labels[n.saturating_sub(keep)..].join(".")
}

/// Any webview on the browser's data store (cookies set on one reach them all); a hidden throwaway
/// one when no browser page is open yet.
async fn store_webview(app: &AppHandle) -> Result<(tauri::Webview, bool), String> {
    if let Some(wv) = app.webviews().into_iter().find(|(l, _)| l.starts_with("browser:")).map(|(_, w)| w) {
        return Ok((wv, false));
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let a = app.clone();
    app.run_on_main_thread(move || {
        let made = a.get_webview("main").ok_or_else(|| "no main window".to_string()).and_then(|m| {
            let b = tauri::webview::WebviewBuilder::new("browser:cookie-import", WebviewUrl::External("about:blank".parse().unwrap())).data_store_identifier(STORE_ID);
            m.window().add_child(b, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)).map_err(err)
        });
        let _ = tx.send(made);
    })
    .map_err(err)?;
    let wv = rx.await.map_err(err)??;
    let _ = wv.hide();
    Ok((wv, true))
}

/// Copies a browser profile's cookies (all, or one site's) into the embedded browser, so the user is
/// signed in where they already are. Reading the Keychain secret shows macOS's consent prompt.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn cookie_import(app: AppHandle, browser: String, profile: String, host: Option<String>) -> Result<usize, String> {
    use tauri::webview::cookie::{time::OffsetDateTime, Cookie, SameSite};
    let &(_, dir, kc) = COOKIE_BROWSERS.iter().find(|b| b.0 == browser).ok_or("unknown browser")?;
    let db = cookie_db(dir, &profile).ok_or("no cookies for that profile")?;
    let site = host.as_deref().map(site_of).filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    let cookies = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Cookie<'static>>, String> {
        let secret = keyring::Entry::new(&format!("{kc} Safe Storage"), kc).and_then(|e| e.get_password()).map_err(|e| format!("Keychain: {e}"))?;
        let key = cookie_key(secret.as_bytes());
        let version = sqlite_rows(&db, "select value from meta where key='version'")?.first().and_then(|r| r["value"].as_str().and_then(|v| v.parse::<u32>().ok())).unwrap_or(0);
        let filter = site.map(|s| format!(" where host_key = '{s}' or host_key like '%.{s}'")).unwrap_or_default();
        let rows = sqlite_rows(&db, &format!("select host_key, name, value, hex(encrypted_value) as ev, path, expires_utc, is_secure, is_httponly, samesite from cookies{filter}"))?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_secs() as i64;
        let mut out = Vec::new();
        for r in rows {
            let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
            let n = |k: &str| r[k].as_i64().unwrap_or(0);
            let value = match s("value") {
                v if !v.is_empty() => v,
                _ => match decrypt_cookie(&key, &unhex(&s("ev")), version >= 24) {
                    Some(v) => v,
                    None => continue,
                },
            };
            // Chromium time: µs since 1601-01-01; 0 = session cookie.
            let expires = match n("expires_utc") {
                0 => None,
                t => Some(t / 1_000_000 - 11_644_473_600),
            };
            if expires.is_some_and(|e| e <= now) {
                continue;
            }
            // `Cookie::domain()` strips one leading dot, and wry builds the WKHTTPCookie from it; a domain
            // cookie (`.github.com`) needs its dot kept to reach subdomains, so pass it doubled.
            let host = s("host_key");
            let domain = if host.starts_with('.') { format!(".{host}") } else { host };
            let mut c = Cookie::build((s("name"), value)).domain(domain).path(s("path")).secure(n("is_secure") != 0).http_only(n("is_httponly") != 0);
            c = match n("samesite") {
                0 => c.same_site(SameSite::None),
                1 => c.same_site(SameSite::Lax),
                2 => c.same_site(SameSite::Strict),
                _ => c,
            };
            if let Some(dt) = expires.and_then(|e| OffsetDateTime::from_unix_timestamp(e).ok()) {
                c = c.expires(dt);
            }
            out.push(c.build());
        }
        Ok(out)
    })
    .await
    .map_err(err)??;

    let (wv, temp) = store_webview(&app).await?;
    let count = cookies.len();
    let res = tauri::async_runtime::spawn_blocking(move || {
        // ponytail: one round-trip per cookie; batch through WKHTTPCookieStore if imports drag.
        for c in cookies {
            wv.set_cookie(c).map_err(err)?;
        }
        if temp {
            let _ = wv.close();
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(err)?;
    res.map(|_| count)
}

// ---------- favicons ----------

/// First `<link rel="… icon …" href="…">` in an HTML page (ASCII-lowercasing keeps byte offsets).
fn icon_href(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<link") {
        let start = from + i;
        let end = start + lower[start..].find('>')?;
        let (tag, tag_l) = (&html[start..end], &lower[start..end]);
        let is_icon = attr(tag, tag_l, "rel").is_some_and(|r| r.to_ascii_lowercase().split_whitespace().any(|x| x == "icon"));
        if is_icon {
            if let Some(h) = attr(tag, tag_l, "href").filter(|h| !h.is_empty()) {
                return Some(h);
            }
        }
        from = end;
    }
    None
}

/// Value of attribute `name` in a tag (quoted or bare).
fn attr(tag: &str, tag_l: &str, name: &str) -> Option<String> {
    let mut idx = 0;
    while let Some(i) = tag_l[idx..].find(name) {
        let p = idx + i;
        let after = &tag_l[p + name.len()..];
        let rest = after.trim_start();
        if p > 0 && tag_l.as_bytes()[p - 1].is_ascii_whitespace() && rest.starts_with('=') {
            let v = tag[tag.len() - rest.len() + 1..].trim_start();
            return Some(match v.chars().next() {
                Some(q @ ('"' | '\'')) => v[1..].split(q).next().unwrap_or("").to_string(),
                _ => v.split_whitespace().next().unwrap_or("").trim_end_matches('/').to_string(),
            });
        }
        idx = p + name.len();
    }
    None
}

fn guess_type(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".svg") {
        "image/svg+xml"
    } else if p.ends_with(".png") {
        "image/png"
    } else {
        "image/x-icon"
    }
}

/// A site's favicon as a data URL: the page's `<link rel=icon>`, else `/favicon.ico`. Fetched here
/// (not in the app webview) so it works for localhost dev servers and needs no CSP change.
#[tauri::command]
pub async fn browser_favicon(url: String) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let base: reqwest::Url = url.parse().map_err(err)?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(4)).build().map_err(err)?;
    let mut candidates = Vec::new();
    if let Ok(r) = client.get(base.clone()).send().await {
        if let Ok(html) = r.text().await {
            if let Some(h) = icon_href(&html) {
                if h.starts_with("data:image/") {
                    return Ok(Some(h));
                }
                if let Ok(u) = base.join(&h) {
                    candidates.push(u);
                }
            }
        }
    }
    if let Ok(u) = base.join("/favicon.ico") {
        candidates.push(u);
    }
    for u in candidates {
        let Ok(r) = client.get(u.clone()).send().await else { continue };
        if !r.status().is_success() {
            continue;
        }
        let ct = r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let Ok(bytes) = r.bytes().await else { continue };
        // SPA dev servers answer unknown paths with index.html; skip that and anything huge.
        if bytes.is_empty() || bytes.len() > 512 * 1024 || ct.starts_with("text/") {
            continue;
        }
        let ct = if ct.starts_with("image/") { ct } else { guess_type(u.path()).to_string() };
        return Ok(Some(format!("data:{ct};base64,{}", STANDARD.encode(&bytes))));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_icon_link() {
        let html = r#"<head><link rel="stylesheet" href="/a.css"><LINK REL="icon" type="image/svg+xml" HREF="/vite.svg" /></head>"#;
        assert_eq!(icon_href(html).as_deref(), Some("/vite.svg"));
        assert_eq!(icon_href(r#"<link rel='shortcut icon' href='fav.png'>"#).as_deref(), Some("fav.png"));
        assert_eq!(icon_href(r#"<link rel=icon href=/f.ico>"#).as_deref(), Some("/f.ico"));
        assert_eq!(icon_href(r#"<link rel="apple-touch-icon" href="/t.png">"#), None);
        assert_eq!(icon_href("<p>no links</p>"), None);
    }

    #[test]
    fn cookie_crypto() {
        // RFC 6070 PBKDF2-HMAC-SHA1 vector ("password", "salt", 1 round), first 16 bytes.
        assert_eq!(cc::pbkdf2_sha1(b"password", b"salt", 1), unhex("0c60c80f961f0e71f3a9b524af601206").as_slice());
        let key = cookie_key(b"secret");
        let blob = |plain: &[u8]| [b"v10".as_slice(), &cc::aes_cbc(true, &key, &CBC_IV, plain).unwrap()].concat();
        assert_eq!(decrypt_cookie(&key, &blob(b"session=abc"), false).as_deref(), Some("session=abc"));
        // schema 24+: 32-byte domain hash in front of the value
        assert_eq!(decrypt_cookie(&key, &blob(&[[7u8; 32].as_slice(), b"tok"].concat()), true).as_deref(), Some("tok"));
        assert_eq!(decrypt_cookie(&key, b"v11garbage", false), None);
        assert_eq!(decrypt_cookie(&cookie_key(b"wrong"), &blob(b"session=abc"), false), None);
    }

    #[test]
    fn site_of_host() {
        assert_eq!(site_of("app.example.com"), "example.com");
        assert_eq!(site_of("github.com"), "github.com");
        assert_eq!(site_of(".www.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site_of("localhost"), "localhost");
    }

    #[test]
    fn domain_dot_survives_cookie_crate() {
        // Relied on by cookie_import: one leading dot is stripped by the getter, so ".." keeps one.
        let c = tauri::webview::cookie::Cookie::build(("a", "b")).domain("..github.com").build();
        assert_eq!(c.domain(), Some(".github.com"));
    }

    #[test]
    fn stitches_slices_dropping_overlap() {
        // 2px-wide, 1 byte/pixel; each row filled with its global row number.
        let rows = |from: u8, n: u8| (from..from + n).flat_map(|r| [r, r]).collect::<Vec<_>>();
        let slices = [
            Slice { data: rows(0, 4), width: 2, height: 4, skip: 0 },
            Slice { data: rows(4, 4), width: 2, height: 4, skip: 0 },
            // last slice scrolled back so it overlaps the previous one by 3 rows
            Slice { data: rows(5, 4), width: 2, height: 4, skip: 3 },
        ];
        let (out, w, h) = stitch(&slices, 1);
        assert_eq!((w, h), (2, 9));
        assert_eq!(out, rows(0, 9));
    }
}
