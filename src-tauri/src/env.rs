//! Login-shell environment for GUI launches. Finder-launched apps get a bare PATH
//! and no LANG, so `bun`/`node`/nvm would be missing in terminals and git hooks.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

const START: &str = "__IDE_ENV_START__";
const END: &str = "__IDE_ENV_END__";

static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Resolved environment. First caller runs the shell; concurrent callers block until done.
pub fn get() -> &'static HashMap<String, String> {
    ENV.get_or_init(load)
}

pub fn shell() -> String {
    get().get("SHELL").cloned().unwrap_or_else(|| "/bin/zsh".into())
}

fn load() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    if let Some(shell_env) = from_login_shell() {
        env.extend(shell_env);
    }
    for k in ["PWD", "OLDPWD", "SHLVL", "_"] {
        env.remove(k);
    }
    env.entry("LANG".into()).or_insert_with(|| "en_US.UTF-8".into());
    env
}

#[cfg(unix)]
fn from_login_shell() -> Option<HashMap<String, String>> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("echo {START}; env -0; echo {END}")])
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let out = rx.recv_timeout(Duration::from_secs(5));
    let _ = child.kill();
    let _ = child.wait();
    parse(&String::from_utf8_lossy(&out.ok()?))
}

#[cfg(not(unix))]
fn from_login_shell() -> Option<HashMap<String, String>> {
    None
}

/// Parses `env -0` output between the markers, ignoring rc-file noise around them.
fn parse(out: &str) -> Option<HashMap<String, String>> {
    let start = out.find(START)? + START.len();
    let end = out.rfind(END)?;
    let body = out.get(start..end)?.trim_start_matches('\n');
    let env: HashMap<String, String> = body
        .split('\0')
        .filter_map(|kv| kv.split_once('='))
        .filter(|(k, _)| !k.is_empty() && !k.contains('\n'))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    (!env.is_empty()).then_some(env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_between_markers() {
        let out = format!("motd noise\n{START}\nPATH=/a:/b\0EQ=x=y\0MULTI=l1\nl2\0{END}\n");
        let env = parse(&out).unwrap();
        assert_eq!(env["PATH"], "/a:/b");
        assert_eq!(env["EQ"], "x=y");
        assert_eq!(env["MULTI"], "l1\nl2");
        assert_eq!(env.len(), 3);
        assert!(parse("no markers").is_none());
    }
}
