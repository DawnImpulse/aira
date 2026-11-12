# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who juggle many repositories at once: several projects open together, their dev servers running, and coding agents working side by side. Aira is a public tool for them, not a personal setup.

## Product Purpose

Aira is a Mac desktop code editor (Tauri 2 shell, React UI) that keeps every open project's scripts, coding agents and git in one window. Success means many-repo developers make it their daily driver and keep it open all day, instead of a mix of terminal, editor and git client.

## Positioning

Many projects live at once. Every project's dev servers, agents and git stay running and visible side by side, and switching between projects or spaces costs nothing.

## Operating Context

- Long working sessions on a Mac, with several dev servers and agent CLIs running in the background while the developer moves between projects.
- Projects often contain nested repositories and git worktrees. Work happens in spaces (the project root, a nested package, a worktree), each with its own tabs and Files/Git view.
- Agents are the developer's own installed CLIs (Claude Code, Codex, Gemini CLI, OpenCode, Aider, Cursor Agent, GitHub Copilot CLI, Amp, Goose, Qwen Code, Crush, Factory Droid), started in Aira terminals. Attention comes back through their status (Working, Needs input, Done) and macOS notifications.
- Vocabulary: project, space, script, Start set, scripts window, agent, subagent, worktree.

## Capabilities and Constraints

- Mac-first: macOS only today, Windows later. Platform-specific process and PTY code stays isolated so a Windows port remains possible.
- Bring your own: nothing is bundled. Agents run as the user's installed CLIs with their own logins; git is the user's git with their SSH keys, credential helpers and hooks; AI provider keys live only in the macOS Keychain, and no diff is sent until the user presses Generate.
- Light editor: Monaco without language servers. Aira does not try to replace a full IDE's code intelligence.
- Open source under the MIT license.
- Shipped today: per-project color and icon; spaces with their own tabs and panels; hook-based agent status with nested subagents for Claude Code; per-project scripts windows with a Start set and a restart offer after quit; a commit panel across nested repos and worktrees, one repository per commit; AI commit messages from cloud, local or CLI providers; ports and per-terminal memory in the status bar; dark, light and system themes.
- Early preview (v0.1.0). Signed, notarized universal DMG per version bump via GitHub Actions (`.github/workflows/release.yml`); the site's Download button resolves the latest release. Building from source stays documented.

## Brand Commitments

- Name: Aira, pronounced “aye-ra” (renamed from "IDE" on 2026-10-02; bundle identifier `com.codevry.aira` since 2026-11-12, before the first signed release). App icon: `src-tauri/icons/icon.svg`.
- Third-party agent logos in `src/assets/agents/` only identify each tool (see `NOTICE.md` there).

## Evidence on Hand

- Screenshots in `docs/screenshots/`, rendered from the real UI with demo projects (storefront, payments, docs-site) by `scripts/screenshots/`.
- No users, testimonials, usage numbers, benchmarks or press yet. Do not invent them.

## Product Principles

1. Everything running stays visible: the state of every server, agent and repo can be read without switching to it.
2. The developer's tools stay theirs: no bundled CLIs, no credential handling beyond the Keychain, nothing sent without an explicit action.
3. Interrupt only when it matters: finished, failed and needs-input states call for attention; routine running states stay quiet.
4. Light over complete: a fast, focused editor plus orchestration beats rebuilding full IDE language tooling.

## Accessibility & Inclusion

WCAG 2.2 AA for both the app and the website: text contrast, full keyboard operation, visible focus, and reduced-motion support.
