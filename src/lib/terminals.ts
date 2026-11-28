import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { Channel } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "@xterm/xterm/css/xterm.css";
import { api, type HookEvent, type Project, type PtyMessage, type Script, type Settings } from "../ipc";
import { dropTab, notify, openTerminalTab, projectById, scriptCwd, scriptsWindow, spaceOfPath, uid, updateConfig, useStore, type AgentStatus, type Term } from "../store";
import { agentById, type Agent } from "./agents";
import { phoneWake } from "./phone";
import { openLink, popupMenu } from "./menu";
import { ask, choose } from "./dialog";
import { emptyTree, fold, normalize, type AgentEvent, type TreeState } from "./agentEvents";

// Lazy accessor: store.ts and this module import each other.
const get = () => useStore.getState();

const DARK: ITheme = {
  background: "#0b0b0c", foreground: "#e4e4e7", cursor: "#e4e4e7", cursorAccent: "#0b0b0c",
  selectionBackground: "#3a3d4580",
  black: "#1f1f23", red: "#f87171", green: "#4ade80", yellow: "#facc15", blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#d4d4d8",
  brightBlack: "#71717a", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde047", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9", brightWhite: "#fafafa",
};
const LIGHT: ITheme = {
  background: "#ffffff", foreground: "#1f2328", cursor: "#1f2328", cursorAccent: "#ffffff",
  selectionBackground: "#b6d7ff80",
  black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#9a6700", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
  brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
};

interface XT {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  opened: boolean;
  webgl: WebglAddon | null;
  /** kitty keyboard protocol flag stack (top = active); [0] = legacy encoding. */
  kitty: number[];
}

// ---------- kitty keyboard protocol ----------
// xterm.js has none, so a TUI can't tell Ctrl+Enter or Shift+Enter from Enter and Claude Code falls back to its
// ctrl+x ctrl+s chord. Answering the query (CSI ? u) and encoding keys as CSI u while flags are pushed gives it
// ctrl+enter to send now, shift+enter for a newline and an unambiguous Esc, as in Orca or Ghostty.
// https://sw.kovidgoyal.net/kitty/keyboard-protocol/
const KITTY_SPECIAL: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, Backspace: 127 };

/** CSI u encoding for a keydown under the "disambiguate" flag, or null when the legacy bytes are right. */
function kittyEncode(e: KeyboardEvent): string | null {
  // Cmd+Enter counts as Ctrl+Enter (Claude Code's "send now"): super+enter is bound nowhere, and Orca users expect it.
  const ctrl = e.ctrlKey || (e.metaKey && e.key === "Enter");
  const mods = 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (ctrl ? 4 : 0);
  const special = KITTY_SPECIAL[e.key];
  if (special) {
    if (e.key !== "Escape" && mods === 1) return null; // plain Enter/Tab/Backspace stay legacy per spec
    return `\x1b[${special}${mods > 1 ? `;${mods}` : ""}u`;
  }
  if (e.metaKey || (!e.ctrlKey && !e.altKey) || e.key.length !== 1) return null; // Cmd shortcuts, plain text, other keys
  return `\x1b[${e.key.toLowerCase().codePointAt(0)};${mods}u`;
}

/** Ctrl+C / Esc, in legacy or CSI u form. */
const isInterrupt = (d: string) => d === "\x03" || d === "\x1b" || /^\x1b\[(27|99;5)(;\d+)?u$/.test(d);

const xts = new Map<string, XT>();
let theme = DARK;
let lastSize = { cols: 120, rows: 32 };

// ---------- phone companion taps (lib/phone) ----------

/** Exit, resize and raw hook events of every terminal; lib/phone fills these in for its conversation view. */
export const taps = {
  exit: (_key: string, _code: number) => {},
  resize: (_key: string, _cols: number, _rows: number) => {},
  hook: (_key: string, _events: HookEvent[]) => {},
};
/** The Claude Code transcript a terminal's hooks reported, if any yet. */
export const transcriptPath = (key: string) => transcripts.get(key);
export const termSize = (key: string) => {
  const t = xts.get(key)?.term;
  return t ? { cols: t.cols, rows: t.rows } : lastSize;
};
/** Types into a terminal as if at its keyboard: same path as local input (heuristics, ptyWrite). */
export const termInput = (key: string, data: string) => xts.get(key)?.term.input(data);
const fontFamily = (s: Settings) => `"${s.monoFont}", "SF Mono", Menlo, monospace`;

export function setTerminalTheme(dark: boolean, s: Settings) {
  theme = dark ? DARK : LIGHT;
  for (const x of xts.values()) {
    x.term.options.theme = theme;
    x.term.options.fontFamily = fontFamily(s);
    x.term.options.fontSize = s.fontSize;
    fit(x);
  }
}

const setTerm = (key: string, patch: Partial<Term>) =>
  useStore.setState((s) => (s.terms[key] ? { terms: { ...s.terms, [key]: { ...s.terms[key], ...patch } } } : {}));

function xterm(key: string): XT {
  const existing = xts.get(key);
  if (existing) return existing;
  const s = get().config.settings;
  const term = new Terminal({
    ...lastSize,
    theme,
    fontFamily: fontFamily(s),
    fontSize: s.fontSize,
    scrollback: 5000,
    cursorBlink: true,
    macOptionIsMeta: true,
    allowProposedApi: true,
    linkHandler: { activate: (_e, uri) => void openLink(uri) }, // OSC 8 hyperlinks; WebLinksAddon covers plain-text URLs
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon((_e, uri) => void openLink(uri)));
  const live = () => {
    const t = get().terms[key];
    return t?.sessionId && t.status === "running" ? t.sessionId : null;
  };
  const send = (d: string) => {
    const id = live();
    if (id) api.ptyWrite(id, d).catch(() => {});
  };
  const kitty = [0];
  const num = (v: number | number[] | undefined) => (typeof v === "number" ? v : Array.isArray(v) ? (v[0] ?? 0) : 0);
  const top = () => kitty[kitty.length - 1];
  term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => (send(`\x1b[?${top()}u`), true));
  term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (p) => (kitty.push(num(p[0])), true));
  term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (p) => {
    for (let n = num(p[0]) || 1; n > 0 && kitty.length > 1; n--) kitty.pop();
    return true;
  });
  term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (p) => {
    const f = num(p[0]);
    const mode = num(p[1]) || 1;
    kitty[kitty.length - 1] = mode === 1 ? f : mode === 2 ? top() | f : top() & ~f;
    return true;
  });
  term.attachCustomKeyEventHandler((e) => {
    // WebKit also fires keypress for Shift+Enter; left to xterm, that sends a second CR after ours (= submit).
    if (e.type !== "keydown") return !(e.key === "Enter" && e.shiftKey);
    // xterm sends ESC [ Z for Shift+Tab but leaves the browser's default on, so focus walked out of the
    // terminal on every Claude Code mode cycle. Stop the default; xterm still processes the key.
    if (e.key === "Tab" && e.shiftKey) e.preventDefault();
    if (e.metaKey && e.key === "k") {
      term.clear();
      return false;
    }
    if (top() & 1) {
      const enc = kittyEncode(e);
      if (enc) {
        lastIn.set(key, Date.now());
        if (isInterrupt(enc)) interrupted(key);
        send(enc);
        return false;
      }
    }
    // Shift+Enter in an agent terminal = new line, not submit. ESC CR (Option+Enter) is what Claude Code's own
    // /terminal-setup binds in VS Code and Alacritty (a bare LF counts as Enter there); Gemini CLI reads backslash + Enter.
    const agent = get().terms[key]?.agent;
    if (e.shiftKey && e.key === "Enter" && agent) {
      term.input(agent === "claude" ? "\x1b\r" : "\\\r");
      return false;
    }
    // Ctrl+Enter / Cmd+Enter before Claude Code has pushed its keyboard flags (it asks at startup; a session
    // reattached after a restart answers nothing): a plain CR would read as Enter, so send its ctrl+x ctrl+s
    // chord, as two ordered writes so the input parser sees two keys, not one unknown sequence.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && agent === "claude") {
      const id = live();
      if (id) {
        lastIn.set(key, Date.now());
        api.ptyWrite(id, "\x18").then(() => api.ptyWrite(id, "\x13")).catch(() => {});
      }
      return false;
    }
    return true;
  });
  term.onData((d) => {
    lastIn.set(key, Date.now());
    if (isInterrupt(d)) interrupted(key); // Ctrl+C / Esc
    else answered(key); // typing at a "Needs input" prompt: the agent is working again until its next status hook
    const id = live();
    if (id) api.ptyWrite(id, d).catch(() => {});
  });
  term.onBell(() => {
    // Agents also ring the bell when a turn ends, so it only means "needs input" where hooks give no exact status.
    if (get().terms[key]?.agent && !hookActive.has(key)) notifyAgent(key, "Waiting Input");
  });
  term.onResize(({ cols, rows }) => {
    lastResize.set(key, Date.now()); // the redraw that follows is not "work" (see the heuristic)
    taps.resize(key, cols, rows);
    const id = live();
    if (id) api.ptyResize(id, cols, rows).catch(() => {});
  });
  const el = document.createElement("div");
  el.className = "xterm-host";
  // xterm's own handler runs first: it selects the word under the cursor and focuses its hidden
  // textarea with the selection, so native Copy/Paste act on the terminal.
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    popupMenu(["Copy", "Paste", "-", { text: "Select All", action: () => term.selectAll() }, { text: "Clear", action: () => term.clear() }]);
  });
  // ⌘V with files on the clipboard: xterm would paste nothing. WebKit shows them only as nameless File items
  // (a Finder ⌘C and a screenshot look the same), so the native pasteboard decides: copied files paste their
  // paths, as Terminal.app does; a bare image hands the agent Ctrl+V, on which Claude Code (and Gemini CLI)
  // read the clipboard image themselves.
  el.addEventListener(
    "paste",
    (e) => {
      if (!e.clipboardData?.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void api.clipboardPaths().then((paths) => {
        if (paths.length) pasteFiles(key, term, paths);
        else if (get().terms[key]?.agent) term.input("\x16");
      });
    },
    true,
  );
  const x: XT = { term, fit: fitAddon, el, opened: false, webgl: null, kitty };
  xts.set(key, x);
  hookFileDrops();
  return x;
}

/**
 * File paths into a terminal as a paste (bracketed when the app asked for it), not keystrokes: Claude Code turns
 * a pasted image path into an [Image #N] attachment. Other files go to Claude as @path mentions, read on submit.
 */
function pasteFiles(key: string, term: Terminal, paths: string[]) {
  const esc = (p: string) => p.replace(/[ '"()&;|<>$`\\]/g, "\\$&");
  const mention = get().terms[key]?.agent === "claude";
  term.paste(paths.map((p) => (!mention || /\.(png|jpe?g|gif|webp)$/i.test(p) ? esc(p) : "@" + esc(p))).join(" ") + " ");
}

// Files dropped on a terminal (screenshots, logs): Tauri swallows the DOM drop event, so take its own and
// paste the paths into the terminal under the pointer.
let dropsHooked = false;
function hookFileDrops() {
  if (dropsHooked) return;
  dropsHooked = true;
  void getCurrentWebview().onDragDropEvent((e) => {
    const pl = e.payload;
    if (pl.type !== "drop" || !pl.paths.length) return;
    // wry on macOS passes NSDraggingInfo.draggingLocation (points) through as "physical"; elsewhere it is pixels.
    const { x, y } = pl.position.toLogical(navigator.platform.startsWith("Mac") ? 1 : window.devicePixelRatio);
    const target = document.elementFromPoint(x, y);
    const hit = target && [...xts.entries()].find(([, v]) => v.el.contains(target));
    if (!hit) return;
    const [tkey, xt] = hit;
    pasteFiles(tkey, xt.term, pl.paths);
    xt.term.focus();
  });
}

function fit(x: XT) {
  if (!x.opened || !x.el.isConnected || x.el.clientWidth === 0) return;
  try {
    x.fit.fit();
    lastSize = { cols: x.term.cols, rows: x.term.rows };
  } catch {
    /* not measurable yet */
  }
}

/** Mounts the terminal's persistent DOM node into `host`; returns the detach function. */
export function attach(key: string, host: HTMLElement) {
  const x = xterm(key);
  host.appendChild(x.el);
  if (!x.opened) {
    x.term.open(x.el); // lazily: open() needs a connected element to measure fonts
    x.opened = true;
  }
  // WebGL only for the visible terminal: WebKit caps live contexts at 16 and it's broken on some macOS builds.
  if (get().config.settings.terminalWebgl) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        x.webgl = null;
      });
      x.term.loadAddon(webgl);
      x.webgl = webgl;
    } catch {
      x.webgl = null;
    }
  }
  const ro = new ResizeObserver(() => fit(x));
  ro.observe(host);
  fit(x);
  x.term.focus();
  return () => {
    ro.disconnect();
    x.webgl?.dispose();
    x.webgl = null;
    x.el.remove();
  };
}

// ---------- sessions ----------

const exitWaiters = new Map<string, () => void>();
const ACK_EVERY = 128 * 1024;

export async function startSession(key: string) {
  const t = get().terms[key];
  if (!t || t.status === "running" || t.status === "stopping") return;
  const x = xterm(key);
  x.kitty.splice(0, x.kitty.length, 0); // a new program starts in legacy encoding
  if (t.sessionId) x.term.write("\r\n\x1b[2m── restarted ──\x1b[0m\r\n");
  const sessionId = uid();
  const now = Date.now();
  setTerm(key, { sessionId, status: "running", startedAt: now, endedAt: undefined, exitCode: undefined, stopped: false });
  const scriptId = t.scriptId;
  if (scriptId)
    updateConfig((c) => {
      if (c.scripts[scriptId]) c.scripts[scriptId].lastRunAt = now;
    });
  try {
    const { command, env } = await withAgentHooks(t);
    await api.ptySpawn({ id: sessionId, cwd: t.cwd, command, cols: x.term.cols, rows: x.term.rows, env, onData: channelFor(key, sessionId, x) });
  } catch (e) {
    x.term.write(`\r\n\x1b[31mFailed to start: ${e}\x1b[0m\r\n`);
    setTerm(key, { status: "exited", exitCode: -1, endedAt: Date.now() });
  }
}

/** Output of `sessionId` into the terminal, acked in chunks for the Rust side's flow control; the exit message ends it. */
function channelFor(key: string, sessionId: string, x: XT) {
  let unacked = 0;
  return new Channel<PtyMessage>((msg) => {
    if (msg instanceof ArrayBuffer) {
      lastOut.set(key, Date.now());
      const bytes = new Uint8Array(msg);
      x.term.write(bytes, () => {
        unacked += bytes.length;
        if (unacked >= ACK_EVERY) {
          api.ptyAck(sessionId, unacked).catch(() => {});
          unacked = 0;
        }
      });
    } else onExit(key, sessionId, msg.exit);
  });
}

// ---------- relaunch handoff (plan 015) ----------

type Handoff = { sessionId: string; startedAt?: number; scrollback: string; hooked: boolean; kitty?: number[] };
const handoffPath = async () => join(await appConfigDir(), "handoff.json");
let inheritedIds = new Set<string>();

/** Before a relaunch: which session each live terminal runs and what is on its screen, for `attachInherited`. */
export async function writeHandoff() {
  const out: Record<string, Handoff> = {};
  for (const t of Object.values(get().terms)) {
    if (!live(t)) continue;
    const x = xts.get(t.key);
    let scrollback = "";
    if (x) {
      const s = new SerializeAddon();
      x.term.loadAddon(s);
      scrollback = s.serialize({ scrollback: 2000 });
      s.dispose();
    }
    out[t.key] = { sessionId: t.sessionId!, startedAt: t.startedAt, scrollback, hooked: hooked.has(t.key), kitty: x?.kitty };
  }
  await api.writeFile(await handoffPath(), JSON.stringify(out));
}

/** At boot: what the previous process saved about the sessions it handed over, keyed by terminal; only
 * sessions the Rust side actually holds count, so a stale file is inert. */
export async function readHandoff(): Promise<Record<string, Handoff>> {
  inheritedIds = new Set(await api.ptyInherited().catch(() => [] as string[]));
  if (!inheritedIds.size) return {};
  let saved: Record<string, Handoff> = {};
  try {
    saved = JSON.parse(await api.readFile(await handoffPath()));
  } catch {
    /* no file: nothing to reattach */
  }
  return Object.fromEntries(Object.entries(saved).filter(([, h]) => inheritedIds.has(h.sessionId)));
}

/** Reattaches the terminals `boot` marked running from the handoff. A session no tab claims is ended. */
export function attachInherited(handoff: Record<string, Handoff>) {
  const claimed = new Set<string>();
  for (const [key, h] of Object.entries(handoff)) {
    if (get().terms[key]?.sessionId !== h.sessionId) continue;
    claimed.add(h.sessionId);
    void attachSession(key, h);
  }
  for (const id of inheritedIds) if (!claimed.has(id)) api.ptyKill(id).catch(() => {}); // its tab was closed before the relaunch
}

async function attachSession(key: string, h: Handoff) {
  const x = xterm(key);
  if (h.scrollback) x.term.write(h.scrollback);
  if (h.kitty?.length) x.kitty.splice(0, Infinity, ...h.kitty); // the program keeps expecting CSI u keys
  if (h.hooked) hooked.add(key); // keep reading the agent's hook events
  lastResize.set(key, Date.now()); // pty_attach resizes (SIGWINCH): the redraw of a long transcript can take seconds
  try {
    await api.ptyAttach({ id: h.sessionId, cols: x.term.cols, rows: x.term.rows, onData: channelFor(key, h.sessionId, x) });
  } catch (e) {
    x.term.write(`\r\n\x1b[31mCould not reattach: ${e}\x1b[0m\r\n`);
    setTerm(key, { status: "exited", exitCode: -1, endedAt: Date.now() });
  }
}

function onExit(key: string, sessionId: string, code: number) {
  exitWaiters.get(sessionId)?.();
  exitWaiters.delete(sessionId);
  const t = get().terms[key];
  if (!t || t.sessionId !== sessionId) return; // stale message from an earlier run
  // Plain shell exited (`exit`, Ctrl-D): close it like any terminal app, unless its space went to sleep.
  if (!t.scriptId && !t.command && !sleeping.delete(key)) return removeTerm(key, true);
  if (t.agent && t.status !== "stopping") notifyAgent(key, code === 0 ? "Exited" : `Exited with code ${code}`);
  const stopped = t.status === "stopping";
  taps.exit(key, code);
  xts.get(key)?.kitty.splice(0, Infinity, 0);
  xts.get(key)?.term.write(`\r\n\x1b[2m[${stopped ? "stopped" : `process exited with code ${code}`}]\x1b[0m\r\n`);
  setTerm(key, { status: "exited", exitCode: code, endedAt: Date.now(), stopped });
}

export function stop(key: string) {
  const t = get().terms[key];
  if (!t?.sessionId || t.status !== "running") return;
  setTerm(key, { status: "stopping" });
  api.ptyKill(t.sessionId).catch(() => {});
}

/** `projectId`: whose scripts window shows a restarted script (default: where its tab is, else its owner's). */
export async function restart(key: string, projectId?: string) {
  const t = get().terms[key];
  if (t?.sessionId && (t.status === "running" || t.status === "stopping")) {
    const exited = new Promise<void>((resolve) => {
      exitWaiters.set(t.sessionId!, resolve);
      setTimeout(resolve, 6000); // never hang the button on a lost exit message
    });
    stop(key);
    await exited;
    setTerm(key, { status: "exited" });
  }
  if (t?.scriptId) return runScript(t.scriptId, true, projectId);
  await startSession(key);
}

const live = (t?: Term): t is Term => !!t?.sessionId && (t.status === "running" || t.status === "stopping");

const sleeping = new Set<string>(); // shells stopped by a space going to sleep keep their tab
/** Stops a terminal for a sleeping space; its tab stays so waking can start it again. */
export function sleepTerm(key: string) {
  if (!live(get().terms[key])) return;
  sleeping.add(key);
  stop(key);
}

/** Terminals among `keys` that are running something: a script/command/agent, or a shell with a foreground job. */
export async function busyTerms(keys: string[]): Promise<Term[]> {
  const running = keys.map((k) => get().terms[k]).filter(live);
  const shells = running.filter((t) => !t.scriptId && !t.command).map((t) => t.sessionId!);
  const busy = new Set(await api.ptyBusy(shells).catch(() => shells)); // unknown counts as busy
  return running.filter((t) => t.scriptId || t.command || busy.has(t.sessionId!));
}

export const runningList = (ts: Term[]) => ts.map((t) => `• ${t.name}`).join("\n");

/** Cancel / Force close when any of `keys` is running something; true = go ahead (they get killed). */
export async function confirmKill(keys: string[], title: string, intro = "") {
  const busy = await busyTerms(keys);
  if (!busy.length) return true;
  const n = busy.length === 1 ? "This terminal is" : `${busy.length} terminals are`;
  return ask(`${intro}${n} still running:\n${runningList(busy)}`, { title, kind: "warning", okLabel: "Force close", cancelLabel: "Cancel" });
}

/** Closing a script's tab: stop it, or let it keep running in the background (reopen from the sidebar). */
export async function confirmScriptClose(key: string): Promise<"stop" | "keep" | "cancel"> {
  const t = get().terms[key];
  if (!live(t)) return "keep";
  const r = await choose(`"${t.name}" is still running.`, { title: "Close terminal", kind: "warning", buttons: ["Force close", "Keep running", "Cancel"] });
  return r === "Force close" ? "stop" : r === "Keep running" ? "keep" : "cancel";
}

/** Kills (if needed) and forgets a terminal. `closeTab` true also closes its tab. */
export function removeTerm(key: string, closeTab = false) {
  stop(key);
  forgetHooks(key);
  const x = xts.get(key);
  x?.term.dispose();
  x?.el.remove();
  xts.delete(key);
  useStore.setState((s) => {
    const { [key]: _, ...terms } = s.terms;
    return { terms };
  });
  // Any space's view may hold it (a shell can exit in a space you're not looking at).
  if (closeTab) updateConfig((c) => [c.layout, ...Object.values(c.layout.views)].forEach((v) => dropTab(v, `term:${key}`)));
}

/**
 * A shell; with `command` a one-off run (not saved as a script) that stays open after it exits;
 * with `agent` a coding-agent terminal whose activity is tracked.
 */
export function newTerminal(projectId: string, opts: { cwd?: string; command?: string; label?: string; agent?: string } = {}) {
  const p = projectById(projectId);
  if (!p) return;
  const { cwd, command, label, agent } = opts;
  const key = `t-${uid()}`;
  // Numbered per base name ("ide · Claude Code 2"), so two agents of one kind stay apart in tabs, banners and notices.
  const base = `${p.name} · ${label || (cwd && cwd !== p.path ? cwd.slice(cwd.lastIndexOf("/") + 1) : "shell")}`;
  const n = Object.values(get().terms).filter((t) => t.projectId === projectId && !t.scriptId && (t.name === base || t.name.startsWith(`${base} `))).length;
  const name = n ? `${base} ${n + 1}` : base;
  useStore.setState((s) => ({ terms: { ...s.terms, [key]: { key, name, projectId, cwd: cwd ?? p.path, command, agent, status: "idle" } } }));
  openTerminalTab(key);
  startSession(key);
}

export const renameTerm = (key: string, name: string) => setTerm(key, { name: name.trim() || get().terms[key]?.name, renamed: true });

// ---------- scripts ----------

const scriptTermName = (s: Script) => `${projectById(s.ownerProjectId)?.name ?? "external"} · ${s.name}`;

/** Script terminals are keyed by script id, so a linked script shows one shared process everywhere. */
function ensureScriptTerm(scriptId: string, projectId?: string) {
  const s = get().config.scripts[scriptId];
  if (!s) return;
  const existing = get().terms[scriptId];
  const patch = { cwd: scriptCwd(s), command: s.command, name: existing?.renamed ? existing.name : scriptTermName(s) };
  useStore.setState((st) => ({
    terms: {
      ...st.terms,
      [scriptId]: existing
        ? { ...existing, ...patch }
        : { key: scriptId, scriptId, projectId: s.ownerProjectId ?? projectId ?? "", status: "idle", ...patch },
    },
  }));
}

/** Opens in `projectId`'s scripts window (default: its owner's), unless its tab is already in the current window. */
export async function runScript(scriptId: string, activate = true, projectId?: string) {
  ensureScriptTerm(scriptId, projectId);
  const t = get().terms[scriptId];
  if (!t) return;
  openTerminalTab(scriptId, activate, scriptsWindow(projectId ?? t.projectId));
  if (t.status !== "running" && t.status !== "stopping") await startSession(scriptId);
}

export function showScript(scriptId: string, projectId: string) {
  ensureScriptTerm(scriptId, projectId);
  openTerminalTab(scriptId, true, scriptsWindow(projectId));
}

/** What the project's Start button launches: its ticked scripts (still linked), or every script when none is ticked. */
const startSet = (p: Project) => {
  const picked = p.startScriptIds.filter((id) => p.scriptIds.includes(id));
  return picked.length ? picked : p.scriptIds;
};

export function runStart(projectId: string) {
  const p = projectById(projectId);
  if (p) startSet(p).forEach((id, i) => runScript(id, i === 0, projectId)); // into its scripts window
}

/** Stops every script of the project (Start's counterpart while any of them runs). */
export function stopAllScripts(projectId: string) {
  projectById(projectId)?.scriptIds.forEach((id) => stop(id));
}

// ---------- coding-agent activity ----------

const lastOut = new Map<string, number>();
const lastIn = new Map<string, number>();
const lastResize = new Map<string, number>(); // xterm fit or a reattach: the agent redraws, sometimes for seconds
const QUIET_MS = 20_000; // longest an agent that is working goes without redrawing its spinner, with margin

// ponytail: activity heuristic. Agent TUIs animate a spinner while working and sit still while
// waiting for you. Output right after input (typing echo, resize redraw) doesn't count, and
// nothing counts before the first input (startup banner). Upgrade path: agent hooks
// (e.g. Claude Code `--settings` hooks) for exact states.
setInterval(() => {
  const { terms, agentStatus } = get();
  const now = Date.now();
  let next: Record<string, AgentStatus> | null = null;
  const put = (k: string, v: AgentStatus | undefined) => {
    next ??= { ...agentStatus };
    if (v) next[k] = v;
    else delete next[k];
  };
  for (const t of Object.values(terms)) {
    if (!t.agent || t.status !== "running") continue;
    if (hooked.has(t.key)) {
      pollHooks(t.key); // exact status + subagents from Claude hooks
      if (hookActive.has(t.key)) {
        // No Stop hook comes when a turn dies on an API error ("Connection lost mid-response") or a crash, which
        // pinned Working for good. The agent's spinner redraws constantly while it really works (even during a
        // long tool call), so a long silence means the turn is over: hand status back to the heuristic.
        const quiet = agentStatus[t.key]?.state === "working" && now - (lastOut.get(t.key) ?? now) > QUIET_MS;
        if (!quiet) continue;
        hookActive.delete(t.key);
      }
    }
    const out = lastOut.get(t.key) ?? 0;
    const inp = lastIn.get(t.key);
    const prev = agentStatus[t.key];
    // Claude Code reprints its whole transcript on SIGWINCH, for seconds on a long session (every tab, after a
    // relaunch). So a turn only *starts* on a keystroke newer than the last resize; once working, output alone
    // keeps it there, and 1.5s of silence ends it.
    const busy = now - out < 1500;
    const state = prev?.state === "working" ? (busy ? "working" : "idle") : inp !== undefined && busy && out - inp > 500 && inp > (lastResize.get(t.key) ?? 0) ? "working" : "idle";
    const cut = interruptedAt.has(t.key);
    if (cut && state === "idle") {
      interruptedAt.delete(t.key);
      endSubagents(t.key, now); // an interrupted turn sends no SubagentStop either
    }
    if (prev?.state !== state) {
      const finished = prev?.state === "working" && state === "idle" && !cut; // an interrupt isn't "finished"
      put(t.key, { state, since: now, everWorked: !!prev?.everWorked || state === "working", unseen: finished ? !watching(t.key) : state === "working" ? false : prev?.unseen });
      if (finished && now - prev.since >= 4000) notifyAgent(t.key, "Finished");
    }
  }
  for (const k of Object.keys(agentStatus)) if (!terms[k]) put(k, undefined);
  if (next) useStore.setState({ agentStatus: next });
}, 1000);

/** The user is looking at this terminal right now. */
const watching = (key: string) => document.hasFocus() && get().config.layout.activeTab === `term:${key}`;

// ---------- agent notifications ----------

const lastNotified = new Map<string, number>();

/**
 * macOS banner for an agent terminal, unless the user is already looking at it; the same event
 * goes to the status-bar list and marks the terminal unseen (Dock badge, breathing space card).
 * Finish, bell and exit often fire together, so one per terminal per 5s (10s for the bell burst).
 */
function notifyAgent(key: string, what: string) {
  const { terms, config } = get();
  const t = terms[key];
  if (!t?.agent || !config.settings.notifyAgents) return;
  if (watching(key)) return;
  const now = Date.now();
  if (now - (lastNotified.get(key) ?? 0) < (what === "Waiting Input" ? 10_000 : 5_000)) return;
  lastNotified.set(key, now);
  // Space as the title, the terminal (unique per terminal, numbered) and state as the body.
  const title = spaceOfPath(t.cwd)?.name ?? projectById(t.projectId)?.name ?? t.name;
  const body = `${t.name} : ${what}`.toLowerCase();
  if (what === "Waiting Input") phoneWake(key, title, body);
  api.notifyAgent(key, title, body).catch(() => {}); // resolves on click/clear, so never awaited
  useStore.setState((s) => ({
    notices: [{ key, title, body, at: now }, ...s.notices].slice(0, 50),
    agentStatus: { ...s.agentStatus, [key]: { ...(s.agentStatus[key] ?? { state: "idle", since: now, everWorked: true }), unseen: true } },
  }));
}

// ---------- Claude Code hooks: exact status + nested subagents ----------
// Sessions launched here run `claude --settings <ide hooks file>` (merges with the user's settings)
// with IDE_AGENT_EVENTS pointing at a per-terminal dir; the hooks drop one JSON file per event there.

const hooked = new Set<string>(); // terminals launched with our hooks
const hookActive = new Set<string>(); // ...that have produced events (then the heuristic is skipped)
const hookPolling = new Set<string>();
const hookState = new Map<string, TreeState>();

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Per-agent observation setup at spawn (plan 004): zero-touch args/env, or the opt-in repo hook file. */
async function withAgentHooks(t: Term): Promise<{ command: string | null; env: Record<string, string> | null }> {
  const plain = { command: t.command ?? null, env: null };
  const a = agentById(t.agent);
  if (!a || !t.command || a.observe === "none") return plain;
  try {
    if (a.observe === "repo" && !(await ensureRepoHooks(t, a))) return plain;
    const setup = await api.agentSetup(a.id, t.key);
    hooked.add(t.key);
    hookState.delete(t.key);
    const args = setup.args.map(shq).join(" ");
    return { command: args ? `${t.command} ${args}` : t.command, env: setup.env };
  } catch {
    return plain; // still runs; status falls back to the activity heuristic
  }
}

/** Asks once per project; then makes sure the IDE's hook file is in the repo (never replacing a foreign one). */
async function ensureRepoHooks(t: Term, a: Agent): Promise<boolean> {
  const p = projectById(t.projectId);
  if (!p) return false;
  let pref = p.agentHooks?.[a.id];
  if (!pref) {
    const ok = await ask(
      `Show ${a.label}'s subagents and status in Aira for "${p.name}"?\n\n` +
        `This creates ${a.repoFiles} in the repository. It's listed in .git/info/exclude so it's never committed, ` +
        `and it does nothing unless ${a.label} is started from Aira.` +
        (a.id === "codex" ? "\n\nCodex will ask you once to trust the hook." : ""),
      { title: `Track ${a.label}`, okLabel: "Enable", cancelLabel: "Not now" },
    );
    pref = ok ? "on" : "off";
    updateConfig((c) => {
      const x = c.projects.find((y) => y.id === p.id);
      if (x) x.agentHooks = { ...x.agentHooks, [a.id]: pref! };
    });
  }
  if (pref !== "on") return false;
  const r = await api.agentRepoHooks(a.id, t.cwd, true);
  if (r === "exists") notify(`${a.label}: ${a.repoFiles} already exists in this repo, so Aira leaves it alone; status uses terminal activity.`);
  return r === "on";
}

const interruptedAt = new Map<string, number>(); // terminals handed back to the heuristic by Ctrl+C / Esc

/** Input at a "Needs input" prompt (permission answer, reply): the agent resumes, so show Working until a hook says otherwise. */
function answered(key: string) {
  const st = get().agentStatus[key];
  if (st?.state !== "waiting" || !hookActive.has(key)) return;
  useStore.setState((s) => ({ agentStatus: { ...s.agentStatus, [key]: { ...st, state: "working", since: Date.now() } } }));
}

/**
 * Ctrl+C / Esc may interrupt the agent's turn, and agents don't send their turn-end hook then (Claude
 * Code skips `Stop` on a user interrupt), which left status stuck on Working. Not every Esc/Ctrl+C
 * interrupts (closing autocomplete, clearing typed text), so instead of forcing idle, hand status back
 * to the activity heuristic: a spinner that keeps going stays Working, a quiet terminal goes idle. The
 * next status hook (prompt/stop/waiting) switches exact status back on.
 */
function interrupted(key: string) {
  if (hookActive.delete(key)) interruptedAt.set(key, Date.now());
}

/** Marks a terminal's still-running subagents as ended (its turn was cut short). */
function endSubagents(key: string, now: number) {
  const h = hookState.get(key);
  if (!h) return;
  h.pending = [];
  for (const n of h.nodes.values()) {
    if (!n.running) continue;
    n.running = false;
    n.endedAt = now;
  }
  useStore.setState((s) => ({ subagents: { ...s.subagents, [key]: [...h.nodes.values()] } }));
}

function forgetHooks(key: string) {
  if (!hooked.delete(key)) return;
  hookActive.delete(key);
  hookState.delete(key);
  transcripts.delete(key);
  api.agentEventsClear(key).catch(() => {});
  useStore.setState((s) => {
    const { [key]: _, ...subagents } = s.subagents;
    const { [key]: __, ...usage } = s.usage;
    return { subagents, usage };
  });
}

// ---------- Claude Code usage: tokens from the session transcript ----------

// ponytail: usage hidden for now (user's call, 2026-11-10): transcripts aren't read, so no token/cost
// labels render anywhere. Flip to true to bring it back.
const SHOW_USAGE = false;
const transcripts = new Map<string, string>(); // term key → transcript_path from hook payloads

/** The transcript lags the hooks, so re-read 2s after a turn ends and again when the next one starts. */
function trackUsage(key: string, evs: AgentEvent[]) {
  if (evs.some((e) => e.kind === "prompt")) refreshUsage(key);
  if (evs.some((e) => e.kind === "stop")) setTimeout(() => refreshUsage(key), 2000);
}

async function refreshUsage(key: string) {
  const path = transcripts.get(key);
  if (!path) return;
  try {
    const rows = await api.agentUsage(path);
    useStore.setState((s) => ({ usage: { ...s.usage, [key]: rows } }));
  } catch {
    /* not written yet */
  }
}

async function pollHooks(key: string) {
  if (hookPolling.has(key)) return;
  hookPolling.add(key);
  try {
    const events = await api.agentEvents(key);
    if (events.length) applyHookEvents(key, events);
  } catch {
    /* terminal gone or dir removed */
  } finally {
    hookPolling.delete(key);
  }
}

/** Folds an agent's raw hook/plugin events (via its adapter) into the subagent tree and status. */
export function applyHookEvents(key: string, events: HookEvent[]) {
  const agent = get().terms[key]?.agent ?? "";
  const exact = !!agentById(agent)?.exactStatus; // else hooks only feed subagents; status stays heuristic
  const h = hookState.get(key) ?? emptyTree();
  hookState.set(key, h);
  const now = Date.now();
  const evs = events.flatMap((e) => normalize(agent, e as HookEvent & Record<string, unknown>));
  const main = fold(h, evs, now);
  // Exact status takes over only on a status event, so a stray tool event after an interrupt doesn't
  // pin the old Working back on.
  if (exact && main) {
    hookActive.add(key);
    interruptedAt.delete(key);
  }
  const path = events.find((e) => e.transcript_path)?.transcript_path;
  if (path) transcripts.set(key, path);
  if (SHOW_USAGE) trackUsage(key, evs);
  taps.hook(key, events);
  useStore.setState((s) => ({ subagents: { ...s.subagents, [key]: [...h.nodes.values()] } }));
  if (!main || !exact) return;
  const prev = get().agentStatus[key];
  if (prev?.state === main) return;
  const finished = main === "idle" && prev?.state === "working";
  useStore.setState((s) => ({
    agentStatus: {
      ...s.agentStatus,
      [key]: { state: main, since: now, everWorked: !!prev?.everWorked || main === "working", unseen: finished ? !watching(key) : main === "working" ? false : prev?.unseen },
    },
  }));
  if (main === "waiting") notifyAgent(key, "Waiting Input");
  else if (finished) notifyAgent(key, "Finished");
}
