import { Channel, invoke } from "@tauri-apps/api/core";

export interface Script {
  id: string;
  name: string;
  runner: string;
  target: string;
  command: string;
  /** Relative to the owner project; absolute when external (ownerProjectId === null). */
  cwd: string;
  ownerProjectId: string | null;
  /** Last start (ms), for the Scripts tab's order. */
  lastRunAt?: number;
  /** Ports it was last seen listening on (kept after it stops, for the Ports popover). */
  ports?: number[];
}

/** A listening TCP port and its process; `session` = the IDE terminal whose process tree holds it. */
export interface PortInfo {
  port: number;
  pid: number;
  name: string;
  cmd: string;
  cwd: string | null;
  session: string | null;
}

/** A working directory inside a project. The primary space is the project root (dir === project.path). */
export interface Space {
  id: string;
  name: string;
  dir: string;
  /** Starred = "active": listed in the cross-project Spaces view. */
  starred?: boolean;
  /** Per-workspace pinned quick links, shown on the browser new-tab page. */
  pins?: BrowserPin[];
  /** Custom names for detected dev servers, keyed by port (default is the owning script's name). */
  serverNames?: Record<string, string>;
  /** Detected dev-server ports hidden from the new-tab page (e.g. a backend API). */
  hiddenServers?: number[];
}

export interface BrowserPin {
  url: string;
  title?: string;
}

export interface BrowserHistoryEntry {
  url: string;
  ts: number;
  /** Custom name, set by renaming the Recent tile. */
  title?: string;
}

/** Material symbol name, a single emoji, or an absolute path to a png/svg inside the project. */
export type ProjectIcon = { type: "symbol" | "emoji" | "image"; value: string };

export interface Project {
  id: string;
  name: string;
  path: string;
  icon?: ProjectIcon;
  color?: string;
  scriptIds: string[];
  /** Opt-in per agent: IDE hook file written into the repo ("on") or declined ("off"). */
  agentHooks?: Record<string, "on" | "off">;
  /** Scripts the project's Start button runs; empty = all. */
  startScriptIds: string[];
  spaces: Space[];
  collapsed?: boolean;
  /** Its Scripts section in the Projects tab is folded. */
  scriptsCollapsed?: boolean;
}

export interface Settings {
  theme: "dark" | "light" | "system";
  uiFont: string;
  monoFont: string;
  fontSize: number;
  terminalWebgl: boolean;
  /** macOS notifications when an agent finishes, needs input, or exits. */
  notifyAgents: boolean;
  /** Coding agents hidden from the "+" launcher (by id). Default: show only installed ones. */
  hiddenAgents: string[];
  /** Per-provider model and base URL; keySaved records which providers have a Keychain key (no prompt just to check). */
  ai: {
    provider: string;
    models: Record<string, string>;
    baseUrls: Record<string, string>;
    keySaved: Record<string, boolean>;
    /** Providers whose data-use note the user accepted before the first Generate. */
    acknowledged: Record<string, boolean>;
  };
}

export interface TermSnapshot {
  key: string;
  name: string;
  projectId: string;
  scriptId?: string;
  cwd: string;
  command?: string;
  renamed?: boolean;
  /** Coding-agent id (lib/agents) for agent terminals. Its space is derived from cwd. */
  agent?: string;
}

export type Tab =
  | { id: string; kind: "terminal"; key: string }
  | { id: string; kind: "file"; path: string; pinned: boolean }
  | { id: string; kind: "diff"; repo: string; path: string; orig: string | null; staged: boolean; head?: boolean }
  | { id: string; kind: "browser"; url: string }
  | { id: string; kind: "launcher" };

/** A space's own main tabs and right panel choice. */
export interface SpaceView {
  tabs: Tab[];
  activeTab: string | null;
  rightView: "files" | "git";
}

export interface Config {
  projects: Project[];
  scripts: Record<string, Script>;
  settings: Settings;
  /** Embedded-browser visit history (newest first), for the new-tab page. */
  browserHistory: BrowserHistoryEntry[];
  layout: SpaceView & {
    activeProjectId: string | null;
    terms: TermSnapshot[];
    runningAtQuit: string[];
    activeSpaceId: string | null;
    leftView: "projects" | "spaces" | "scripts";
    /** Every space's view but the active one's (which is tabs/activeTab/rightView above). */
    views: Record<string, SpaceView>;
  };
}

export interface Repo {
  path: string;
  kind: "primary" | "nested" | "worktree";
  parent: string | null;
}

export interface FileEntry {
  path: string;
  orig: string | null;
  x: string;
  y: string;
  conflict: boolean;
}

export interface GitStatus {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileEntry[];
}

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface Branches {
  local: { name: string; upstream: string | null; track: string; current: boolean }[];
  remote: string[];
}

/** Provider config sent to the backend for AI calls (keys stay in the Keychain). */
export interface AiCfg {
  kind: "anthropic" | "openai" | "cli";
  baseUrl?: string;
  keyId?: string;
  model: string;
  cli?: string;
  label: string;
}

/** Claude Code hook payload (https://code.claude.com/docs/en/hooks); only the fields we read. */
export interface HookEvent {
  hook_event_name: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: { description?: string; subagent_type?: string };
  tool_response?: { agentId?: string; status?: string };
  notification_type?: string;
  /** Claude Code: the session's JSONL, read for token usage. */
  transcript_path?: string;
}

/** Tokens one model used in a Claude Code session (lib/usage prices them). */
export interface UsageRow {
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
}

export type PtyMessage = ArrayBuffer | { exit: number };

export const api = {
  ptySpawn: (a: { id: string; cwd: string; command: string | null; cols: number; rows: number; env: Record<string, string> | null; onData: Channel<PtyMessage> }) =>
    invoke<number>("pty_spawn", a),
  ptyWrite: (id: string, data: string) => invoke("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke("pty_resize", { id, cols, rows }),
  ptyAck: (id: string, bytes: number) => invoke("pty_ack", { id, bytes }),
  ptyKill: (id: string) => invoke("pty_kill", { id }),
  ptyBusy: (ids: string[]) => invoke<string[]>("pty_busy", { ids }),
  portsList: () => invoke<PortInfo[]>("ports_list"),
  killPid: (pid: number) => invoke("kill_pid", { pid }),
  quit: () => invoke("quit_app"),

  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  readFileBytes: (path: string) => invoke<ArrayBuffer>("read_file_bytes", { path }),
  writeFile: (path: string, content: string) => invoke("write_file", { path, content }),
  createPath: (path: string, dir: boolean) => invoke("create_path", { path, dir }),
  copyText: (text: string) => invoke("copy_text", { text }),
  /** Zero-touch per-launch setup (extra args + env) for an agent's hooks/plugin. */
  agentSetup: (agent: string, key: string) => invoke<{ args: string[]; env: Record<string, string> }>("agent_setup", { agent, key }),
  /** Opt-in project hook file: "on" | "exists" (foreign file, untouched) | "off" | "unsupported". */
  agentRepoHooks: (agent: string, cwd: string, enable: boolean) => invoke<string>("agent_repo_hooks", { agent, cwd, enable }),
  agentEvents: (key: string) => invoke<HookEvent[]>("agent_events", { key }),
  agentEventsClear: (key: string) => invoke("agent_events_clear", { key }),
  agentUsage: (path: string) => invoke<UsageRow[]>("agent_usage", { path }),
  /** macOS banner; resolves after the banner is clicked or cleared, so don't await it. */
  notifyAgent: (key: string, title: string, body: string) => invoke("notify_agent", { key, title, body }),
  listFonts: () => invoke<{ all: string[]; mono: string[] }>("list_fonts"),
  loadConfig: () => invoke<Config | null>("load_config"),
  saveConfig: (config: Config) => invoke("save_config", { config }),
  which: (names: string[]) => invoke<string[]>("which", { names }),
  watchSet: (paths: string[]) => invoke("watch_set", { paths }),

  discover: (root: string, extra: string[]) => invoke<Repo[]>("git_discover", { root, extra }),
  status: (repo: string, excludes: string[]) => invoke<GitStatus>("git_status", { repo, excludes }),
  fileVersions: (repo: string, path: string, orig: string | null, staged: boolean, head = false) =>
    invoke<{ original: string; modified: string; binary: boolean }>("git_file_versions", { repo, path, orig, staged, head }),
  stage: (repo: string, paths: string[], excludes: string[]) => invoke("git_stage", { repo, paths, excludes }),
  unstage: (repo: string, paths: string[]) => invoke("git_unstage", { repo, paths }),
  discard: (repo: string, tracked: string[], untracked: string[]) => invoke("git_discard", { repo, tracked, untracked }),
  /** Commits exactly `paths` (untracked ones are added first); `amend` with no paths rewrites the message only. */
  commit: (repo: string, message: string, paths: string[], untracked: string[], amend: boolean) =>
    invoke("git_commit", { repo, message, paths, untracked, amend }),
  lastMessage: (repo: string) => invoke<string>("git_last_message", { repo }),
  init: (path: string) => invoke("git_init", { path }),
  branches: (repo: string) => invoke<Branches>("git_branches", { repo }),
  switchBranch: (repo: string, name: string, create: boolean) => invoke("git_switch", { repo, name, create }),
  deleteBranch: (repo: string, name: string, force: boolean) => invoke("git_branch_delete", { repo, name, force }),
  fetch: (repo: string) => invoke("git_fetch", { repo }),
  pull: (repo: string) => invoke("git_pull", { repo }),
  push: (repo: string) => invoke("git_push", { repo }),
  worktreeAdd: (repo: string, path: string, branch: string, create: boolean) =>
    invoke("git_worktree_add", { repo, path, branch, create }),
  worktreeRemove: (repo: string, path: string, force: boolean) => invoke("git_worktree_remove", { repo, path, force }),

  aiSetKey: (provider: string, key: string) => invoke("ai_set_key", { provider, key }),
  aiCommitMessage: (repo: string, excludes: string[], cfg: AiCfg, paths?: string[]) =>
    invoke<string>("ai_commit_message", { repo, excludes, cfg, paths: paths ?? null }),
  aiListModels: (cfg: AiCfg) => invoke<string[]>("ai_list_models", { cfg }),

  // Embedded browser: a native child webview the frontend positions over the Browser tab's body.
  browserOpen: (a: { id: string; url: string; x: number; y: number; w: number; h: number; userAgent?: string }) =>
    invoke("browser_open", a),
  browserBounds: (id: string, x: number, y: number, w: number, h: number) => invoke("browser_bounds", { id, x, y, w, h }),
  browserNavigate: (id: string, url: string) => invoke("browser_navigate", { id, url }),
  browserNavAction: (id: string, action: "back" | "forward" | "reload") => invoke("browser_nav_action", { id, action }),
  browserShow: (id: string, visible: boolean) => invoke("browser_show", { id, visible }),
  browserClose: (id: string) => invoke("browser_close", { id }),
  browserDevtools: (id: string) => invoke("browser_devtools", { id }),
  browserZoom: (id: string, factor: number) => invoke("browser_zoom", { id, factor }),
  /** Site favicon as a data URL (page's <link rel=icon>, else /favicon.ico), or null. */
  browserFavicon: (url: string) => invoke<string | null>("browser_favicon", { url }),
};
