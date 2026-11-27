# Phone companion contract for Aira

Source of truth for the wire protocol: the `aira-mobile` repo (`lib/connection.dart`, `lib/models.dart`). Backend contract: `aira-mobile/BACKEND.md`. Written 2026-11-27 against the working phone app. If you change the contract, change the phone first.

## What the phone does

Android app. Signs in to Firebase project `aira-server`, scans a QR (or pastes a code) shown by Aira, then connects to the Mac over WebRTC data channels. Shows a board of terminals with agent status, mirrors one terminal read-only, sends keystrokes into it, and gets a push when an agent waits for input.

Firebase Realtime Database is only the mailbox for one offer and one answer. After that, everything is direct phone ↔ Mac. Aira never talks to the phone through Firebase again, except one `wake` write for push.

## What Aira must do

All of it can live in the frontend (TypeScript). WKWebView has `RTCPeerConnection`. Everything the phone needs is already in the Zustand store and the PTY channel handler. No Rust networking.

1. **Sign in** to Firebase as the same user as the phone (see Auth below).
2. **Pair**: generate 32 random bytes (`crypto.getRandomValues`), store in Keychain (`keyring`, service `com.codevry.aira`, account `remote-secret`), show as a QR and as copyable text. Payload is plain base64 of the 32 bytes, 44 chars.
3. **Create the room**: call the `createRoom` callable (us-central1) with `{room: roomId}` once after pairing. Idempotent. The phone also calls it; whoever is first wins, same owner.
4. **Listen** on `rooms/<roomId>/offer`. On a new offer: verify tag, answer (see Signaling).
5. **Serve** the data channels: state snapshots, terminal bytes, input.
6. **Wake**: when an agent enters "waiting", write `rooms/<roomId>/wake`.

## Crypto (must match `aira-mobile/lib/models.dart`)

```
roomId         = hex(HMAC-SHA256(secret, "room"))                      64 lowercase hex
tag(role,at,sdp) = hex(HMAC-SHA256(secret, role + "\n" + at + "\n" + sdp))
```
`role` is `"offer"` or `"answer"`. `at` is the offer's ms timestamp, decimal, no padding. The answer reuses the offer's `at`. WebCrypto `subtle.sign("HMAC")` with SHA-256 does this.

Test vectors (the phone's unit test asserts these):
```
secret = 32 zero bytes
roomId = 533bc8d5f7d28c7ca8efb51d302cd9296b788fefbbfbbe2d8e857321faefe555

secret = 32 bytes of 0x01, role "offer", at 1700000000000, sdp "v=0\r\n"
tag    = 710d6f2fb0f18faf373bb64fab9791f14e52a804d2122ea212507ec6a5a2f99e
```

## Signaling

Database paths under `rooms/<roomId>/`:
```
owner   "<uid>"                 createRoom writes it, immutable
offer   {sdp, at, tag}          phone writes
answer  {sdp, at, tag}          Aira writes
token   "<fcm token>"           phone writes
wake    {title, body, key, at}  Aira writes, triggers push
```
Rules: signed-in user whose uid equals `owner`. Write child paths with `update`/`set` on the child, never `set` on the room root. No other children allowed.

Flow, Aira side:
1. `onValue(rooms/<roomId>/offer)`.
2. Skip if: no offer; `offer.at` already answered; `rooms/<roomId>/answer.at === offer.at` (already answered, survives restart); `Date.now() - offer.at > 120_000`; tag does not verify.
3. `pc = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]})`.
4. `pc.ondatachannel`: the phone creates both channels; switch on `channel.label`: `"ctl"` and `"pty"`. Set `pty.binaryType = "arraybuffer"`.
5. `setRemoteDescription({type: "offer", sdp})`, `setLocalDescription(await createAnswer())`.
6. Wait for `iceGatheringState === "complete"`, cap 3 s. Non-trickle, no candidate exchange.
7. If a newer offer arrived meanwhile, abort. Else `set(rooms/<roomId>/answer, {sdp, at: offer.at, tag: tag("answer", at, sdp)})`.
8. `connectionstatechange`: `failed`/`closed` → close pc, wait for the next offer. `disconnected` → 10 s grace. Aira never offers; the phone re-offers on resume and on failure.

## Data channels

Phone creates `ctl` (JSON strings) and `pty` (binary).

`ctl` phone → Aira:
```
{"t":"sub","key":"<termKey>","gen":<0-255>}   subscribe to one terminal; key null = unsubscribe
{"t":"in","key":"<termKey>","data":"<string>"} keystrokes, already escape-encoded by the phone's xterm
```

`ctl` Aira → phone:
```
{"t":"state", ...snapshot}                      on ctl open, then debounced ~250 ms on store changes
{"t":"term","key","cols","rows","gen"}          before a backlog, echoing the phone's gen
{"t":"exit","key","code"}
{"t":"resize","key","cols","rows"}
```

`pty` Aira → phone, binary frame = `[gen: u8][raw bytes ≤ 16 KB]`. Echo the phone's `gen` from its last `sub`. The phone drops frames whose gen does not match. `ctl` and `pty` are separate streams with no cross-ordering; that is why the phone owns `gen`.

On `sub`: send `term` with current cols/rows and the gen, then the backlog (serialize the xterm buffer, ~300 lines, same as `writeHandoff` in `src/lib/terminals.ts`), then live bytes. Tap live bytes in `channelFor` before `x.term.write`. On `in`: `xterm(key).term.input(data)` so the existing `onData` path runs `pty_write` plus the agent heuristics. Backpressure: if `pty.bufferedAmount > 1 MB` drop, and on `bufferedamountlow` resend `term` + a fresh backlog with the same gen.

State snapshot shape (`Snapshot.fromJson` on the phone):
```json
{ "t":"state",
  "projects":[{"id":"","name":"","color":"#hex or null"}],
  "terms":[{"key":"","name":"","projectId":"","status":"running","agent":"Claude Code or null",
            "cwd":"","cols":120,"rows":40,
            "agentStatus":{"state":"working|idle|waiting","since":0},
            "subagents":[{"id":"","type":"","description":"","parent":"id or null","running":true}],
            "usage":[{"model":"","input":0,"output":0,"cache_read":0,"cache_create":0}]}] }
```
Phone groups terms by `projectId`, sorts waiting first, sums usage into in/out tokens, nests subagents by `parent`. Only send terms with `status === "running"`.

## Wake (push)

In `notifyAgent` after its existing gates, when `what === "Waiting for action"`:
```
set(rooms/<roomId>/wake, {title: <project name>, body: <term name + " – Waiting for action">, key: <termKey>, at: Date.now()})
```
One write per transition. The Cloud Function reads `token` from the same room and sends FCM with `data.key`; the phone opens that terminal. Strings under 256 chars.

## Auth on the Mac (open question, decide with the backend)

The database rules require the Mac to be signed in as the same uid as the phone. Providers are Google and email link. Inside a Tauri WKWebView neither popup nor redirect sign-in works well. Options:
- Email link where Aira sends the link and the user pastes it back into Aira (works today, zero backend change, clunky).
- A hosted sign-in page opened in the system browser that returns a custom token via `aira://auth?token=...` (needs a backend function to mint the token; cleanest).
- Email + password for the Mac only (backend says the provider allows it; weakest).

Pick one before building step 1.

## Testing against the phone app

Phone app repo: `aira-mobile`. Run on the Android emulator (`Pixel_7_API_34`, Play image):
```sh
cd ~/dev-data/codevry/projects/aira-mobile
~/Library/Android/sdk/emulator/emulator -avd Pixel_7_API_34 &
flutter build apk --debug
adb push build/app/outputs/flutter-apk/app-debug.apk /data/local/tmp/aira.apk && adb shell pm install -r /data/local/tmp/aira.apk
adb shell am start -n com.codevry.aira.mobile.android/com.codevry.aira_mobile.MainActivity
```
(`flutter run` fails to install the 234 MB debug APK over streamed install; push + `pm install` works.)

Sequence:
1. Phone: sign in with email link. Paste the link from the inbox into `adb shell am start -a android.intent.action.VIEW -d '<link>' -n com.codevry.aira.mobile.android/com.codevry.aira_mobile.MainActivity` until App Links verification is live.
2. Aira: sign in as the same user, pair, note the secret.
3. Phone: Pair → Enter code → paste the base64 secret. Board shows "signaling".
4. Aira answers → phone shows "connected" and the board renders your projects and terminals.
5. Tap a terminal → backlog and live output. Type `echo hi` → appears in Aira. Ctrl-C stops `sleep 100`.
6. Put Aira in a state where an agent waits with the terminal unfocused → phone gets a push → tap opens that terminal.

Without the Mac side, a quick check that Aira's Firebase bits work: `curl -X PUT "https://aira-server-default-rtdb.firebaseio.com/rooms/<roomId>/wake.json?auth=<idToken>" -d '{"title":"t","body":"b","key":"k","at":1}'` with the phone paired and backgrounded → push arrives.

## Not in v1

TURN (cellular CGNAT fails sometimes; add a TURN iceServer on both sides later). Trickle ICE. Multiple phones. Mac-initiated reconnect. iOS.
