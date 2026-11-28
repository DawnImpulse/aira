//! Phone companion (BACKEND.md): the pairing secrets live in the Keychain, and the passwordless
//! email-link sign-in finishes on a one-shot loopback HTTP listener. Everything else (Firebase,
//! WebRTC, the data-channel protocol) is in the webview, `src/lib/phone.ts`.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

const KEY: &str = "phones";

/// JSON list of pairings, opaque to Rust. Empty string when none saved yet.
#[tauri::command]
pub async fn phone_load() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match crate::ai::entry(KEY)?.get_password() {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn phone_save(json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = crate::ai::entry(KEY)?;
        if json.is_empty() || json == "[]" {
            return match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(err) => Err(err.to_string()),
            };
        }
        e.set_password(&json).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Binds `http://localhost:<port>/`, returns the port, and waits in the background for the browser
/// to land on it with the email link's `oobCode`. That full URL is emitted as `phone-login-url`.
/// Stray requests (favicon) get a 404 and the wait goes on.
#[tauri::command]
pub fn phone_login_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut line = String::new();
            if BufReader::new(&stream).read_line(&mut line).is_err() {
                continue;
            }
            // "GET /?mode=signIn&oobCode=... HTTP/1.1"
            let target = line.split_whitespace().nth(1).unwrap_or("/");
            if !target.contains("oobCode=") {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let body = "<!doctype html><meta charset=utf-8><title>Aira</title><body style=\"font:16px -apple-system,sans-serif;padding:3rem;text-align:center\"><h2>Signed in to Aira</h2><p>You can close this tab.</p>";
            let _ = stream.write_all(
                format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes(),
            );
            let _ = app.emit("phone-login-url", format!("http://localhost:{port}{target}"));
            break;
        }
    });
    Ok(port)
}
