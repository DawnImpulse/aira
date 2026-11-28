# 016 · Phone companion: watch and drive terminals from aira-mobile

Goal: a phone running `aira-mobile` sees this Mac's projects and terminals, mirrors one terminal live,
types into it, and gets a push when an agent waits for input. Contract: `BACKEND.md` (2026-11-27).

## Mechanism

Everything protocol-side lives in the webview, `src/lib/phone.ts`. Rust (`phone.rs`) only keeps the
pairing list in the Keychain (one JSON entry `phones` under `com.codevry.aira`) and runs the one-shot
loopback listener the email sign-in link lands on.

- **Sign-in:** passwordless email link. `phone_login_listen` binds `127.0.0.1:0`, the link's
  `continueUrl` is `http://localhost:<port>/`, the hit URL comes back as the `phone-login-url` event
  and `signInWithEmailLink` finishes it. `initializeAuth` with IndexedDB persistence (not `getAuth`,
  which loads the authDomain iframe). Google sign-in: not built, needs a Desktop OAuth client first.
- **Pairing:** 32 random bytes → QR (plain base64) + copyable text. `roomId` and SDP tags are
  WebCrypto HMAC-SHA256, checked against Node's `createHmac` (scratchpad `hmac-check.mjs`). The offer
  listener attaches at once (a room that does not exist is readable); the pairing is saved only when
  the first offer verifies, so an unscanned QR leaves nothing behind. `createRoom` is not called; the
  phone does it.
- **Connection:** per room, one `onValue` on `offer`. A verified offer newer than the last one (and
  under 2 min old, so a stale mailbox entry after a restart is skipped) tears down the old peer and
  answers: STUN only, no trickle (3 s gathering cap), `answer` written with `update()` on the room.
- **Channel:** the phone opens `ctl` only (the pty mirror was dropped the same day, see below). `sub`
  → the terminal's conversation; `in` → `termInput`, which goes through xterm's `onData` so the
  activity heuristics and ptyWrite run as for local typing. `terminals.ts` exposes `taps`
  (exit/resize/hook) that phone.ts fills.
- **Conversation (`conv`):** `agent_transcript` tails the Claude Code transcript from a byte offset
  (same path check as `agent_usage`; `user`/`assistant` lines only, trimmed). `lib/conv.ts` folds
  lines into items: user prompts, assistant text, one `tool` item per tool_use whose `tool_result`
  (a `user` line, not a user message) sets its detail and status, and `prompt` items from Notification
  hooks that ask for input (resolved when status leaves waiting). Polled every second while any phone
  watches; `reset:true` + last 50 items on subscribe, then changed items, 20 per message. Shells and
  other agents get `unsupported` with a reason. Checked by `bun test src/lib/conv.test.ts` and the
  Rust `tail_*` test.
- **State:** `{t:"state", projects, terms}` on ctl open and, debounced 250 ms, whenever the store
  changes and the JSON differs. Fields follow `models.dart` (`agentStatus.state`, `subagents`, `usage`).
- **Push:** `notifyAgent("Waiting Input")` also writes `wake` to every room whose phone is not
  connected and watching that terminal. Same gates as the banner: the Notifications toggle, not
  looking at the terminal, 10 s dedupe.
- **UI:** Settings → Phone: email sign-in, paired phones (rename, live state, Unpair = Keychain +
  `remove(room)`), Pair a phone (QR via `qrcode`).

## Not covered

- TURN, App Check, Google sign-in (backend side not ready either).
- A status-bar indicator for connected phones.
- `prompt` items need the project's Claude hooks on; without them the phone sees no question, only
  the `waiting` status on the board.
- Assistant text streams in whole blocks (the transcript writes a block when it completes).

## MOBILE.md reconciliation (2026-11-27)

The phone-side session's `MOBILE.md` is the wire contract. Folded in: `createRoom` is called when the QR
is shown (room limit errors surface on the Mac; Cancel removes the room), offers already answered
before a restart are skipped (listener on the room root sees `answer.at`), `disconnected` gets 10 s
before the peer is dropped, snapshots carry running terms only and `agentStatus.since`, pty frames are
dropped above 1 MB buffered and `term` + screen resent on `bufferedamountlow`, and the wake carries the
banner's title/body. Deliberate differences, told to the phone session: Keychain account is `phones`
(JSON list, several phones) not `remote-secret`; `exit`/`resize` also carry `gen`; sign-in is the
email link finishing on a loopback listener (no paste).

## Status (2026-11-27)

Terminal mirror verified live with the phone session (answer, ctl, state, pty backlog, input echo).
The same day the contract changed to a conversation view (MOBILE.md "Data channel"): `pty`, `term`
and `resize` are gone, `conv` replaces them. Verified: `cargo test` (tail reader), `bun test`
(fold), `tsc`. `conv` verified live the same day: backlog, incremental items, re-sub, tool item with
detail, gen echo. Not yet exercised live: `prompt` items and `exit`. Markdown in assistant text is
sent raw; the phone renders plain text for now.
