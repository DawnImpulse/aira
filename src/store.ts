import { create } from "zustand";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ask, type ConfirmReq } from "./lib/dialog";
import { api, type Config, type FileEntry, type GitStatus, type PortInfo, type Project, type Repo, type Script, type Space, type SpaceView, type Tab, type TermSnapshot, type UsageRow } from "./ipc";
import { disposeModel, reloadIfClean, setEditorTheme } from "./lib/monaco";
import { attachInherited, busyTerms, confirmKill, confirmScriptClose, newTerminal, readHandoff, removeTerm, runningList, setTerminalTheme, sleepTerm, startSession, stop as stopTerm, writeHandoff } from "./lib/terminals";
import { nextIdentity } from "./lib/identity";
import { AGENTS } from "./lib/agents";
import { initPhone } from "./lib/phone";
import { checkForUpdates, scheduleUpdateChecks, type UpdateState } from "./lib/updates";

export interface Term extends TermSnapshot {
  sessionId?: string;
  status: "idle" | "running" | "stopping" | "exited";
  exitCode?: number;
  /** Exited because the user pressed Stop: shown as neutral, not as a failure. */
  stopped?: boolean;
  startedAt?: number;
  endedAt?: number;
  /** `agent` was recognised from the shell's processes (typed in by hand), not launched as one. */
  detected?: boolean;
}

export type Dialog =
  | null
  | { kind: "script"; projectId: string; scriptId?: string; preset?: Partial<Script> }
  | { kind: "link"; projectId: string }
  | { kind: "space"; projectId: string; spaceId?: string; dir?: string }
  | { kind: "project"; projectId: string }
  | { kind: "newPath"; dir: string; isDir: boolean }
  | { kind: "settings" };

/** A Claude Code subagent; parent = the spawning subagent's id, or null for the main agent. */
export interface SubAgentNode {
  id: string;
  type: string;
  description?: string;
  parent: string | null;
  running: boolean;
  startedAt: number;
  endedAt?: number;
}

/** Coding-agent activity derived from terminal output (see lib/terminals). */
export interface AgentStatus {
  /** waiting = asked for input/permission (Claude hooks only). */
  state: "working" | "idle" | "waiting";
  since: number;
  everWorked: boolean;
  /** Finished while nobody was looking: its space "breathes" until seen. */
  unseen?: boolean;
}

/** One agent event that was worth a banner (lib/terminals notifyAgent); listed in the status bar. */
export interface Notice {
  key: string;
  title: string;
  body: string;
  at: number;
}

interface State {
  ready: boolean;
  config: Config;
  terms: Record<string, Term>;
  repos: Record<string, Repo[]>; // projectId → repos
  status: Record<string, GitStatus>; // repo path → status
  agentStatus: Record<string, AgentStatus>; // term key → activity (kept out of `terms` so it never triggers saves)
  subagents: Record<string, SubAgentNode[]>; // term key → Claude subagent tree (from hooks)
  usage: Record<string, UsageRow[]>; // term key → tokens per model (from the Claude transcript)
  notices: Notice[]; // newest first, capped at 50, not persisted
  mem: { sessions: Record<string, number>; app: number; procs?: Record<string, string[]> };
  dirty: Record<string, boolean>; // file path → unsaved edits
  dialog: Dialog;
  confirm: ConfirmReq | null; // in-app OK/Cancel prompt (lib/dialog), may sit over a `dialog`
  restore: string[]; // script ids running at last quit
  ports: PortInfo[]; // listening TCP ports (lib/ports)
  toast: string | null;
  update: UpdateState | null; // the bottom-right update card (lib/updates)
  overlays: number; // open popovers/menus; the embedded browser webview hides while any are up
  popped: Record<string, true>; // browser tab id → its page is in a pop-out window (not persisted)
}

/** Exited non-zero on its own (a user Stop is not a failure). */
export const isFailed = (t?: Term) => t?.status === "exited" && t.exitCode !== 0 && !t.stopped;

const DEFAULT_CONFIG: Config = {
  projects: [],
  scripts: {},
  browserHistory: [],
  customDevices: [],
  quickDevices: ["iphone", "pixel", "ipad", "laptop", "desktop"],
  settings: {
    theme: "dark",
    uiFont: "System",
    monoFont: "SF Mono",
    fontSize: 13,
    terminalWebgl: false,
    notifyAgents: true,
    hiddenAgents: [],
    ai: { provider: "anthropic", models: {}, baseUrls: {}, keySaved: {}, acknowledged: {} },
  },
  layout: {
    tabs: [],
    activeTab: null,
    activeProjectId: null,
    terms: [],
    runningAtQuit: [],
    rightView: "files",
    activeSpaceId: null,
    leftView: "projects",
    views: {},
  },
};

export const useStore = create<State>(() => ({
  ready: false,
  config: DEFAULT_CONFIG,
  terms: {},
  repos: {},
  status: {},
  agentStatus: {},
  subagents: {},
  usage: {},
  notices: [],
  mem: { sessions: {}, app: 0 },
  dirty: {},
  dialog: null,
  confirm: null,
  restore: [],
  ports: [],
  toast: null,
  update: null,
  overlays: 0,
  popped: {},
}));

/** Floating UI (popovers, menus) bumps this so the native browser webview hides under it. */
export const setOverlay = (delta: number) => set((s) => ({ overlays: Math.max(0, s.overlays + delta) }));

const get = useStore.getState;
const set = useStore.setState;

// ---------- helpers ----------

export const uid = () => crypto.randomUUID();
export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), 1));
export const joinPath = (a: string, b: string) => (b ? `${a.replace(/\/$/, "")}/${b}` : a);
export const isUnder = (path: string, root: string) => path === root || path.startsWith(root + "/");

export function ago(ts?: number) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

let toastTimer: number | undefined;
export function notify(msg: unknown) {
  clearTimeout(toastTimer);
  set({ toast: String(msg) });
  toastTimer = window.setTimeout(() => set({ toast: null }), 7000);
}

/** A plain terminal running an agent CLI counts as that agent while it runs (status via the activity heuristic). */
function detectAgents(procs: Record<string, string[]>) {
  const terms = get().terms;
  const patch: Record<string, Term> = {};
  for (const t of Object.values(terms)) {
    if (t.scriptId || (t.agent && !t.detected) || !t.sessionId) continue;
    const names = procs[t.sessionId] ?? [];
    const agent = AGENTS.find((a) => names.includes(a.bin))?.id;
    if (agent !== t.agent) patch[t.key] = { ...t, agent, detected: agent ? true : undefined };
  }
  if (Object.keys(patch).length) set({ terms: { ...terms, ...patch } });
}

export function updateConfig(fn: (c: Config) => void) {
  const c = structuredClone(get().config);
  fn(c);
  set({ config: c });
}

/** Side panel handles, registered by App; menu toggles act on the real (possibly drag-collapsed) state. */
export const panelApi: { left: PanelImperativeHandle | null; right: PanelImperativeHandle | null } = { left: null, right: null };
export const togglePanel = (p: PanelImperativeHandle | null) => (p?.isCollapsed() ? p.expand() : p?.collapse());

export const projectById = (id: string | null | undefined) => get().config.projects.find((p) => p.id === id);
export const activeProject = () => projectById(get().config.layout.activeProjectId);
/** Innermost project containing `path`. */
export const projectOf = (path: string) =>
  get().config.projects.filter((p) => isUnder(path, p.path)).sort((a, b) => b.path.length - a.path.length)[0];
export const allRepos = () => Object.values(get().repos).flat();

export const primarySpace = (p: Project) => p.spaces.find((s) => s.dir === p.path) ?? p.spaces[0];
/** A project's scripts get a window (main tabs + right panel) of their own, beside its spaces' windows. */
export const scriptsWindow = (projectId: string) => `scripts:${projectId}`;
const projectOfWindow = (c: Config, win: string | null | undefined) =>
  c.projects.find((p) => win === scriptsWindow(p.id) || p.spaces.some((s) => s.id === win));
/** Selected space of the active project (falls back to its primary space). */
export function activeSpace(): Space | undefined {
  const p = activeProject();
  return p && (p.spaces.find((s) => s.id === get().config.layout.activeSpaceId) ?? primarySpace(p));
}
/** Selector version for components (returns an object already in state, so it's render-stable). */
export const selectActiveSpace = (s: State) => {
  const p = s.config.projects.find((x) => x.id === s.config.layout.activeProjectId);
  return p && (p.spaces.find((x) => x.id === s.config.layout.activeSpaceId) ?? primarySpace(p));
};
/** Innermost space (any project) containing `path`. */
export const spaceOfPath = (path: string) =>
  get()
    .config.projects.flatMap((p) => p.spaces)
    .filter((s) => isUnder(path, s.dir))
    .sort((a, b) => b.dir.length - a.dir.length)[0];

/** Repos the Git tab lists: every repo found in the project, minus linked worktrees that aren't spaces. */
export const gitReposOf = (p: Project, repos: Repo[] = []) => repos.filter((r) => r.kind !== "worktree" || p.spaces.some((s) => s.dir === r.path));
/** A space's git: the innermost repo holding its folder (its own, when the folder is a repo), then the repos inside
 * the folder. Never a repo above that one: a space with its own .git does not show the project's. */
export function spaceReposOf(p: Project, space: Space, repos?: Repo[]) {
  const all = gitReposOf(p, repos);
  const own = all.filter((r) => isUnder(space.dir, r.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const inside = all.filter((r) => r !== own && isUnder(r.path, space.dir)).sort((a, b) => a.path.localeCompare(b.path));
  return own ? [own, ...inside] : inside;
}

/** Changes that fall inside a space dir; a subfolder space also counts a collapsed untracked parent (`packages/`). */
export function spaceChanges(dir: string, repoPath: string, st?: GitStatus) {
  if (!st) return undefined;
  if (dir === repoPath) return st.files;
  const rel = dir.slice(repoPath.length + 1);
  return st.files.filter((f) => {
    const p = f.path.replace(/\/$/, "");
    return isUnder(p, rel) || (f.path.endsWith("/") && isUnder(rel, p));
  });
}

/** Innermost known repo containing `path`. */
export function repoOf(path: string): Repo | undefined {
  return allRepos()
    .filter((r) => isUnder(path, r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Repo-relative paths of repos nested inside `repo` (hidden from its status, never staged as gitlinks). */
export const excludesFor = (repo: string) =>
  allRepos()
    .filter((r) => r.path.startsWith(repo + "/"))
    .map((r) => r.path.slice(repo.length + 1));

// ---------- persistence ----------

function migrateAi(raw: unknown): Config["settings"]["ai"] {
  const a = (raw ?? {}) as Partial<Config["settings"]["ai"]> & { model?: string };
  const ai = { provider: a.provider ?? "anthropic", models: { ...a.models }, baseUrls: { ...a.baseUrls }, keySaved: { ...a.keySaved }, acknowledged: { ...a.acknowledged } };
  if (a.model && !ai.models[ai.provider]) ai.models[ai.provider] = a.model; // pre-002 {provider, model}
  return ai;
}

function normalize(raw: Partial<Config> | null): Config {
  const d = DEFAULT_CONFIG;
  const c: Config = {
    projects: raw?.projects ?? [],
    scripts: raw?.scripts ?? {},
    browserHistory: (raw?.browserHistory ?? []).slice(0, 100),
    customDevices: raw?.customDevices ?? [],
    quickDevices: raw?.quickDevices ?? d.quickDevices,
    settings: { ...d.settings, ...raw?.settings, ai: migrateAi(raw?.settings?.ai) },
    layout: { ...d.layout, ...raw?.layout },
  };
  for (const p of c.projects) {
    p.scriptIds = (p.scriptIds ?? []).filter((id) => c.scripts[id]); // drop dangling links
    p.startScriptIds = (p.startScriptIds ?? []).filter((id) => p.scriptIds.includes(id));
    delete (p as { extraRepos?: unknown }).extraRepos;
    // Pre-spaces configs: the project root becomes the primary space. Dedupe by dir.
    const dirs = new Set<string>();
    p.spaces = (p.spaces ?? []).filter((s) => s.dir && !dirs.has(s.dir) && dirs.add(s.dir));
    if (!p.spaces.some((s) => s.dir === p.path)) p.spaces.unshift({ id: uid(), name: p.name, dir: p.path });
    // 003: spaces have no icon/color of their own; project icons became typed.
    for (const s of p.spaces as (Space & { icon?: unknown; color?: unknown })[]) {
      delete s.icon;
      delete s.color;
    }
    if (typeof p.icon === "string") p.icon = { type: "symbol", value: p.icon };
    if (!p.color || !p.icon) {
      const next = nextIdentity(c.projects); // older projects get distinct defaults too
      p.color ??= next.color;
      p.icon ??= next.icon;
    }
  }
  c.layout.terms = c.layout.terms.filter((t) => !t.scriptId || c.scripts[t.scriptId]);
  const termKeys = new Set(c.layout.terms.map((t) => t.key));
  if (!c.projects.some((p) => p.id === c.layout.activeProjectId)) c.layout.activeProjectId = c.projects[0]?.id ?? null;
  // The open tabs belong to the active space (pre-007 configs: every tab lands in it).
  const active = c.projects.find((p) => p.id === c.layout.activeProjectId);
  if (projectOfWindow(c, c.layout.activeSpaceId) !== active) c.layout.activeSpaceId = (active && primarySpace(active)?.id) ?? null;
  c.layout.views = { ...c.layout.views };
  for (const id of Object.keys(c.layout.views)) if (!projectOfWindow(c, id) || id === c.layout.activeSpaceId) delete c.layout.views[id];
  // Script tabs only live in scripts windows (pre-008 configs had them in space windows).
  const scriptKeys = new Set(c.layout.terms.filter((t) => t.scriptId).map((t) => t.key));
  for (const [id, v] of [[c.layout.activeSpaceId, c.layout] as const, ...Object.entries(c.layout.views)]) {
    const scriptsOk = !!id?.startsWith("scripts:");
    v.tabs = v.tabs.filter((t) => t.kind !== "terminal" || (termKeys.has(t.key) && (scriptsOk || !scriptKeys.has(t.key))));
    if (!v.tabs.some((t) => t.id === v.activeTab)) v.activeTab = v.tabs[0]?.id ?? null;
  }
  return c;
}

let saveTimer: number | undefined;
let badge = 0; // Dock badge count last sent
export async function saveNow() {
  clearTimeout(saveTimer);
  const { config, terms } = get();
  const tabs = [config.layout, ...Object.values(config.layout.views)].flatMap((v) => v.tabs);
  const tabKeys = new Set(tabs.flatMap((t) => (t.kind === "terminal" ? [t.key] : [])));
  const snaps: TermSnapshot[] = Object.values(terms)
    .filter((t) => tabKeys.has(t.key))
    .map(({ key, name, projectId, scriptId, cwd, command, renamed, agent, detected }) => ({ key, name, projectId, scriptId, cwd, command, renamed, agent: detected ? undefined : agent }));
  await api.saveConfig({ ...config, layout: { ...config.layout, terms: snaps } }).catch((e) => notify(`Saving config failed: ${e}`));
}

// ---------- settings ----------

const media = window.matchMedia("(prefers-color-scheme: dark)");
export const uiStack = (f: string) =>
  f === "System" ? `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif` : `"${f}", -apple-system, sans-serif`;

export function applySettings() {
  const s = get().config.settings;
  const dark = s.theme === "system" ? media.matches : s.theme === "dark";
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--font-ui", uiStack(s.uiFont));
  root.style.setProperty("--font-mono", `"${s.monoFont}", "SF Mono", Menlo, monospace`);
  setEditorTheme(dark, s);
  setTerminalTheme(dark, s);
  getCurrentWindow().setTheme(dark ? "dark" : "light").catch(() => {});
}

// ---------- projects ----------

/**
 * Selects a space; each space keeps its own main tabs and right panel view.
 * The active space's view lives in layout.tabs/activeTab/rightView, the others wait in layout.views.
 */
function showSpace(c: Config, projectId: string | null, spaceId: string | null) {
  const l = c.layout;
  if (l.activeSpaceId !== spaceId) {
    const stillThere = !!projectOfWindow(c, l.activeSpaceId);
    if (l.activeSpaceId && stillThere) l.views[l.activeSpaceId] = { tabs: l.tabs, activeTab: l.activeTab, rightView: l.rightView };
    const v: SpaceView = (spaceId && l.views[spaceId]) || { tabs: [], activeTab: null, rightView: "files" };
    if (spaceId) delete l.views[spaceId];
    Object.assign(l, v);
  }
  l.activeProjectId = projectId;
  l.activeSpaceId = spaceId;
}

/** Removes a tab from a view; its neighbour becomes active. */
export function dropTab(v: SpaceView, id: string) {
  const i = v.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  v.tabs.splice(i, 1);
  if (v.activeTab === id) v.activeTab = (v.tabs[i] ?? v.tabs[i - 1])?.id ?? null;
}

/** Folder picker that opens inside `dir`. */
export async function pickFolder(dir: string, title: string) {
  // ponytail: macOS shows a folder given as the start path selected in its parent; starting at a
  // file inside it lands in it. A folder holding only subfolders still gets the old behaviour.
  const file = (await api.readDir(dir).catch(() => [])).find((e) => !e.dir && !e.name.startsWith("."));
  const picked = await openDialog({ directory: true, defaultPath: file?.path ?? dir, title }).catch((e) => void notify(e));
  return typeof picked === "string" ? picked : null;
}

export async function openFolders() {
  const sel = await openDialog({ directory: true, multiple: true, title: "Open Folder(s) as Projects" }).catch((e) => {
    notify(`Could not open folder picker: ${e}`);
    return null;
  });
  for (const path of sel == null ? [] : Array.isArray(sel) ? sel : [sel]) addProject(path);
}

export function addProject(path: string) {
  const existing = get().config.projects.find((p) => p.path === path);
  if (existing) return setActiveProject(existing.id);
  const id = uid();
  updateConfig((c) => {
    const name = basename(path);
    const primary = { id: uid(), name, dir: path };
    const { color, icon } = nextIdentity(c.projects); // distinct from existing projects
    c.projects.push({ id, name, path, color, icon, scriptIds: [], startScriptIds: [], spaces: [primary] });
    showSpace(c, id, primary.id);
  });
  discover(id);
}

export async function removeProject(id: string) {
  const p = projectById(id);
  if (!p) return;
  // Its shells/agents and the scripts it owns go with it; scripts owned by other projects keep running.
  const { terms, config } = get();
  const doomed = Object.values(terms)
    .filter((t) => (t.scriptId ? config.scripts[t.scriptId]?.ownerProjectId === id : t.projectId === id))
    .map((t) => t.key);
  const busy = await busyTerms(doomed);
  const msg = `Remove "${p.name}" from the workspace? Files on disk are not touched.` + (busy.length ? `\n\nStill running, will be force closed:\n${runningList(busy)}` : "");
  if (!(await ask(msg, { title: "Remove project", kind: "warning", okLabel: busy.length ? "Force close & remove" : "Remove" }))) return;
  doomed.forEach((k) => removeTerm(k, true));
  updateConfig((c) => {
    c.projects = c.projects.filter((x) => x.id !== id);
    for (const [sid, s] of Object.entries(c.scripts)) if (s.ownerProjectId === id) delete c.scripts[sid];
    for (const x of c.projects) x.scriptIds = x.scriptIds.filter((s) => c.scripts[s]);
    for (const s of p.spaces) delete c.layout.views[s.id];
    delete c.layout.views[scriptsWindow(id)];
    const next = c.projects[0];
    if (c.layout.activeProjectId === id) showSpace(c, next?.id ?? null, (next && primarySpace(next)?.id) ?? null);
  });
  set((s) => {
    const { [id]: _, ...repos } = s.repos;
    return { repos };
  });
  syncWatch();
}

/** Selects a space (default: keep the project's current one, else its primary). */
export function setActiveSpace(projectId: string, spaceId?: string) {
  const p = projectById(projectId);
  if (!p) return;
  const l = get().config.layout;
  const sid = spaceId ?? (l.activeProjectId === projectId && p.spaces.some((s) => s.id === l.activeSpaceId) ? l.activeSpaceId : primarySpace(p)?.id) ?? null;
  // Selecting a space counts as seeing its finished agents.
  const target = p.spaces.find((s) => s.id === sid);
  if (target?.asleep) wakeSpace(projectId, target.id);
  const dir = target?.dir;
  if (dir) markSeen(Object.values(get().terms).filter((t) => t.agent && spaceOfPath(t.cwd)?.dir === dir).map((t) => t.key));
  if (l.activeProjectId === projectId && l.activeSpaceId === sid) return;
  updateConfig((c) => showSpace(c, projectId, sid));
}
export const setActiveProject = (id: string) => setActiveSpace(id);

/** Looking at a terminal tab (any way it became active, or the window coming back) counts as seeing it. */
function seeActiveTerm() {
  const id = get().config.layout.activeTab;
  if (id?.startsWith("term:")) markSeen([id.slice(5)]);
}

/** Clears the "finished, not yet seen" flag for these agent terminals. */
export function markSeen(keys: string[]) {
  const { agentStatus } = get();
  const hit = keys.filter((k) => agentStatus[k]?.unseen);
  if (!hit.length) return;
  set((s) => {
    const next = { ...s.agentStatus };
    for (const k of hit) next[k] = { ...next[k], unseen: false };
    return { agentStatus: next };
  });
}

/** Name/icon/color; an empty name falls back to the folder name. */
export const updateProject = (id: string, patch: Partial<Pick<Project, "name" | "icon" | "color" | "scriptsCollapsed">>) =>
  updateConfig((c) => {
    const p = c.projects.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch);
    p.name = p.name.trim() || basename(p.path);
  });

export function addSpace(projectId: string, space: Omit<Space, "id">) {
  const p = projectById(projectId);
  if (!p) return;
  const existing = p.spaces.find((s) => s.dir === space.dir);
  if (existing) return setActiveSpace(projectId, existing.id);
  const id = uid();
  updateConfig((c) => {
    c.projects.find((x) => x.id === projectId)?.spaces.push({ ...space, id, name: space.name.trim() || basename(space.dir) });
    showSpace(c, projectId, id);
  });
  discover(projectId); // also re-syncs the watcher (spaces outside the project get watched)
}

export function updateSpace(projectId: string, spaceId: string, patch: Partial<Omit<Space, "id">>) {
  updateConfig((c) => {
    const s = c.projects.find((x) => x.id === projectId)?.spaces.find((x) => x.id === spaceId);
    if (!s) return;
    Object.assign(s, patch);
    s.name = s.name.trim() || basename(s.dir);
  });
  if (patch.dir) discover(projectId);
}

export async function removeSpace(projectId: string, spaceId: string) {
  const p = projectById(projectId);
  const s = p?.spaces.find((x) => x.id === spaceId);
  if (!p || !s || s.dir === p.path) return; // the primary space can't be removed
  // Shells/agents in its window go with it (scripts keep running; reopen from the sidebar).
  const doomed = spaceShells(spaceId);
  const busy = await busyTerms(doomed);
  const msg = `Remove space "${s.name}"? Its folder stays on disk.` + (busy.length ? `\n\nStill running, will be force closed:\n${runningList(busy)}` : "");
  if (!(await ask(msg, { title: "Remove space", kind: "warning", okLabel: busy.length ? "Force close & remove" : "Remove" }))) return;
  doomed.forEach((k) => removeTerm(k, true));
  updateConfig((c) => {
    const x = c.projects.find((y) => y.id === projectId);
    if (!x) return;
    x.spaces = x.spaces.filter((y) => y.id !== spaceId);
    delete c.layout.views[spaceId];
    if (c.layout.activeSpaceId === spaceId) showSpace(c, projectId, primarySpace(x)?.id ?? null);
  });
  discover(projectId);
}

/** A space's tabs: the live layout when it's the active one, else its parked view. */
const spaceTabs = (spaceId: string) => {
  const l = get().config.layout;
  return (l.activeSpaceId === spaceId ? l : l.views[spaceId])?.tabs ?? [];
};
/** Its shell/agent terminals (scripts are the project's, not the space's). */
const spaceShells = (spaceId: string) => spaceTabs(spaceId).flatMap((t) => (t.kind === "terminal" && !get().terms[t.key]?.scriptId ? [t.key] : []));

const setAsleep = (projectId: string, spaceId: string, asleep: boolean) =>
  updateConfig((c) => {
    const s = c.projects.find((x) => x.id === projectId)?.spaces.find((x) => x.id === spaceId);
    if (s) s.asleep = asleep;
  });

/** Frees a space's CPU/RAM: stops its shells/agents and closes its browser pages; tabs stay for waking. */
export async function sleepSpace(projectId: string, spaceId: string) {
  const s = projectById(projectId)?.spaces.find((x) => x.id === spaceId);
  if (!s || s.asleep) return;
  const keys = spaceShells(spaceId);
  const busy = await busyTerms(keys);
  if (busy.length && !(await ask(`Put "${s.name}" to sleep?\n\nStill running, will be stopped:\n${runningList(busy)}`, { title: "Sleep space", kind: "warning", okLabel: "Stop & sleep" }))) return;
  keys.forEach(sleepTerm);
  for (const t of spaceTabs(spaceId)) if (t.kind === "browser") api.browserClose(t.id).catch(() => {});
  setAsleep(projectId, spaceId, true);
}

/** Starts its terminals again; browser pages reopen when their tab is shown. */
export function wakeSpace(projectId: string, spaceId: string) {
  setAsleep(projectId, spaceId, false);
  spaceShells(spaceId).forEach((k) => startSession(k));
}

export const toggleStar = (projectId: string, spaceId: string) =>
  updateConfig((c) => {
    const s = c.projects.find((x) => x.id === projectId)?.spaces.find((x) => x.id === spaceId);
    if (s) s.starred = !s.starred;
  });

export const toggleStartScript = (projectId: string, scriptId: string) =>
  updateConfig((c) => {
    const p = c.projects.find((x) => x.id === projectId);
    if (!p) return;
    p.startScriptIds = p.startScriptIds.includes(scriptId) ? p.startScriptIds.filter((x) => x !== scriptId) : [...p.startScriptIds, scriptId];
  });

export const toggleCollapsed = (id: string) =>
  updateConfig((c) => {
    const p = c.projects.find((x) => x.id === id);
    if (p) p.collapsed = !p.collapsed;
  });

// ---------- git ----------

export async function discover(projectId: string) {
  const p = projectById(projectId);
  if (!p) return;
  // Every repo inside the project (WebStorm-style roots) plus repos behind spaces outside it.
  // All kinds are kept (worktrees too): excludesFor/repoOf/fs routing depend on the full list.
  const outside = p.spaces.filter((s) => !isUnder(s.dir, p.path)).map((s) => s.dir);
  const found = await Promise.all([p.path, ...outside].map((root) => api.discover(root, []).catch(() => [] as Repo[])));
  const repos: Repo[] = [];
  for (const r of found.flat()) if (!repos.some((x) => x.path === r.path)) repos.push(r);
  set((s) => ({ repos: { ...s.repos, [projectId]: repos } }));
  repos.forEach((r) => refreshStatus(r.path));
  syncWatch();
}

const inflight = new Set<string>();
const again = new Set<string>();
/** Single-flight per repo with one trailing rerun: bursts of fs events cost at most two `git status`. */
export async function refreshStatus(repo: string) {
  if (inflight.has(repo)) return void again.add(repo);
  inflight.add(repo);
  try {
    const st = await api.status(repo, excludesFor(repo));
    set((s) => ({ status: { ...s.status, [repo]: st } }));
  } catch {
    set((s) => {
      const { [repo]: _, ...status } = s.status;
      return { status };
    });
  } finally {
    inflight.delete(repo);
    if (again.delete(repo)) refreshStatus(repo);
  }
}

/** Watch project roots, spaces outside them, and only the `.git` of repos enclosing such a space (never e.g. all of $HOME). */
function syncWatch() {
  const { projects } = get().config;
  const roots = projects.map((p) => p.path);
  const paths = new Set(roots);
  for (const s of projects.flatMap((p) => p.spaces)) {
    if (roots.some((r) => isUnder(s.dir, r))) continue;
    paths.add(s.dir);
    const repo = repoOf(s.dir);
    if (repo && repo.path !== s.dir && !isUnder(repo.path, s.dir)) paths.add(`${repo.path}/.git`);
  }
  api.watchSet([...paths]).catch(notify);
}

const fsListeners = new Set<(paths: string[]) => void>();
export function onFsChange(cb: (paths: string[]) => void) {
  fsListeners.add(cb);
  return () => void fsListeners.delete(cb);
}

function handleFsChange(paths: string[]) {
  const repos = allRepos();
  const hit = new Set<string>();
  const rediscover = new Set<string>();
  for (const p of paths) {
    const gi = p.indexOf("/.git/");
    if (gi >= 0) {
      // HEAD/index/refs moved: refresh the repo and its worktrees (their gitdirs live in here too).
      const r = p.slice(0, gi);
      if (repos.some((x) => x.path === r)) {
        hit.add(r);
        repos.filter((x) => x.parent === r).forEach((x) => hit.add(x.path));
      } else {
        // A repo appeared (`git init` / clone in a shell or by an agent): rediscover the projects it touches.
        // ponytail: a repo find_repos can't see (deeper than 4 levels, under a SKIP_DIRS name) rediscovers on every git op; pass it as `extra` to git_discover if that ever matters.
        for (const pr of get().config.projects)
          if (isUnder(r, pr.path) || pr.spaces.some((s) => isUnder(r, s.dir) || isUnder(s.dir, r))) rediscover.add(pr.id);
      }
    } else {
      const r = repoOf(p);
      if (r) hit.add(r.path);
      reloadIfClean(p);
    }
  }
  hit.forEach(refreshStatus);
  rediscover.forEach(discover);
  fsListeners.forEach((cb) => cb(paths));
}

/** Single-letter status for a file entry, as shown in trees and lists. */
export function statusLetter(f: FileEntry, staged: boolean) {
  if (f.conflict) return "!";
  if (f.x === "?") return "U";
  return staged ? f.x : f.y;
}

// ---------- tabs ----------

function insertTab(c: Config, tab: Tab) {
  const i = c.layout.tabs.findIndex((t) => t.id === c.layout.activeTab);
  c.layout.tabs.splice(i < 0 ? c.layout.tabs.length : i + 1, 0, tab);
}

export const activateTab = (id: string) => updateConfig((c) => void (c.layout.activeTab = id));

/** `win`: the window it belongs in (a project's scripts window), unless it's already open in the current one. */
export function openTerminalTab(key: string, activate = true, win?: string) {
  const id = `term:${key}`;
  updateConfig((c) => {
    const l = c.layout;
    const p = projectOfWindow(c, win);
    if (p && win !== l.activeSpaceId && !l.tabs.some((t) => t.id === id)) {
      if (activate) showSpace(c, p.id, win!);
      else {
        const v = (l.views[win!] ??= { tabs: [], activeTab: null, rightView: "files" });
        if (!v.tabs.some((t) => t.id === id)) v.tabs.push({ id, kind: "terminal", key });
        v.activeTab ??= id;
        return;
      }
    }
    if (!c.layout.tabs.some((t) => t.id === id)) insertTab(c, { id, kind: "terminal", key });
    if (activate) c.layout.activeTab = id;
  });
}

const termWindow = (t?: Term) => (t?.scriptId ? scriptsWindow(t.projectId) : spaceOfPath(t?.cwd ?? "")?.id);

/** Goes to the space whose view holds this terminal's tab (else the space of its folder) and shows it. */
export function focusTerminal(key: string) {
  const id = `term:${key}`;
  const l = get().config.layout;
  const sid = l.tabs.some((t) => t.id === id)
    ? l.activeSpaceId
    : (Object.keys(l.views).find((s) => l.views[s].tabs.some((t) => t.id === id)) ?? termWindow(get().terms[key]));
  const p = projectOfWindow(get().config, sid);
  if (p && sid) setActiveSpace(p.id, sid);
  openTerminalTab(key);
}

/** Single click opens a reusable preview tab; `pinned` (double click / edit) keeps it. */
export function openFile(path: string, pinned = false) {
  const id = `file:${path}`;
  let replaced: string | null = null;
  updateConfig((c) => {
    const tabs = c.layout.tabs;
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      if (pinned && existing.kind === "file") existing.pinned = true;
    } else {
      const tab: Tab = { id, kind: "file", path, pinned };
      const preview = tabs.findIndex((t) => t.kind === "file" && !t.pinned && !get().dirty[t.path]);
      if (!pinned && preview >= 0) {
        replaced = (tabs[preview] as { path: string }).path;
        tabs[preview] = tab;
      } else insertTab(c, tab);
    }
    c.layout.activeTab = id;
  });
  if (replaced) disposeModel(replaced);
}

/** Moves tab `fromId` to `toId`'s position (drag to reorder). */
export function moveTab(fromId: string, toId: string) {
  updateConfig((c) => {
    const t = c.layout.tabs;
    const i = t.findIndex((x) => x.id === fromId);
    const j = t.findIndex((x) => x.id === toId);
    if (i < 0 || j < 0 || i === j) return;
    const [tab] = t.splice(i, 1);
    t.splice(j, 0, tab);
  });
}

export function pinTab(id: string) {
  updateConfig((c) => {
    const t = c.layout.tabs.find((x) => x.id === id);
    if (t?.kind === "file") t.pinned = true;
  });
}

/** Tracks the browser tab's current URL (for its title and session restore). */
export function setBrowserUrl(id: string, url: string) {
  updateConfig((c) => {
    const t = c.layout.tabs.find((x) => x.id === id);
    if (t?.kind === "browser") t.url = url;
  });
}

/** Moves a browser tab's page into its own window. */
export async function popOutBrowser(id: string, url: string, zoom: number, devices: string[] = [], sync = false) {
  set((s) => ({ popped: { ...s.popped, [id]: true } }));
  try {
    await api.browserPopout(id, url, zoom, document.documentElement.dataset.theme ?? "dark", devices, sync);
  } catch (e) {
    set((s) => ({ popped: omit(s.popped, id) }));
    notify(`Pop out failed: ${e}`);
  }
}
const omit = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

/** Device-view settings of a browser tab. */
export function patchBrowserTab(id: string, patch: { deviceView?: boolean; devices?: string[]; sync?: boolean }) {
  updateConfig((c) => {
    const t = c.layout.tabs.find((x) => x.id === id);
    if (t?.kind === "browser") Object.assign(t, patch);
  });
}

/** Running agent terminals in the active space (targets for "Send to agent"). */
export function spaceAgents(): Term[] {
  const space = activeSpace();
  return Object.values(get().terms).filter((t) => t.agent && t.sessionId && t.status === "running" && space && spaceOfPath(t.cwd)?.id === space.id);
}

/** Records a visited page in the browser's new-tab history (newest first, deduped, capped). */
export function recordBrowserHistory(url: string) {
  if (!/^https?:/i.test(url)) return;
  updateConfig((c) => {
    const old = c.browserHistory?.find((h) => h.url === url);
    c.browserHistory = [{ url, ts: Date.now(), title: old?.title }, ...(c.browserHistory ?? []).filter((h) => h.url !== url)].slice(0, 100);
  });
}

/** Custom name for a Recent entry (empty clears it). */
export function renameHistory(url: string, title: string) {
  updateConfig((c) => {
    const h = c.browserHistory.find((x) => x.url === url);
    if (h) h.title = title.trim() || undefined;
  });
}
export function removeHistory(url: string) {
  updateConfig((c) => void (c.browserHistory = c.browserHistory.filter((h) => h.url !== url)));
}

/** Saves a custom device size ("WxH") for every tab's device view. */
export function addCustomDevice(key: string) {
  updateConfig((c) => void (c.customDevices.includes(key) || c.customDevices.push(key)));
}

/** Adds a device to the device view's quick bar, or takes it off. */
export function toggleQuickDevice(key: string) {
  updateConfig((c) => void (c.quickDevices = c.quickDevices.includes(key) ? c.quickDevices.filter((k) => k !== key) : [...c.quickDevices, key]));
}

/** Deletes a saved custom size and drops it from the quick bar and every browser tab showing it. */
export function removeCustomDevice(key: string) {
  updateConfig((c) => {
    c.customDevices = c.customDevices.filter((k) => k !== key);
    c.quickDevices = c.quickDevices.filter((k) => k !== key);
    for (const t of [...c.layout.tabs, ...Object.values(c.layout.views).flatMap((v) => v.tabs)]) {
      if (t.kind === "browser" && t.devices?.includes(key)) t.devices = t.devices.filter((k) => k !== key);
    }
  });
}

function findSpace(c: Config, spaceId: string) {
  return c.projects.flatMap((p) => p.spaces).find((s) => s.id === spaceId);
}

/** Per-workspace pinned quick links on the browser new-tab page. */
export function addPin(spaceId: string, url: string, title?: string) {
  updateConfig((c) => {
    const s = findSpace(c, spaceId);
    if (!s) return;
    s.pins ??= [];
    if (!s.pins.some((p) => p.url === url)) s.pins.push({ url, title });
  });
}
export function renamePin(spaceId: string, url: string, title: string) {
  updateConfig((c) => {
    const p = findSpace(c, spaceId)?.pins?.find((x) => x.url === url);
    if (p) p.title = title.trim() || undefined;
  });
}
export function removePin(spaceId: string, url: string) {
  updateConfig((c) => {
    const s = findSpace(c, spaceId);
    if (s?.pins) s.pins = s.pins.filter((p) => p.url !== url);
  });
}

/** Hide or unhide a detected dev server (by port) on this workspace's new-tab page. */
export function setServerHidden(spaceId: string, port: number, hidden: boolean) {
  updateConfig((c) => {
    const s = findSpace(c, spaceId);
    if (!s) return;
    const rest = (s.hiddenServers ?? []).filter((p) => p !== port);
    s.hiddenServers = hidden ? [...rest, port] : rest;
  });
}

/** Custom name for a detected dev server on `port` (empty clears it, back to the script default). */
export function renameServer(spaceId: string, port: number, name: string) {
  updateConfig((c) => {
    const s = findSpace(c, spaceId);
    if (!s) return;
    s.serverNames ??= {};
    const v = name.trim();
    if (v) s.serverNames[String(port)] = v;
    else delete s.serverNames[String(port)];
  });
}

/** Opens (or reuses) the launcher tab: a full page with all "new…" options. */
export function openLauncherTab() {
  updateConfig((c) => {
    const existing = c.layout.tabs.find((t) => t.kind === "launcher");
    if (existing) {
      c.layout.activeTab = existing.id;
      return;
    }
    const id = `launcher:${crypto.randomUUID().slice(0, 8)}`;
    insertTab(c, { id, kind: "launcher" });
    c.layout.activeTab = id;
  });
}

/** Opens a new embedded-browser tab. Starts on the new-tab page (workspace servers, pins, history);
 * the native webview is created by BrowserView once a page is opened. */
export function openBrowserTab(url = "about:blank") {
  const id = `browser:${crypto.randomUUID().slice(0, 8)}`;
  updateConfig((c) => {
    insertTab(c, { id, kind: "browser", url });
    c.layout.activeTab = id;
  });
}

/** Diffs share one tab slot, like a preview. */
/** `head`: HEAD ↔ working tree (commit panel); otherwise HEAD ↔ index (staged) or index ↔ working tree. */
export function openDiff(repo: string, f: FileEntry, staged: boolean, head = false) {
  const tab: Tab = { id: `diff:${head ? "h" : staged ? "s" : "w"}:${repo}:${f.path}`, kind: "diff", repo, path: f.path, orig: f.orig, staged, head };
  updateConfig((c) => {
    const i = c.layout.tabs.findIndex((t) => t.kind === "diff");
    if (i >= 0) c.layout.tabs[i] = tab;
    else insertTab(c, tab);
    c.layout.activeTab = tab.id;
  });
}

export async function closeTab(id: string | null) {
  const tab = get().config.layout.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.kind === "file") {
    if (get().dirty[tab.path] && !(await ask(`Discard unsaved changes to ${basename(tab.path)}?`, { kind: "warning", okLabel: "Discard" }))) return;
    disposeModel(tab.path);
  }
  // The embedded browser webview is destroyed with its tab.
  if (tab.kind === "browser") api.browserClose(tab.id).catch(() => {});
  // Shells die with their tab; a script can keep running in the background (reopen from the sidebar).
  if (tab.kind === "terminal") {
    if (get().terms[tab.key]?.scriptId) {
      const choice = await confirmScriptClose(tab.key);
      if (choice === "cancel") return;
      if (choice === "stop") stopTerm(tab.key);
    } else {
      if (!(await confirmKill([tab.key], "Close terminal"))) return;
      return removeTerm(tab.key, true);
    }
  }
  updateConfig((c) => dropTab(c.layout, tab.id));
}

// ---------- scripts (config side; running lives in lib/terminals) ----------

/** Saves the script and makes it appear in exactly `projectIds` (one shared script/process across them). */
export function saveScript(projectIds: string[], script: Script) {
  updateConfig((c) => {
    c.scripts[script.id] = { lastRunAt: c.scripts[script.id]?.lastRunAt, ...script };
    for (const p of c.projects) {
      const want = projectIds.includes(p.id);
      const has = p.scriptIds.includes(script.id);
      if (want && !has) p.scriptIds.push(script.id);
      if (!want && has) p.scriptIds = p.scriptIds.filter((x) => x !== script.id);
    }
  });
}

export function linkScript(projectId: string, scriptId: string) {
  updateConfig((c) => {
    const p = c.projects.find((x) => x.id === projectId);
    if (p && !p.scriptIds.includes(scriptId)) p.scriptIds.push(scriptId);
  });
}

/** Unlink from this project; delete entirely when this project owns it (or it's external and unused elsewhere). */
export async function removeScript(projectId: string, scriptId: string) {
  const s = get().config.scripts[scriptId];
  if (!s) return;
  const owned = s.ownerProjectId === projectId;
  const usedElsewhere = get().config.projects.some((p) => p.id !== projectId && p.scriptIds.includes(scriptId));
  const deleting = owned || !usedElsewhere;
  if (deleting && !(await ask(`Delete script "${s.name}"${owned && usedElsewhere ? " (also linked from other projects)" : ""}?`, { kind: "warning", okLabel: "Delete" }))) return;
  updateConfig((c) => {
    for (const p of c.projects) if (deleting || p.id === projectId) p.scriptIds = p.scriptIds.filter((x) => x !== scriptId);
    if (deleting) delete c.scripts[scriptId];
  });
}

export function scriptCwd(s: Script) {
  if (s.ownerProjectId === null) return s.cwd;
  const p = projectById(s.ownerProjectId);
  return p ? joinPath(p.path, s.cwd) : s.cwd;
}

// ---------- boot / app events ----------

let quitting = false;
/** Confirms busy terminals / unsaved files, saves state, then `then` ends the process (quit, or relaunch after an update). */
export async function quitApp(then: () => Promise<unknown> = api.quit) {
  if (quitting) return;
  quitting = true;
  try {
    const running = Object.values(get().terms).filter((t) => t.status === "running" || t.status === "stopping");
    const busy = await busyTerms(running.map((t) => t.key));
    const dirty = Object.values(get().dirty).filter(Boolean).length;
    const lines = [];
    if (busy.length) lines.push(`Still running, will be force closed:\n${runningList(busy)}`);
    if (dirty) lines.push(`${dirty} file${dirty > 1 ? "s have" : " has"} unsaved changes that will be lost.`);
    if (lines.length && !(await ask(lines.join("\n\n"), { title: "Quit Aira?", kind: "warning", okLabel: busy.length ? "Force close & quit" : "Quit" }))) return;
    updateConfig((c) => void (c.layout.runningAtQuit = running.flatMap((t) => (t.scriptId ? [t.scriptId] : []))));
    await saveNow();
    await then();
  } finally {
    quitting = false;
  }
}

/**
 * Relaunches Aira without stopping anything: the new process inherits the live shells (pty.rs `relaunch`),
 * their scrollback comes back from the handoff file and tabs reopen on their pages. After an update this
 * is what starts the new version.
 */
export async function restartApp() {
  if (quitting) return;
  quitting = true;
  try {
    const dirty = Object.values(get().dirty).filter(Boolean).length;
    if (dirty && !(await ask(`${dirty} file${dirty > 1 ? "s have" : " has"} unsaved changes that will be lost.`, { title: "Restart Aira?", kind: "warning", okLabel: "Restart" }))) return;
    await writeHandoff();
    updateConfig((c) => void (c.layout.runningAtQuit = [])); // nothing to re-run: the scripts stay alive
    await saveNow();
    await api.relaunch();
  } catch (e) {
    notify(`Restart failed: ${e}`);
  } finally {
    quitting = false;
  }
}

function onMenu(id: string) {
  const { config } = get();
  if (id === "settings") set({ dialog: { kind: "settings" } });
  else if (id === "check-updates") checkForUpdates(true);
  else if (id === "restart") restartApp();
  else if (id === "open-folder") openFolders();
  else if (id === "new-terminal") {
    const p = activeProject();
    if (p) newTerminal(p.id, { cwd: activeSpace()?.dir });
  } else if (id === "new-browser") openBrowserTab();
  else if (id === "close-tab") closeTab(config.layout.activeTab);
  else if (id === "toggle-left") togglePanel(panelApi.left);
  else if (id === "toggle-right") togglePanel(panelApi.right);
}

export async function boot() {
  const config = normalize(await api.loadConfig().catch(() => null));
  // Terminals handed over by the previous process (a restart for an update) are running already: marked so
  // before any tab mounts, or a shell would be started on top of the one being reattached.
  const handoff = await readHandoff();
  const terms: Record<string, Term> = Object.fromEntries(
    config.layout.terms.map((t) => {
      const h = handoff[t.key];
      return [t.key, h ? { ...t, status: "running" as const, sessionId: h.sessionId, startedAt: h.startedAt ?? Date.now() } : { ...t, status: "idle" as const }];
    }),
  );
  const restore = config.layout.runningAtQuit.filter((id) => config.scripts[id]);
  config.layout.runningAtQuit = [];
  set({ config, terms, restore, ready: true });
  attachInherited(handoff);
  applySettings();
  media.addEventListener("change", applySettings);
  scheduleUpdateChecks();

  useStore.subscribe((s, prev) => {
    if (s.config !== prev.config || s.terms !== prev.terms) {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveNow, 400);
    }
    if (s.config.settings !== prev.config.settings) applySettings();
    if (s.config.layout.activeTab !== prev.config.layout.activeTab) seeActiveTerm();
    if (s.agentStatus !== prev.agentStatus) {
      // Dock badge: agents that finished, asked, or exited while nobody was looking.
      const n = Object.values(s.agentStatus).filter((a) => a.unseen).length;
      if (n !== badge) {
        badge = n;
        getCurrentWindow().setBadgeCount(n || undefined).catch(() => {});
      }
    }
  });

  window.addEventListener("focus", seeActiveTerm);

  config.projects.forEach((p) => discover(p.id));
  syncWatch();
  listen<string[]>("fs-changed", (e) => handleFsChange(e.payload));
  listen<State["mem"]>("mem-stats", (e) => {
    set({ mem: e.payload });
    if (e.payload.procs) detectAgents(e.payload.procs);
  });
  listen<string>("menu", (e) => onMenu(e.payload));
  if (import.meta.env.DEV) initPhone(); // phone companion: dev builds only until it ships
  listen("quit-requested", () => quitApp());
  listen<string>("notification-clicked", (e) => e.payload && focusTerminal(e.payload)); // no key: the Settings test banner
  listen<string>("browser:docked", (e) => set((s) => ({ popped: omit(s.popped, e.payload) })));
}

