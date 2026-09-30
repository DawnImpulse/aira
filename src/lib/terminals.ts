import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { api, type PtyMessage, type Script, type Settings } from "../ipc";
import { openTerminalTab, projectById, scriptCwd, uid, useStore, type AgentStatus, type Term } from "../store";

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
}

const xts = new Map<string, XT>();
let theme = DARK;
let lastSize = { cols: 120, rows: 32 };
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
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.metaKey && e.key === "k") {
      term.clear();
      return false;
    }
    return true;
  });
  const live = () => {
    const t = get().terms[key];
    return t?.sessionId && t.status === "running" ? t.sessionId : null;
  };
  term.onData((d) => {
    lastIn.set(key, Date.now());
    const id = live();
    if (id) api.ptyWrite(id, d).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    lastIn.set(key, Date.now()); // an agent's redraw after a resize is not "work"
    const id = live();
    if (id) api.ptyResize(id, cols, rows).catch(() => {});
  });
  const el = document.createElement("div");
  el.className = "xterm-host";
  const x: XT = { term, fit: fitAddon, el, opened: false, webgl: null };
  xts.set(key, x);
  return x;
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
  if (t.sessionId) x.term.write("\r\n\x1b[2m── restarted ──\x1b[0m\r\n");
  const sessionId = uid();
  setTerm(key, { sessionId, status: "running", startedAt: Date.now(), endedAt: undefined, exitCode: undefined, stopped: false });
  let unacked = 0;
  const channel = new Channel<PtyMessage>((msg) => {
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
  try {
    await api.ptySpawn({ id: sessionId, cwd: t.cwd, command: t.command ?? null, cols: x.term.cols, rows: x.term.rows, onData: channel });
  } catch (e) {
    x.term.write(`\r\n\x1b[31mFailed to start: ${e}\x1b[0m\r\n`);
    setTerm(key, { status: "exited", exitCode: -1, endedAt: Date.now() });
  }
}

function onExit(key: string, sessionId: string, code: number) {
  exitWaiters.get(sessionId)?.();
  exitWaiters.delete(sessionId);
  const t = get().terms[key];
  if (!t || t.sessionId !== sessionId) return; // stale message from an earlier run
  if (!t.scriptId && !t.command) return removeTerm(key, true); // plain shell exited (`exit`, Ctrl-D): close it like any terminal app
  const stopped = t.status === "stopping";
  xts.get(key)?.term.write(`\r\n\x1b[2m[${stopped ? "stopped" : `process exited with code ${code}`}]\x1b[0m\r\n`);
  setTerm(key, { status: "exited", exitCode: code, endedAt: Date.now(), stopped });
}

export function stop(key: string) {
  const t = get().terms[key];
  if (!t?.sessionId || t.status !== "running") return;
  setTerm(key, { status: "stopping" });
  api.ptyKill(t.sessionId).catch(() => {});
}

export async function restart(key: string) {
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
  if (t?.scriptId) return runScript(t.scriptId);
  await startSession(key);
}

/** Kills (if needed) and forgets a terminal. `closeTab` true also closes its tab. */
export function removeTerm(key: string, closeTab = false) {
  stop(key);
  const x = xts.get(key);
  x?.term.dispose();
  x?.el.remove();
  xts.delete(key);
  useStore.setState((s) => {
    const { [key]: _, ...terms } = s.terms;
    return { terms };
  });
  if (closeTab) {
    const id = `term:${key}`;
    const { tabs, activeTab } = get().config.layout;
    const i = tabs.findIndex((t) => t.id === id);
    if (i >= 0) {
      const rest = tabs.filter((t) => t.id !== id);
      useStore.setState((s) => ({
        config: {
          ...s.config,
          layout: { ...s.config.layout, tabs: rest, activeTab: activeTab === id ? ((rest[i] ?? rest[i - 1])?.id ?? null) : activeTab },
        },
      }));
    }
  }
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
  const n = Object.values(get().terms).filter((t) => t.projectId === projectId && !t.scriptId).length;
  const name = label
    ? `${p.name} · ${label}`
    : `${p.name} · ${cwd && cwd !== p.path ? cwd.slice(cwd.lastIndexOf("/") + 1) : "shell"}${n ? ` ${n + 1}` : ""}`;
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

export async function runScript(scriptId: string, activate = true) {
  ensureScriptTerm(scriptId);
  const t = get().terms[scriptId];
  if (!t) return;
  openTerminalTab(scriptId, activate);
  if (t.status !== "running" && t.status !== "stopping") await startSession(scriptId);
}

export function showScript(scriptId: string, projectId: string) {
  ensureScriptTerm(scriptId, projectId);
  openTerminalTab(scriptId);
}

/** The project's Start button: its start set (still linked), or every script when none is ticked. */
export function runStart(projectId: string) {
  const p = projectById(projectId);
  if (!p) return;
  const picked = p.startScriptIds.filter((id) => p.scriptIds.includes(id));
  (picked.length ? picked : p.scriptIds).forEach((id, i) => runScript(id, i === 0));
}

// ---------- coding-agent activity ----------

const lastOut = new Map<string, number>();
const lastIn = new Map<string, number>();

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
    const out = lastOut.get(t.key) ?? 0;
    const inp = lastIn.get(t.key);
    const state = inp !== undefined && now - out < 1500 && out - inp > 500 ? "working" : "idle";
    const prev = agentStatus[t.key];
    if (prev?.state !== state) put(t.key, { state, since: now, everWorked: !!prev?.everWorked || state === "working" });
  }
  for (const k of Object.keys(agentStatus)) if (!terms[k]) put(k, undefined);
  if (next) useStore.setState({ agentStatus: next });
}, 1000);
