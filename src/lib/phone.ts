/**
 * Phone companion (MOBILE.md, BACKEND.md). Firebase Realtime Database is only the mailbox for one
 * WebRTC offer and answer per connection; after that the phone (aira-mobile) talks to this Mac over
 * the `ctl` data channel it opens: JSON both ways. The phone sees the board (state snapshots) and one
 * terminal's agent session as a conversation folded from the Claude Code transcript (lib/conv), and
 * types raw input back. One pairing secret = one room = one phone; secrets live in the Keychain
 * (phone.rs), the sign-in in IndexedDB.
 */
import { listen } from "@tauri-apps/api/event";
import { initializeApp } from "firebase/app";
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail, signInWithEmailLink, signOut, type User } from "firebase/auth";
import { getDatabase, onValue, ref, remove, update, type Unsubscribe } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { create } from "zustand";
import { api, type HookEvent } from "../ipc";
import { notify, useStore } from "../store";
import { asksInput } from "./agentEvents";
import { fold, type ConvItem } from "./conv";
import { taps, termInput, termSize, transcriptPath } from "./terminals";

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
  /** The terminal the phone watches; `gen` stamps every `conv`. */
  sub: { key: string; gen: number } | null;
  /** Newest offer answered; anything older is a stale mailbox entry. */
  lastAt: number;
  /** `disconnected` grace: ICE gets 10 s to recover before the peer is dropped. */
  grace: ReturnType<typeof setTimeout> | null;
  /** Runs once, on the first offer whose tag verifies: the phone scanned the QR. */
  onFirstOffer?: () => void;
}

const rooms = new Map<string, Room>();
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }; // ponytail: STUN only, TURN when CGNAT bites
const STALE_MS = 120_000;

const setRoom = (room: Room, state: RoomState, error?: string) =>
  usePhone.setState((s) => ({ rooms: { ...s.rooms, [room.phone.roomId]: { state, error } } }));

function openRoom(phone: Phone, onFirstOffer?: () => void) {
  if (rooms.has(phone.roomId)) return;
  const room: Room = { phone, secret: unb64(phone.secret), off: null, pc: null, ctl: null, sub: null, lastAt: 0, grace: null, onFirstOffer };
  rooms.set(phone.roomId, room);
  setRoom(room, "idle");
  // The whole room, not just `offer`: an offer already answered before a restart shows as answer.at === offer.at.
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
  room.ctl?.close();
  room.pc?.close();
  room.ctl = room.pc = null;
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
    if (room.pc !== pc || channel.label !== "ctl") return;
    room.ctl = channel;
    const opened = () => {
      setRoom(room, "connected");
      sendState(room, true);
    };
    // Some engines hand over a channel that is already open and never fire onopen.
    if (channel.readyState === "open") opened();
    else channel.onopen = opened;
    channel.onmessage = (m) => onCtl(room, m.data);
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

// ---------- ctl ----------

function send(room: Room, msg: Record<string, unknown>) {
  if (room.ctl?.readyState === "open") room.ctl.send(JSON.stringify(msg));
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
    if (room.sub) {
      const c = convOf(room.sub.key);
      if (c.ready) sendBacklog(room, c); // else the first tick sends it to every subscriber
    }
  } else if (m.t === "in" && typeof m.key === "string" && typeof m.data === "string") termInput(m.key, m.data);
}

const watchers = (key: string) => [...rooms.values()].filter((r) => r.sub?.key === key);

// ---------- conversation: the Claude transcript, tailed while a phone watches ----------

interface Conv {
  key: string;
  /** Transcript on disk, once a hook reported it. */
  path?: string;
  offset: number;
  items: Map<string, ConvItem>;
  unsupported?: string;
  /** First evaluation done: late subscribers get the backlog at once. */
  ready: boolean;
  loading: boolean;
  timer: ReturnType<typeof setInterval>;
}

const convs = new Map<string, Conv>();
const BACKLOG = 50;
const MSG_BYTES = 48 * 1024; // flush below this; SCTP caps a message around 256 KB

function convOf(key: string): Conv {
  let c = convs.get(key);
  if (!c) {
    c = { key, offset: 0, items: new Map(), ready: false, loading: false, timer: setInterval(() => void tick(key), 1000) };
    convs.set(key, c);
    void tick(key);
  }
  return c;
}

function unsupportedReason(key: string): string | undefined {
  const t = useStore.getState().terms[key];
  if (!t) return "This terminal is gone";
  if (!t.agent) return "A shell has no conversation. Input below still runs commands.";
  if (t.agent !== "claude") return "Conversation view supports Claude Code only for now.";
  if (!transcriptPath(key)) return "Waiting for Claude Code's first message. Status tracking must be on for this project.";
}

async function tick(key: string) {
  const c = convs.get(key);
  if (!c) return;
  const subs = watchers(key);
  if (!subs.length) {
    clearInterval(c.timer); // nobody watching: forget it, the next sub rebuilds from the transcript
    convs.delete(key);
    return;
  }
  if (c.loading) return;
  c.loading = true;
  try {
    const path = transcriptPath(key);
    if (path !== c.path || !c.ready) {
      c.path = path;
      c.offset = 0;
      c.items.clear();
      if (path) await load(c);
      c.unsupported = unsupportedReason(key);
      c.ready = true;
      for (const r of subs) sendBacklog(r, c);
      return;
    }
    if (!path) return;
    const { changed, reset } = await load(c);
    const st = useStore.getState().agentStatus[key]?.state;
    if (st !== "waiting") {
      for (const it of c.items.values()) {
        if (it.role !== "prompt" || it.status !== "pending") continue;
        it.status = "done"; // the question was answered (here or on the phone)
        changed.push(it.id);
      }
    }
    if (reset) for (const r of subs) sendBacklog(r, c);
    else if (changed.length) for (const r of subs) sendConv(r, c, changed.map((id) => c.items.get(id)!), false);
  } catch (e) {
    c.unsupported = `Transcript unreadable: ${String(e)}`;
  } finally {
    c.loading = false;
  }
}

async function load(c: Conv) {
  const { lines, offset } = await api.agentTranscript(c.path!, c.offset);
  const reset = offset < c.offset; // the file shrank: Rust started over, so do we
  if (reset) c.items.clear();
  c.offset = offset;
  return { changed: fold(c.items, lines), reset };
}

function sendBacklog(room: Room, c: Conv) {
  const all = [...c.items.values()];
  sendConv(room, c, all.slice(-BACKLOG), true);
}

/** `conv` messages for `items`, chunked by size; the first carries `reset` and the unsupported reason. */
function sendConv(room: Room, c: Conv, items: ConvItem[], reset: boolean) {
  const sub = room.sub;
  if (!sub || sub.key !== c.key) return;
  const head = { t: "conv", key: c.key, gen: sub.gen, ...(c.unsupported ? { unsupported: c.unsupported } : {}) };
  if (!items.length) return send(room, { ...head, reset, items: [] });
  let batch: ConvItem[] = [];
  let bytes = 0;
  const flush = () => {
    if (!batch.length) return;
    send(room, { ...head, reset: reset && batch[0] === items[0], items: batch });
    batch = [];
    bytes = 0;
  };
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (bytes + n > MSG_BYTES) flush();
    batch.push(it);
    bytes += n;
  }
  flush();
}

/** A Notification hook that asks for input becomes a `prompt` item the phone answers with Yes/No. */
function onHookEvents(key: string, events: HookEvent[]) {
  const c = convs.get(key);
  if (!c) return;
  for (const e of events) {
    if (e.hook_event_name !== "Notification" || e.agent_id || !asksInput(e.notification_type)) continue;
    const it: ConvItem = { id: `prompt:${Date.now()}`, role: "prompt", ts: Date.now(), text: e.message || "Claude Code needs your input", status: "pending" };
    c.items.set(it.id, it);
    for (const r of watchers(key)) sendConv(r, c, [it], false);
  }
}

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
  taps.exit = (key, code) => {
    for (const r of watchers(key)) send(r, { t: "exit", key, code });
  };
  taps.resize = () => scheduleState(); // cols/rows ride in the snapshot
  taps.hook = onHookEvents;
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
