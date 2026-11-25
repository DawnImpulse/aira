<p align="center"><img src="docs/icon.svg" width="88" alt=""></p>

<h1 align="center">Aira</h1>

<p align="center"><sub>“aye-ra”</sub></p>

<p align="center">
A Mac code editor for working on many projects at once.<br>
Dev servers, coding agents and git for every repo you have open, in one window.
</p>

<p align="center"><a href="https://aira.codevry.com/">Website</a> · <a href="https://aira.codevry.com/features.html">Features</a> · <a href="https://aira.codevry.com/guide.html">Guide</a> · <a href="#build">Build</a></p>

![Aira with three projects open: Claude Code working with subagents, dev servers running, a file open in the editor](docs/screenshots/hero.webp)

## Features

- **Projects and spaces.** Open many folders at once; each project gets its own color and icon. Spaces (the root, a nested package, a git worktree) keep their own tabs, file tree and Git view.
- **Coding agents.** Start Claude Code, Codex, Gemini CLI, OpenCode, Aider, Cursor Agent, Copilot CLI, Amp, Goose, Qwen Code, Crush or Factory Droid from the **+** in the tab bar: hover for a quick menu, click for every option. Only installed agents show; hide any in Settings. Each space shows whether its agents are working, need input or are done, Claude Code's subagents appear as a tree, and macOS tells you when an agent finishes.
- **Browser.** Open any site or your dev servers in a tab (⇧⌘B), with devtools and zoom. Capture an element, a region or the full page to save it or send it to an agent; preview phones, tablets and desktops side by side, in sync; pop a page or the device view out into its own window; import sign-ins from Chrome, Arc and other Chromium browsers. New tabs list the workspace's running servers, your pinned links and recent pages.
- **Scripts.** Every project gets a scripts window. One Start button runs your usual dev servers; a failed script keeps its output and exit code.
- **Git.** One commit panel for every repo in a project, nested repos and worktrees included. Diff against HEAD, commit, push, and generate commit messages with the AI provider, local model or agent CLI you choose. API keys stay in the macOS Keychain.
- **Ports and memory.** See which process holds a port and free it; see each terminal's memory.
- **Editor.** Monaco, a file tree with git colors, xterm.js terminals, dark and light themes.

![Git tab with changes from three repositories, a diff and a generated commit message](docs/screenshots/git.webp)

## Install

Download the latest signed DMG from [Releases](https://github.com/DawnImpulse/aira/releases/latest) (macOS, Apple Silicon and Intel). Each version bump on `main` publishes one via `.github/workflows/release.yml`.

## Build

Needs macOS, [Bun](https://bun.sh), [Rust](https://rustup.rs) and the Xcode Command Line Tools.

```sh
bun install
bun tauri dev     # run the app
bun run app       # same, but as com.codevry.aira.dev: own config/data dir, safe next to an installed Aira.app
bun tauri build   # Aira.app in src-tauri/target/release/bundle/macos
```

Rust tests: `cd src-tauri && cargo test`

Coding agents aren't bundled: install the CLIs you use and Aira finds them on your PATH.

Screenshots in `docs/screenshots` and the recordings in `docs/media` come from `bun run screenshots` and `bun run clips` (demo data; needs `bun run dev` running and ffmpeg for clips, see `scripts/screenshots/`).

## Status

Early preview (v0.1), macOS only. Built with Tauri 2, React, Monaco and xterm.js.

## License

[MIT](LICENSE)
