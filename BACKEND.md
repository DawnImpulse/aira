# Backend contract for the Aira IDE (phone companion)

Source of truth: the `aira-server` repo (private, deploys on push to `main`). This file tells the IDE exactly what the backend expects so a phone running `aira-mobile` can watch and drive terminals. Written 2026-11-27 against the deployed state. If you change the contract, change it in `aira-server` first, then here and in `aira-mobile/BACKEND.md`.

## What the backend is

Firebase project `aira-server`, us-central1. Two jobs only:

1. Mailbox so the phone and this Mac can exchange one WebRTC offer and one answer.
2. Push a notification to the phone when an agent is waiting for input.

After offer and answer, phone and Mac talk directly over WebRTC data channels. Firebase is never in that path. The IDE keeps one open database connection all day; that is free.

| Thing | Value |
|---|---|
| Realtime Database | `https://aira-server-default-rtdb.firebaseio.com` |
| Callable | `createRoom`, `https://us-central1-aira-server.cloudfunctions.net/createRoom` |
| Email link host | `https://link.aira.codevry.com/__/auth/links` (custom Hosting domain). The IDE does not need `linkDomain`; its `continueUrl` is localhost. |
| Authorized domains | `aira-server.firebaseapp.com`, `aira-server.web.app`, `link.aira.codevry.com`, `localhost` |

Firebase **web app** config for the IDE (registered 2026-11-27, appId `1:972660997853:web:a379f166f997bccb606534`):

```ts
export const firebaseConfig = {
  apiKey: "AIzaSyAYoz8I8Ne5xq8OgdrR5SnRogPt9FkKahE",
  authDomain: "aira-server.firebaseapp.com",
  databaseURL: "https://aira-server-default-rtdb.firebaseio.com",
  projectId: "aira-server",
  appId: "1:972660997853:web:a379f166f997bccb606534",
  messagingSenderId: "972660997853",
};
```

These values are public by design. They identify the project, they do not grant access. Rules and Auth do.

## Auth

Every database call needs a signed-in user. Providers: **Google** and **passwordless email link**. Anonymous is disabled. Phone and Mac must sign in as the **same person**. Firebase merges Google and email-link sign-ins for the same email into one uid, so Google on the phone plus email link on the Mac still match.

The IDE is Tauri. The webview origin is not an authorized domain, so `signInWithPopup` and `signInWithRedirect` do not work. Use flows that finish in code:

### Email link (recommended first, needs nothing extra)

1. Start a one-shot HTTP listener on `http://localhost:<port>/` (Rust side or Node side, either works).
2. `sendSignInLinkToEmail(auth, email, { url: "http://localhost:<port>/", handleCodeInApp: true })`. `localhost` is an authorized domain.
3. User clicks the email link. It lands on Firebase's action handler, which redirects to the `continueUrl` with `?mode=signIn&oobCode=...&apiKey=...` appended.
4. The listener receives that full URL. `isSignInWithEmailLink(auth, url)` then `signInWithEmailLink(auth, email, url)`.
5. Respond to the browser with a "you can close this tab" page.

### Google (optional, needs a console step)

The project's only OAuth client is a web client created by Firebase; it cannot redirect to localhost. For a desktop loopback flow someone must create an OAuth client of type **Desktop app** in Google Cloud console → APIs & Services → Credentials, and paste its client id into the IDE config. Then: open the system browser to Google's auth endpoint with PKCE and `redirect_uri=http://localhost:<port>`, exchange the code for an `id_token`, and call `signInWithCredential(auth, GoogleAuthProvider.credential(id_token))`. Until that client exists, ship email link only.

Persist the Firebase user (default `indexedDB` persistence works in Tauri's webview) so the Mac stays signed in across restarts.

## Pairing crypto

Must match `aira-mobile/lib/models.dart` byte for byte.

- The IDE generates a 32-byte random `secret` per pairing and shows it as a QR containing the **plain base64** string. Also show it as text, the phone has a paste fallback.
- `roomId = hex(HMAC-SHA256(secret, "room"))`, 64 lowercase hex.
- `tag(role, at, sdp) = hex(HMAC-SHA256(secret, role + "\n" + at + "\n" + sdp))`, role is `"offer"` or `"answer"`, `at` is the **offer's** timestamp in ms. The answer reuses the offer's `at`.
- Keep `secret` per paired phone in the OS keychain. One secret = one room = one phone.

Auth does not separate phone from Mac, both are one uid. The HMAC `tag` is what makes an SDP trustworthy. Never apply an offer whose tag does not verify.

## Database layout

```
rooms/<roomId>/
  owner   "<uid>"                 written by createRoom only, immutable
  offer   {sdp, at, tag}          phone writes, IDE listens
  answer  {sdp, at, tag}          IDE writes, phone listens
  token   "<fcm token>"           phone writes, IDE never touches
  wake    {title, body, key, at}  IDE writes, triggers the push function
users/<uid>/limit                 admin only, IDE never touches
```

## Rules the IDE must respect

- **Clients cannot create rooms.** Any attempt, including by the owner, is denied. Either side calls `createRoom`. The phone does it on pairing; the IDE may also call it, the call is idempotent.
- Reads and writes need a signed-in user whose uid equals `owner`. A room that does not exist yet is readable by any signed-in user, which is exactly why the IDE can attach its `offer` listener before the phone has scanned.
- `owner` is immutable.
- Always `update()` on the room reference, never `set()` on the room root.
- Only these children exist: `owner`, `offer`, `answer`, `token`, `wake`. Anything else is rejected.
- Size caps: `sdp` under 20000 chars, each `wake` string under 256.
- Deleting the room (unpair from the Mac side) is allowed for the owner: `remove(ref)`.
- Nothing can list `rooms/`. Keep your own list of room ids in the keychain next to each secret.

## createRoom

```ts
import { getFunctions, httpsCallable } from "firebase/functions";
const createRoom = httpsCallable(getFunctions(app, "us-central1"), "createRoom");
await createRoom({ room: roomId }); // data: {created: true|false}
```

Raw HTTP equivalent, if the Rust side calls it:

```
POST https://us-central1-aira-server.cloudfunctions.net/createRoom
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{"data":{"room":"<64 hex>"}}
```

Response `{"result":{"created":true}}` or `{"error":{"status":"RESOURCE_EXHAUSTED","message":"..."}}`. Statuses: `UNAUTHENTICATED`, `INVALID_ARGUMENT`, `ALREADY_EXISTS` (room owned by another account), `RESOURCE_EXHAUSTED` (caller owns `limit` rooms, default 5, support can raise it). The Cloud Run frontend has once returned an HTML `401` for a valid token under a burst of calls; retry once on an HTML body, a JSON `UNAUTHENTICATED` body is the real thing.

## Pairing flow, Mac side

1. Sign in once, stay signed in.
2. User asks to pair a phone. Generate `secret`, derive `roomId`, show the QR.
3. Immediately `onValue(ref(db, "rooms/<roomId>/offer"))`. The room does not exist yet; that read is allowed.
4. Optionally call `createRoom({room})` now so the phone's own call becomes a no-op. Not required.
5. When `offer` arrives: verify `tag("offer", offer.at, offer.sdp)`. Ignore on mismatch.
6. Set remote description, create the answer, gather ICE without trickle (wait for gathering complete, 3 s cap, mirror the phone), then `update(ref(db, "rooms/<roomId>"), { answer: { sdp, at: offer.at, tag: tag("answer", offer.at, sdp) } })`.
7. WebRTC connects. STUN only, `stun:stun.l.google.com:19302`, no TURN yet. The phone is always the offerer; the IDE never writes `offer`.
8. Every new `offer` with a newer `at` is a reconnect. Tear down the old peer connection and answer again. The phone backgrounds after about 40 s and reconnects on return.

Multiple phones: one secret, one room, one listener each. Multiple Macs on the same phone is the same thing from the other side; nothing special on the IDE.

## Push

When an agent in terminal `key` is waiting for input, write once:

```ts
update(ref(db, `rooms/${roomId}`), {
  wake: { title: "Aira", body: `${termName} is waiting for input`, key, at: Date.now() }
});
```

The backend function `wake` reads `rooms/<roomId>/token` and sends an FCM push with `notification: {title, body}` and `data: {key}`. The phone opens that terminal on tap. Write `wake` into every room this Mac has, one per paired phone. Do not write it while the phone is connected over WebRTC and already watching that terminal; the phone's `sub` tells you which terminal it watches. Each write costs one function run; the free tier is 2M a month.

## Data channel protocol, for reference

Defined by `MOBILE.md` in this repo (source: `aira-mobile/lib/connection.dart`, `lib/models.dart`). One channel, `ctl`, JSON both ways: the phone subscribes to a terminal (`sub`, with a `gen` it owns) and types raw input (`in`); the IDE sends `state` snapshots, the terminal's agent session as `conv` items folded from the Claude Code transcript, and `exit`. Every `conv` echoes the phone's `gen`.

## Testing against the live backend without the phone

```sh
KEY=AIzaSyAYoz8I8Ne5xq8OgdrR5SnRogPt9FkKahE   # web apiKey
DB=https://aira-server-default-rtdb.firebaseio.com
U=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" -H 'Content-Type: application/json' -d '{"email":"t@example.com","password":"Test12345!","returnSecureToken":true}')
T=$(echo "$U" | node -pe 'JSON.parse(require("fs").readFileSync(0)).idToken')
ROOM=$(openssl rand -hex 32)
curl -X POST https://us-central1-aira-server.cloudfunctions.net/createRoom -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"data\":{\"room\":\"$ROOM\"}}"
curl -X PUT "$DB/rooms/$ROOM/answer.json?auth=$T" -d '{"sdp":"x","at":1,"tag":"t"}'
curl "$DB/rooms/$ROOM.json?auth=$T"
curl -X DELETE "$DB/rooms/$ROOM.json?auth=$T"
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$KEY" -H 'Content-Type: application/json' -d "{\"idToken\":\"$T\"}"
```

Email+password sign-up works because the email provider is on; there is no link-only mode. Fine for tests, never for the product UI.

## Not built on the backend yet

TURN relay (planned as a callable minting short-lived Cloudflare TURN credentials). App Check (waits until the Mac can attest). iOS. Stale room cleanup.
