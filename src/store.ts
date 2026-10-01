import { create } from "zustand";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type Config, type FileEntry, type GitStatus, type Project, type Repo, type Script, type Space, type Tab, type TermSnapshot } from "./ipc";
import { disposeModel, reloadIfClean, setEditorTheme } from "./lib/monaco";
import { newTerminal, removeTerm, setTerminalTheme } from "./lib/terminals";
import { nextIdentity } from "./lib/identity";
import { AGENTS } from "./lib/agents";

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

interface State {
  ready: boolean;
  config: Config;
  terms: Record<string, Term>;
  repos: Record<string, Repo[]>; // projectId → repos
  status: Record<string, GitStatus>; // repo path → status
  agentStatus: Record<string, AgentStatus>; // term key → activity (kept out of `terms` so it never triggers saves)
  subagents: Record<string, SubAgentNode[]>; // term key → Claude subagent tree (from hooks)
  mem: { sessions: Record<string, number>; app: number; procs?: Record<string, string[]> };
  dirty: Record<string, boolean>; // file path → unsaved edits
  dialog: Dialog;
  restore: string[]; // script ids running at last quit
  toast: string | null;
}

/** Exited non-zero on its own (a user Stop is not a failure). */
export const isFailed = (t?: Term) => t?.status === "exited" && t.exitCode !== 0 && !t.stopped;

const DEFAULT_CONFIG: Config = {
  projects: [],
  scripts: {},
  settings: {
    theme: "dark",
    uiFont: "System",
    monoFont: "SF Mono",
    fontSize: 13,
    terminalWebgl: false,
    notifyAgents: true,
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
  mem: { sessions: {}, app: 0 },
  dirty: {},
  dialog: null,
  restore: [],
  toast: null,
}));

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
  c.layout.tabs = c.layout.tabs.filter((t) => t.kind !== "terminal" || termKeys.has(t.key));
  if (!c.layout.tabs.some((t) => t.id === c.layout.activeTab)) c.layout.activeTab = c.layout.tabs[0]?.id ?? null;
  if (!c.projects.some((p) => p.id === c.layout.activeProjectId)) c.layout.activeProjectId = c.projects[0]?.id ?? null;
  return c;
}

let saveTimer: number | undefined;
export async function saveNow() {
  clearTimeout(saveTimer);
  const { config, terms } = get();
  const tabKeys = new Set(config.layout.tabs.flatMap((t) => (t.kind === "terminal" ? [t.key] : [])));
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
    c.layout.activeProjectId = id;
    c.layout.activeSpaceId = primary.id;
  });
  discover(id);
}

export async function removeProject(id: string) {
  const p = projectById(id);
  if (!p || !(await ask(`Remove "${p.name}" from the workspace? Files on disk are not touched.`, { title: "Remove project", kind: "warning", okLabel: "Remove" }))) return;
  updateConfig((c) => {
    c.projects = c.projects.filter((x) => x.id !== id);
    for (const [sid, s] of Object.entries(c.scripts)) if (s.ownerProjectId === id) delete c.scripts[sid];
    for (const x of c.projects) x.scriptIds = x.scriptIds.filter((s) => c.scripts[s]);
    if (c.layout.activeProjectId === id) c.layout.activeProjectId = c.projects[0]?.id ?? null;
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
  const dir = p.spaces.find((s) => s.id === sid)?.dir;
  if (dir) markSeen(Object.values(get().terms).filter((t) => t.agent && spaceOfPath(t.cwd)?.dir === dir).map((t) => t.key));
  if (l.activeProjectId === projectId && l.activeSpaceId === sid) return;
  updateConfig((c) => {
    c.layout.activeProjectId = projectId;
    c.layout.activeSpaceId = sid;
  });
}
export const setActiveProject = (id: string) => setActiveSpace(id);

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
    c.layout.activeProjectId = projectId;
    c.layout.activeSpaceId = id;
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
  if (!(await ask(`Remove space "${s.name}"? Its folder stays on disk.`, { title: "Remove space", kind: "warning", okLabel: "Remove" }))) return;
  updateConfig((c) => {
    const x = c.projects.find((y) => y.id === projectId);
    if (!x) return;
    x.spaces = x.spaces.filter((y) => y.id !== spaceId);
    if (c.layout.activeSpaceId === spaceId) c.layout.activeSpaceId = primarySpace(x)?.id ?? null;
  });
  discover(projectId);
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
  for (const p of paths) {
    const gi = p.indexOf("/.git/");
    if (gi >= 0) {
      // HEAD/index/refs moved: refresh the repo and its worktrees (their gitdirs live in here too).
      const r = p.slice(0, gi);
      hit.add(r);
      repos.filter((x) => x.parent === r).forEach((x) => hit.add(x.path));
    } else {
      const r = repoOf(p);
      if (r) hit.add(r.path);
      reloadIfClean(p);
    }
  }
  hit.forEach(refreshStatus);
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

export const activateTab = (id: string) => {
  if (id.startsWith("term:")) markSeen([id.slice(5)]);
  updateConfig((c) => void (c.layout.activeTab = id));
};

export function openTerminalTab(key: string, activate = true) {
  const id = `term:${key}`;
  if (activate) markSeen([key]);
  updateConfig((c) => {
    if (!c.layout.tabs.some((t) => t.id === id)) insertTab(c, { id, kind: "terminal", key });
    if (activate) c.layout.activeTab = id;
  });
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

export function pinTab(id: string) {
  updateConfig((c) => {
    const t = c.layout.tabs.find((x) => x.id === id);
    if (t?.kind === "file") t.pinned = true;
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
  // Plain shells die with their tab; script terminals keep running (reopen from the sidebar).
  if (tab.kind === "terminal" && !get().terms[tab.key]?.scriptId) removeTerm(tab.key);
  updateConfig((c) => {
    const i = c.layout.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    c.layout.tabs.splice(i, 1);
    if (c.layout.activeTab === id) c.layout.activeTab = (c.layout.tabs[i] ?? c.layout.tabs[i - 1])?.id ?? null;
  });
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
async function onQuitRequested() {
  if (quitting) return;
  quitting = true;
  try {
    const running = Object.values(get().terms).filter((t) => t.status === "running" || t.status === "stopping");
    const dirty = Object.values(get().dirty).filter(Boolean).length;
    const lines = [];
    if (running.length) lines.push(`${running.length} running process${running.length > 1 ? "es" : ""} will be stopped.`);
    if (dirty) lines.push(`${dirty} file${dirty > 1 ? "s have" : " has"} unsaved changes that will be lost.`);
    if (lines.length && !(await ask(lines.join("\n"), { title: "Quit IDE?", kind: "warning", okLabel: "Quit" }))) return;
    updateConfig((c) => void (c.layout.runningAtQuit = running.flatMap((t) => (t.scriptId ? [t.scriptId] : []))));
    await saveNow();
    await api.quit();
  } finally {
    quitting = false;
  }
}

function onMenu(id: string) {
  const { config } = get();
  if (id === "settings") set({ dialog: { kind: "settings" } });
  else if (id === "open-folder") openFolders();
  else if (id === "new-terminal") {
    const p = activeProject();
    if (p) newTerminal(p.id, { cwd: activeSpace()?.dir });
  } else if (id === "close-tab") closeTab(config.layout.activeTab);
  else if (id === "toggle-left") togglePanel(panelApi.left);
  else if (id === "toggle-right") togglePanel(panelApi.right);
}

export async function boot() {
  const config = normalize(await api.loadConfig().catch(() => null));
  const terms: Record<string, Term> = Object.fromEntries(config.layout.terms.map((t) => [t.key, { ...t, status: "idle" as const }]));
  const restore = config.layout.runningAtQuit.filter((id) => config.scripts[id]);
  config.layout.runningAtQuit = [];
  set({ config, terms, restore, ready: true });
  applySettings();
  media.addEventListener("change", applySettings);

  useStore.subscribe((s, prev) => {
    if (s.config !== prev.config || s.terms !== prev.terms) {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveNow, 400);
    }
    if (s.config.settings !== prev.config.settings) applySettings();
  });

  config.projects.forEach((p) => discover(p.id));
  syncWatch();
  listen<string[]>("fs-changed", (e) => handleFsChange(e.payload));
  listen<State["mem"]>("mem-stats", (e) => {
    set({ mem: e.payload });
    if (e.payload.procs) detectAgents(e.payload.procs);
  });
  listen<string>("menu", (e) => onMenu(e.payload));
  listen("quit-requested", onQuitRequested);
}

