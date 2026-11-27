/**
 * Phone companion (BACKEND.md). Firebase Realtime Database is only the mailbox for one WebRTC offer
 * and answer per connection; after that the phone (aira-mobile) talks to this Mac over two data
 * channels it opens: `ctl` (JSON) and `pty` (binary frames `[gen][bytes]`). One pairing secret =
 * one room = one phone; the secrets live in the Keychain (phone.rs), the sign-in in IndexedDB.
 */
import { listen } from "@tauri-apps/api/event";
import { initializeApp } from "firebase/app";
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail, signInWithEmailLink, signOut, type User } from "firebase/auth";
import { getDatabase, onValue, ref, remove, update, type Unsubscribe } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { create } from "zustand";
import { api } from "../ipc";
import { notify, useStore } from "../store";
import { taps, termInput, termScreen, termSize } from "./terminals";

// Public by design: identifies the project; rules and Auth grant access.
const firebaseConfig = {
  apiKey: "AIzaSyAYoz8I8Ne5xq8OgdrR5SnRogPt9FkKahE",
  authDomain: "aira-server.firebaseapp.com",
  databaseURL: "https://aira-server-default-rtdb.firebaseio.com",
  projectId: "aira-server",
  appId: "1:972660997853:web:a379f166f997bccb606534",
  messagingSenderId: "972660997853",
};
const app = initializeApp(firebaseConfig);
// Not getAuth(): that registers the popup/redirect resolver, which loads the authDomain iframe we can't use.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getDatabase(app);
const createRoom = httpsCallable<{ room: string }, { created: boolean }>(getFunctions(app, "us-central1"), "createRoom");
const EMAIL_KEY = "phone.email";

export interface Phone {
  /** hex(HMAC-SHA256(secret, "room")), the room path. */
  roomId: string;
  /** 32 random bytes, base64; what the QR carries. */
  secret: string;
  name: string;
  addedAt: number;
}

export type RoomState = "idle" | "connecting" | "connected" | "error";

interface PhoneStore {
  /** undefined until Firebase has restored the session. */
  user: User | null | undefined;
  phones: Phone[];
  /** Sign-in link sent; waiting for the click. */
  linkSent: boolean;
  /** The pairing whose QR is on screen (not saved until the phone's first offer verifies). */
  pairing: Phone | null;
  rooms: Record<string, { state: RoomState; error?: string }>;
}

export const usePhone = create<PhoneStore>(() => ({ user: undefined, phones: [], linkSent: false, pairing: null, rooms: {} }));

// ---------- crypto, byte for byte as aira-mobile/lib/models.dart ----------

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hmacHex(secret: Uint8Array<ArrayBuffer>, msg: string) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const roomIdFor = (secret: Uint8Array<ArrayBuffer>) => hmacHex(secret, "room");
export const tagFor = (secret: Uint8Array<ArrayBuffer>, role: "offer" | "answer", at: number, sdp: string) => hmacHex(secret, `${role}\n${at}\n${sdp}`);

// ---------- rooms: one listener, one peer connection, one subscription per phone ----------

interface Room {
  phone: Phone;
  secret: Uint8Array<ArrayBuffer>;
  off: Unsubscribe | null;
  pc: RTCPeerConnection | null;
  ctl: RTCDataChannel | null;
  pty: RTCDataChannel | null;
  /** What the phone watches; `gen` stamps every pty frame. */
  sub: { key: string; gen: number } | null;
  /** Newest offer answered; anything older is a stale mailbox entry. */
  lastAt: number;
  /** `disconnected` grace: ICE gets 10 s to recover before the peer is dropped. */
  grace: ReturnType<typeof setTimeout> | null;
  /** pty frames were dropped (phone too slow); a fresh `term` + screen goes out once the buffer drains. */
  dropped: boolean;
  /** Runs once, on the first offer whose tag verifies: the phone scanned the QR. */
  onFirstOffer?: () => void;
}

const rooms = new Map<string, Room>();
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }; // ponytail: STUN only, TURN when CGNAT bites
const CHUNK = 16 * 1024;
const MAX_BUFFERED = 1024 * 1024;
const STALE_MS = 120_000;

const setRoom = (room: Room, state: RoomState, error?: string) =>
  usePhone.setState((s) => ({ rooms: { ...s.rooms, [room.phone.roomId]: { state, error } } }));

function openRoom(phone: Phone, onFirstOffer?: () => void) {
  if (rooms.has(phone.roomId)) return;
  const room: Room = { phone, secret: unb64(phone.secret), off: null, pc: null, ctl: null, pty: null, sub: null, lastAt: 0, grace: null, dropped: false, onFirstOffer };
  rooms.set(phone.roomId, room);
  setRoom(room, "idle");
  room.off = onValue(
    ref(db, `rooms/${phone.roomId}`),
    (snap) => void onOffer(room, snap.val()).catch((e) => setRoom(room, "error", String(e))),
    // permission_denied once the room exists = the phone signed in as someone else.
    (e) => setRoom(room, "error", e.message.includes("permission") ? "The phone is signed in to a different account" : e.message),
  );
}

function closeRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.off?.();
  dropPeer(room);
  rooms.delete(roomId);
  usePhone.setState((s) => {
    const { [roomId]: _, ...rest } = s.rooms;
    return { rooms: rest };
  });
}

function dropPeer(room: Room) {
  if (room.grace) clearTimeout(room.grace);
  room.grace = null;
  room.dropped = false;
  room.ctl?.close();
  room.pty?.close();
  room.pc?.close();
  room.ctl = room.pty = room.pc = null;
  room.sub = null;
}

async function onOffer(room: Room, v: unknown) {
  const { offer, answer: prev } = (v ?? {}) as { offer?: unknown; answer?: { at?: unknown } };
  if (!offer || typeof offer !== "object") return;
  const { sdp, at, tag } = offer as Record<string, unknown>;
  if (typeof sdp !== "string" || typeof at !== "number" || at <= room.lastAt || Date.now() - at > STALE_MS) return;
  if (prev?.at === at) return; // answered before a restart; the phone is on it or will re-offer
  if (tag !== (await tagFor(room.secret, "offer", at, sdp))) return; // not from the phone holding our secret
  room.lastAt = at;
  room.onFirstOffer?.();
  room.onFirstOffer = undefined;

  dropPeer(room); // a newer offer is a reconnect
  const pc = new RTCPeerConnection(ICE);
  room.pc = pc;
  setRoom(room, "connecting");
  pc.ondatachannel = ({ channel }) => {
    if (room.pc !== pc) return;
    if (channel.label === "ctl") {
      room.ctl = channel;
      const opened = () => {
        setRoom(room, "connected");
        sendState(room, true);
      };
      // Some engines hand over a channel that is already open and never fire onopen.
      if (channel.readyState === "open") opened();
      else channel.onopen = opened;
      channel.onmessage = (m) => onCtl(room, m.data);
    } else if (channel.label === "pty") {
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 64 * 1024;
      channel.onbufferedamountlow = () => {
        if (!room.dropped || room.pty !== channel) return;
        room.dropped = false;
        sendTerm(room); // the phone missed bytes: start it over from the current screen, same gen
      };
      room.pty = channel;
    }
  };
  pc.onconnectionstatechange = () => {
    if (room.pc !== pc) return;
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      dropPeer(room);
      setRoom(room, "idle");
    } else if (pc.connectionState === "disconnected") {
      setRoom(room, "connecting");
      room.grace ??= setTimeout(() => {
        if (room.pc !== pc) return;
        dropPeer(room);
        setRoom(room, "idle");
      }, 10_000);
    } else if (pc.connectionState === "connected") {
      if (room.grace) clearTimeout(room.grace);
      room.grace = null;
    }
  };
  await pc.setRemoteDescription({ type: "offer", sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc, 3000); // no trickle, like the phone: one SDP with every candidate
  if (room.pc !== pc) return;
  const answer = pc.localDescription!.sdp;
  await update(ref(db, `rooms/${room.phone.roomId}`), { answer: { sdp: answer, at, tag: await tagFor(room.secret, "answer", at, answer) } });
}

const gathered = (pc: RTCPeerConnection, ms: number) =>
  new Promise<void>((done) => {
    if (pc.iceGatheringState === "complete") return done();
    const t = setTimeout(done, ms);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(t);
      done();
    };
  });

// ---------- data channels ----------

function send(room: Room, msg: Record<string, unknown>) {
  if (room.ctl?.readyState === "open") room.ctl.send(JSON.stringify(msg));
}

function ptySend(room: Room, bytes: Uint8Array) {
  const { pty, sub } = room;
  if (!sub || pty?.readyState !== "open") return;
  if (pty.bufferedAmount > MAX_BUFFERED) {
    room.dropped = true; // resumed by onbufferedamountlow
    return;
  }
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const part = bytes.subarray(i, i + CHUNK);
    const frame = new Uint8Array(part.length + 1);
    frame[0] = sub.gen;
    frame.set(part, 1);
    pty.send(frame);
  }
}

/** `term` event (the phone resets its terminal) followed by the current screen. */
function sendTerm(room: Room) {
  const sub = room.sub;
  if (!sub) return;
  send(room, { t: "term", key: sub.key, ...termSize(sub.key), gen: sub.gen });
  const screen = termScreen(sub.key);
  if (screen) ptySend(room, new TextEncoder().encode(screen));
}

function onCtl(room: Room, raw: unknown) {
  if (typeof raw !== "string") return;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.t === "sub") {
    room.sub = typeof m.key === "string" ? { key: m.key, gen: Number(m.gen) & 0xff } : null;
    sendTerm(room);
  } else if (m.t === "in" && typeof m.key === "string" && typeof m.data === "string") termInput(m.key, m.data);
}

const watchers = (key: string) => [...rooms.values()].filter((r) => r.sub?.key === key);

// ---------- state snapshot (`Snapshot.fromJson` in models.dart) ----------

let lastState = "";
let stateTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot() {
  const s = useStore.getState();
  const projects = s.config.projects.map((p) => ({ id: p.id, name: p.name, color: p.color ?? null }));
  const terms = Object.values(s.terms)
    .filter((t) => t.status === "running")
    .map((t) => ({
    key: t.key,
    name: t.name,
    projectId: t.projectId,
    status: t.status,
    agent: t.agent ?? null,
    cwd: t.cwd,
    ...termSize(t.key),
    agentStatus: { state: s.agentStatus[t.key]?.state ?? "idle", since: s.agentStatus[t.key]?.since ?? 0 },
    subagents: s.subagents[t.key] ?? [],
    usage: s.usage[t.key] ?? [],
  }));
  return JSON.stringify({ t: "state", projects, terms });
}

function sendState(room: Room, force = false) {
  const json = force ? snapshot() : lastState;
  if (json && room.ctl?.readyState === "open") room.ctl.send(json);
}

/** Debounced: the store changes many times a second while agents run; only a changed snapshot goes out. */
function scheduleState() {
  if (!rooms.size) return;
  stateTimer ??= setTimeout(() => {
    stateTimer = null;
    const json = snapshot();
    if (json === lastState) return;
    lastState = json;
    for (const r of rooms.values()) sendState(r);
  }, 250);
}

// ---------- push ----------

/** An agent in `key` needs input: wake every paired phone that isn't already watching that terminal. Same words as the banner. */
export function phoneWake(key: string, title: string, body: string) {
  for (const r of rooms.values()) {
    if (r.ctl?.readyState === "open" && r.sub?.key === key) continue;
    const wake = { title: title.slice(0, 255), body: body.slice(0, 255), key: key.slice(0, 255), at: Date.now() };
    update(ref(db, `rooms/${r.phone.roomId}`), { wake }).catch(() => {}); // unpaired-yet room or offline: nothing to wake
  }
}

// ---------- pairing ----------

const savePhones = (phones: Phone[]) => {
  usePhone.setState({ phones });
  return api.phoneSave(JSON.stringify(phones));
};

/** Shows a new secret as a QR; the pairing is kept once the phone's first offer verifies against it. */
export async function startPairing(): Promise<Phone> {
  cancelPairing();
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const phone: Phone = { roomId: await roomIdFor(secret), secret: b64(secret), name: "", addedAt: Date.now() };
  usePhone.setState({ pairing: phone });
  // Surfaces the room limit here instead of silently on the phone; cancelPairing removes an unscanned room.
  await createRoom({ room: phone.roomId }).catch((e) => {
    usePhone.setState({ pairing: null });
    throw new Error(e?.message ?? String(e));
  });
  openRoom(phone, () => {
    const { phones, pairing } = usePhone.getState();
    if (pairing?.roomId !== phone.roomId) return;
    phone.name = `Phone ${phones.length + 1}`;
    usePhone.setState({ pairing: null });
    void savePhones([...phones, phone]).catch(() => {});
  });
  return phone;
}

export function cancelPairing() {
  const p = usePhone.getState().pairing;
  if (!p) return;
  closeRoom(p.roomId);
  usePhone.setState({ pairing: null });
  remove(ref(db, `rooms/${p.roomId}`)).catch(() => {}); // the room createRoom made for a QR nobody scanned
}

export async function unpair(roomId: string) {
  closeRoom(roomId);
  remove(ref(db, `rooms/${roomId}`)).catch(() => {});
  await savePhones(usePhone.getState().phones.filter((p) => p.roomId !== roomId));
}

export async function renamePhone(roomId: string, name: string) {
  await savePhones(usePhone.getState().phones.map((p) => (p.roomId === roomId ? { ...p, name } : p)));
}

// ---------- sign-in ----------

/** Email link that lands on a loopback listener; `localhost` is an authorized domain of the project. */
export async function sendLink(email: string) {
  // ponytail: each attempt leaves its listener thread waiting; a few idle ports per session is fine.
  const port = await api.phoneLoginListen();
  localStorage.setItem(EMAIL_KEY, email);
  await sendSignInLinkToEmail(auth, email, { url: `http://localhost:${port}/`, handleCodeInApp: true });
  usePhone.setState({ linkSent: true });
}

export async function logOut() {
  cancelPairing();
  for (const id of [...rooms.keys()]) closeRoom(id);
  await signOut(auth);
}

export const userEmail = () => usePhone.getState().user?.email ?? null;

// ---------- boot ----------

let booted = false;
/** Called once from the store's boot; wires the terminal taps and restores the sign-in and pairings. */
export function initPhone() {
  if (booted) return;
  booted = true;
  taps.out = (key, bytes) => {
    for (const r of watchers(key)) ptySend(r, bytes);
  };
  taps.exit = (key, code) => {
    for (const r of watchers(key)) send(r, { t: "exit", key, code, gen: r.sub!.gen });
  };
  taps.resize = (key, cols, rows) => {
    for (const r of watchers(key)) send(r, { t: "resize", key, cols, rows, gen: r.sub!.gen });
    scheduleState();
  };
  taps.start = (key) => {
    for (const r of watchers(key)) sendTerm(r);
  };
  useStore.subscribe(scheduleState);

  void listen<string>("phone-login-url", async (e) => {
    const email = localStorage.getItem(EMAIL_KEY);
    if (!email || !isSignInWithEmailLink(auth, e.payload)) return;
    try {
      await signInWithEmailLink(auth, email, e.payload);
      localStorage.removeItem(EMAIL_KEY);
      usePhone.setState({ linkSent: false });
    } catch (err) {
      notify(err);
    }
  });

  const phones = api
    .phoneLoad()
    .then((json) => (json ? (JSON.parse(json) as Phone[]) : []))
    .catch(() => [] as Phone[]);
  void phones.then((list) => usePhone.setState({ phones: list }));

  // Listeners attached while signed out are cancelled with permission_denied, so rooms open only with a user.
  onAuthStateChanged(auth, async (user) => {
    usePhone.setState({ user });
    if (!user) {
      for (const id of [...rooms.keys()]) closeRoom(id);
      return;
    }
    for (const p of await phones) openRoom(p);
  });
}
