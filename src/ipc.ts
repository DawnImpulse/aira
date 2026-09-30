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
}

/** A working directory inside a project. The primary space is the project root (dir === project.path). */
export interface Space {
  id: string;
  name: string;
  dir: string;
  icon?: string;
  color?: string;
  /** Starred = "active": listed in the cross-project Spaces view. */
  starred?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  icon?: string;
  color?: string;
  scriptIds: string[];
  /** Scripts the project's Start button runs; empty = all. */
  startScriptIds: string[];
  spaces: Space[];
  collapsed?: boolean;
}

export interface Settings {
  theme: "dark" | "light" | "system";
  uiFont: string;
  monoFont: string;
  fontSize: number;
  terminalWebgl: boolean;
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
  | { id: string; kind: "diff"; repo: string; path: string; orig: string | null; staged: boolean };

export interface Config {
  projects: Project[];
  scripts: Record<string, Script>;
  settings: Settings;
  layout: {
    tabs: Tab[];
    activeTab: string | null;
    activeProjectId: string | null;
    terms: TermSnapshot[];
    runningAtQuit: string[];
    rightView: "files" | "git";
    activeSpaceId: string | null;
    leftView: "projects" | "spaces";
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

export type PtyMessage = ArrayBuffer | { exit: number };

export const api = {
  ptySpawn: (a: { id: string; cwd: string; command: string | null; cols: number; rows: number; onData: Channel<PtyMessage> }) =>
    invoke<number>("pty_spawn", a),
  ptyWrite: (id: string, data: string) => invoke("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke("pty_resize", { id, cols, rows }),
  ptyAck: (id: string, bytes: number) => invoke("pty_ack", { id, bytes }),
  ptyKill: (id: string) => invoke("pty_kill", { id }),
  quit: () => invoke("quit_app"),

  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  readFileBytes: (path: string) => invoke<ArrayBuffer>("read_file_bytes", { path }),
  writeFile: (path: string, content: string) => invoke("write_file", { path, content }),
  createPath: (path: string, dir: boolean) => invoke("create_path", { path, dir }),
  copyText: (text: string) => invoke("copy_text", { text }),
  loadConfig: () => invoke<Config | null>("load_config"),
  saveConfig: (config: Config) => invoke("save_config", { config }),
  which: (names: string[]) => invoke<string[]>("which", { names }),
  watchSet: (paths: string[]) => invoke("watch_set", { paths }),

  discover: (root: string, extra: string[]) => invoke<Repo[]>("git_discover", { root, extra }),
  status: (repo: string, excludes: string[]) => invoke<GitStatus>("git_status", { repo, excludes }),
  fileVersions: (repo: string, path: string, orig: string | null, staged: boolean) =>
    invoke<{ original: string; modified: string; binary: boolean }>("git_file_versions", { repo, path, orig, staged }),
  stage: (repo: string, paths: string[], excludes: string[]) => invoke("git_stage", { repo, paths, excludes }),
  unstage: (repo: string, paths: string[]) => invoke("git_unstage", { repo, paths }),
  discard: (repo: string, tracked: string[], untracked: string[]) => invoke("git_discard", { repo, tracked, untracked }),
  commit: (repo: string, message: string) => invoke("git_commit", { repo, message }),
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
  aiCommitMessage: (repo: string, excludes: string[], cfg: AiCfg) => invoke<string>("ai_commit_message", { repo, excludes, cfg }),
  aiListModels: (cfg: AiCfg) => invoke<string[]>("ai_list_models", { cfg }),
};
