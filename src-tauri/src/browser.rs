//! Embedded browser: a native child webview the frontend positions over the Browser tab's body.
//! Being a real top-level webview (not an iframe), it loads any site — X-Frame-Options doesn't
//! apply. The frontend keeps it sized to the tab's content rect and hides it under menus/dialogs.

use serde_json::json;
use std::collections::HashMap;
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
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    user_agent: Option<String>,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(err)?;
    let bounds = Bounds { x, y, w, h };
    app.state::<Browsers>().0.lock().unwrap().insert(id.clone(), bounds);

    if let Some(wv) = webview(&app, &id) {
        let _ = wv.set_bounds(rect(bounds));
        return wv.show().map_err(err);
    }

    let app2 = app.clone();
    let ev_id = id.clone();
    // add_child must run on the main thread.
    app.run_on_main_thread(move || {
        let Some(main) = app2.get_webview("main") else { return };
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
        match main.window().add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h)) {
            // add_child's initial placement can be unreliable; reassert the exact bounds.
            Ok(wv) => {
                let _ = wv.set_bounds(rect(bounds));
            }
            Err(e) => {
                let _ = app2.emit("browser:error", json!({ "id": ev_id, "message": e.to_string() }));
            }
        }
    })
    .map_err(err)
}

#[tauri::command]
pub async fn browser_bounds(app: AppHandle, id: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
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
pub async fn browser_show(app: AppHandle, id: String, visible: bool) -> Result<(), String> {
    let Some(wv) = webview(&app, &id) else { return Ok(()) };
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

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<Browsers>().0.lock().unwrap().remove(&id);
    if let Some(wv) = webview(&app, &id) {
        let _ = wv.close();
    }
    Ok(())
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
}
