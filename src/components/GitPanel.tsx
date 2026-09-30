import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, type Branches, type FileEntry, type Project, type Repo } from "../ipc";
import {
  addSpace, basename, discover, dirname, excludesFor, gitReposOf, isUnder, notify, openDiff, openFile, refreshStatus, setActiveSpace,
  statusLetter, updateConfig, useStore,
} from "../store";
import { newTerminal } from "../lib/terminals";
import { fileIconUrl } from "../lib/icons";
import { aiCfg, aiProvider } from "../lib/aiProviders";
import { cx, Icon, IconButton, Orb, stop } from "./ui";

const PALETTE = ["#6aa8ff", "#3fcf6e", "#e6b450", "#c084fc", "#22d3ee", "#fb923c", "#f472b6", "#a3e635"];

/** WebStorm-style: every repo in the project, each its own colored section with its own commit box. */
export function GitPanel({ project }: { project: Project }) {
  const all = useStore((s) => s.repos[project.id]);
  if (!all) {
    return (
      <div className="empty-hint">
        <Orb state="searching" size={32} />
        <p>Scanning for repositories…</p>
      </div>
    );
  }
  const repos = gitReposOf(project, all).sort((a, b) => Number(b.path === project.path) - Number(a.path === project.path) || a.path.localeCompare(b.path));
  if (!repos.length) {
    return (
      <div className="empty-hint">
        <p>Not a git repository.</p>
        <button className="btn" onClick={() => api.init(project.path).then(() => discover(project.id)).catch(notify)}>
          <Icon name="add" /> Initialize repository
        </button>
      </div>
    );
  }
  return (
    <div className="git scroll">
      {repos.map((r, i) => {
        const space = project.spaces.find((s) => s.dir === r.path);
        return (
          <RepoSection
            key={r.path}
            project={project}
            repo={r}
            all={all}
            color={space?.color ?? PALETTE[i % PALETTE.length]}
            label={space?.name ?? (r.path === project.path ? project.name : isUnder(r.path, project.path) ? r.path.slice(project.path.length + 1) : basename(r.path))}
            single={repos.length === 1}
          />
        );
      })}
    </div>
  );
}

function RepoSection({ project, repo, all, color, label, single }: { project: Project; repo: Repo; all: Repo[]; color: string; label: string; single: boolean }) {
  const st = useStore((s) => s.status[repo.path]);
  const ai = useStore((s) => s.config.settings.ai);
  const [open, setOpen] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(null);
      refreshStatus(repo.path);
    }
  };

  const files = st?.files ?? [];
  // Expanded by default once status is known and has changes (or when it's the only repo).
  const isOpen = open ?? (single || files.length > 0);
  const staged = files.filter((f) => !f.conflict && f.x !== "." && f.x !== "?");
  const unstaged = files.filter((f) => !f.conflict && (f.y !== "." || f.x === "?"));
  const conflicts = files.filter((f) => f.conflict);
  const excludes = excludesFor(repo.path);
  const provider = aiProvider(ai.provider);

  const commit = () =>
    run("commit", async () => {
      if (!msg.trim()) throw new Error("Write a commit message first.");
      if (!staged.length) await api.stage(repo.path, [], excludes); // nothing staged: commit everything
      await api.commit(repo.path, msg.trim());
      setMsg("");
    });
  const generate = async () => {
    // Providers that may train on / store the diff abroad need a one-time, informed OK.
    if (provider.risk !== "ok" && !ai.acknowledged[provider.id]) {
      const ok = await ask(`${provider.note}\n\nSend this repository's diff to ${provider.label}?`, {
        title: `Generate with ${provider.label}`,
        kind: provider.risk === "warning" ? "warning" : "info",
        okLabel: "Send diff",
      });
      if (!ok) return;
      updateConfig((c) => void (c.settings.ai.acknowledged = { ...c.settings.ai.acknowledged, [provider.id]: true }));
    }
    run("ai", async () => setMsg(await api.aiCommitMessage(repo.path, excludes, aiCfg(ai))));
  };
  const discard = async (list: FileEntry[]) => {
    const what = list.length === 1 ? basename(list[0].path) : `${list.length} files`;
    if (!(await ask(`Discard changes to ${what}? This cannot be undone.`, { title: "Discard changes", kind: "warning", okLabel: "Discard" }))) return;
    run("discard", () =>
      api.discard(
        repo.path,
        list.filter((f) => f.x !== "?").map((f) => f.path),
        list.filter((f) => f.x === "?").map((f) => f.path),
      ),
    );
  };
  const syncIcon = (what: string, icon: string) => (busy === what ? <Orb state="connecting" size={20} /> : <Icon name={icon} size={14} />);

  return (
    <section className="repo-section" style={{ "--repo-color": color } as CSSProperties}>
      <div className="repo-head" onClick={() => setOpen(!isOpen)} role="button" aria-expanded={isOpen}>
        <Icon name={isOpen ? "expand_more" : "chevron_right"} size={14} className="dim" />
        <span className="repo-dot" />
        <span className="repo-name ellipsis" title={repo.path}>{label}</span>
        {files.length > 0 && <span className="count">{files.length}</span>}
      </div>
      <div className="repo-sync row">
        <BranchMenu repo={repo.path} current={st?.branch ?? null} onDone={() => refreshStatus(repo.path)} />
        <span className="spacer" />
        <button className="btn small" title="Fetch" disabled={!!busy} onClick={() => run("fetch", () => api.fetch(repo.path))}>
          {syncIcon("fetch", "sync")}
        </button>
        <button className="btn small" title="Pull" disabled={!!busy} onClick={() => run("pull", () => api.pull(repo.path))}>
          {syncIcon("pull", "download")} {st?.behind || ""}
        </button>
        <button className="btn small" title={st?.upstream ? `Push to ${st.upstream}` : "Push (sets upstream)"} disabled={!!busy} onClick={() => run("push", () => api.push(repo.path))}>
          {syncIcon("push", "upload")} {st?.ahead || ""}
        </button>
      </div>

      {isOpen && (
        <div className="repo-body">
          <div className="commit-box">
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={`Message for ${label} (⌘⏎ to commit${staged.length ? "" : " all"})`}
              rows={3}
              onKeyDown={(e) => e.key === "Enter" && e.metaKey && commit()}
            />
            <div className="row">
              <button className="btn" title={`Generate with ${provider.label}`} disabled={!!busy || !files.length} onClick={generate}>
                {busy === "ai" ? <Orb state="composing" size={20} /> : <Icon name="auto_awesome" size={14} />} Generate
              </button>
              <span className="spacer" />
              <button className="btn primary" disabled={!!busy || !files.length || !msg.trim()} onClick={commit}>
                <Icon name="check" size={14} /> {staged.length ? "Commit" : "Commit all"}
              </button>
            </div>
          </div>
          {conflicts.length > 0 && (
            <FileSection title="Merge conflicts" files={conflicts} repo={repo.path} staged={false}>
              <IconButton icon="add" title="Mark all resolved (stage)" onClick={() => run("stage", () => api.stage(repo.path, conflicts.map((f) => f.path), []))} />
            </FileSection>
          )}
          {staged.length > 0 && (
            <FileSection title="Staged" files={staged} repo={repo.path} staged onUnstage={(f) => run("unstage", () => api.unstage(repo.path, [f.path]))}>
              <IconButton icon="remove" title="Unstage all" onClick={() => run("unstage", () => api.unstage(repo.path, []))} />
            </FileSection>
          )}
          <FileSection
            title="Changes"
            files={unstaged}
            repo={repo.path}
            staged={false}
            onStage={(f) => run("stage", () => api.stage(repo.path, [f.path], []))}
            onDiscard={(f) => discard([f])}
          >
            {unstaged.length > 0 && (
              <>
                <IconButton icon="undo" title="Discard all" onClick={() => discard(unstaged)} />
                <IconButton icon="add" title="Stage all" onClick={() => run("stage", () => api.stage(repo.path, [], excludes))} />
              </>
            )}
          </FileSection>
          {!files.length && st && <p className="empty-note">No changes.</p>}
          {repo.kind !== "worktree" && <Worktrees project={project} repo={repo} all={all} />}
        </div>
      )}
    </section>
  );
}

function FileSection({
  title, files, repo, staged, onStage, onUnstage, onDiscard, children,
}: {
  title: string;
  files: FileEntry[];
  repo: string;
  staged: boolean;
  onStage?: (f: FileEntry) => void;
  onUnstage?: (f: FileEntry) => void;
  onDiscard?: (f: FileEntry) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="git-section">
      <div className="sub-head clickable" onClick={() => setOpen(!open)}>
        <Icon name={open ? "expand_more" : "chevron_right"} size={14} />
        <span>{title}</span>
        <span className="count">{files.length}</span>
        <span className="hover-actions always" onClick={(e) => e.stopPropagation()}>{children}</span>
      </div>
      {open &&
        files.map((f) => {
          const letter = statusLetter(f, staged);
          const isDir = f.path.endsWith("/");
          const name = basename(f.path.replace(/\/$/, ""));
          const dir = f.path.includes("/") ? dirname(f.path.replace(/\/$/, "")) : "";
          return (
            <div key={f.path} className="git-row" onClick={() => !isDir && openDiff(repo, f, staged)} title={f.orig ? `${f.orig} → ${f.path}` : f.path}>
              <img className="file-icon" src={fileIconUrl(f.path)} alt="" />
              <span className="ellipsis">
                {name}
                {dir && dir !== "/" && <span className="dim"> {dir}</span>}
              </span>
              <span className="hover-actions">
                {!isDir && letter !== "D" && <IconButton icon="description" title="Open file" onClick={stop(() => openFile(`${repo}/${f.path}`, true))} />}
                {onDiscard && <IconButton icon="undo" title="Discard changes" onClick={stop(() => onDiscard(f))} />}
                {onStage && <IconButton icon="add" title="Stage" onClick={stop(() => onStage(f))} />}
                {onUnstage && <IconButton icon="remove" title="Unstage" onClick={stop(() => onUnstage(f))} />}
              </span>
              <span className={cx("letter", `l-${letter === "?" ? "U" : letter}`)}>{letter}</span>
            </div>
          );
        })}
    </div>
  );
}

function BranchMenu({ repo, current, onDone }: { repo: string; current: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branches | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) api.branches(repo).then(setBranches).catch(notify);
  }, [open, repo]);
  const act = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    setFilter("");
    try {
      await fn();
    } catch (e) {
      notify(e);
    }
    onDone();
  };
  const q = filter.trim();
  const local = branches?.local.filter((b) => b.name.includes(q)) ?? [];
  const remote = branches?.remote.filter((b) => b.includes(q) && !branches.local.some((l) => b.endsWith(`/${l.name}`))) ?? [];
  const exists = !!branches?.local.some((b) => b.name === q);
  const del = async (name: string) => {
    if (!(await ask(`Delete branch "${name}"?`, { kind: "warning", okLabel: "Delete" }))) return;
    act(() =>
      api.deleteBranch(repo, name, false).catch(async (e) => {
        if (await ask(`${e}\n\nForce delete "${name}"?`, { kind: "warning", okLabel: "Force delete" })) return api.deleteBranch(repo, name, true);
      }),
    );
  };
  return (
    <div className="popover-anchor">
      <button className="btn branch-btn" onClick={() => setOpen(!open)} title="Switch / create branch">
        <Icon name="alt_route" size={14} /> <span className="ellipsis">{current ?? "detached"}</span> <Icon name="expand_more" size={14} />
      </button>
      {open && (
        <div className="popover" onMouseLeave={() => setOpen(false)}>
          <input
            autoFocus
            placeholder="Find or create branch…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && q && !exists) act(() => api.switchBranch(repo, q, true));
            }}
          />
          {q && !exists && (
            <div className="menu-item" onClick={() => act(() => api.switchBranch(repo, q, true))}>
              <Icon name="add" size={14} /> Create branch <b>{q}</b>
            </div>
          )}
          {local.map((b) => (
            <div key={b.name} className={cx("menu-item", b.current && "on")} onClick={() => !b.current && act(() => api.switchBranch(repo, b.name, false))}>
              <Icon name={b.current ? "check" : "alt_route"} size={14} />
              <span className="ellipsis">{b.name}</span>
              <span className="dim">{b.track}</span>
              {!b.current && <IconButton icon="delete" title="Delete branch" onClick={stop(() => del(b.name))} />}
            </div>
          ))}
          {remote.length > 0 && <div className="menu-label">Remote</div>}
          {remote.map((b) => (
            <div key={b} className="menu-item" onClick={() => act(() => api.switchBranch(repo, b.slice(b.indexOf("/") + 1), false))}>
              <Icon name="cloud" size={14} /> <span className="ellipsis">{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Worktrees({ project, repo, all }: { project: Project; repo: Repo; all: Repo[] }) {
  const main = repo.path;
  const list = all.filter((r) => r.parent === main);
  const [branch, setBranch] = useState<string | null>(null);
  const add = async () => {
    const name = branch?.trim();
    setBranch(null);
    if (!name) return;
    const path = `${dirname(main)}/${basename(main)}-${name.replace(/[^\w.-]+/g, "-")}`;
    try {
      const { local } = await api.branches(main);
      await api.worktreeAdd(main, path, name, !local.some((b) => b.name === name));
      await discover(project.id); // worktrees stay out of the sidebar until added as a space
    } catch (e) {
      notify(e);
    }
  };
  const remove = async (path: string) => {
    if (!(await ask(`Remove worktree ${basename(path)}? The folder is deleted; the branch is kept.`, { kind: "warning", okLabel: "Remove" }))) return;
    try {
      await api.worktreeRemove(main, path, false).catch(async (e) => {
        if (await ask(`${e}\n\nForce remove (loses uncommitted changes)?`, { kind: "warning", okLabel: "Force remove" })) return api.worktreeRemove(main, path, true);
        throw e;
      });
    } catch (e) {
      notify(e);
    }
    discover(project.id);
  };
  return (
    <div className="git-section">
      <div className="sub-head">
        <Icon name="account_tree" size={14} />
        <span>Worktrees</span>
        <span className="count">{list.length}</span>
        <span className="hover-actions always">
          <IconButton icon="add" title="New worktree" onClick={() => setBranch("")} />
        </span>
      </div>
      {branch !== null && (
        <div className="row pad">
          <input
            autoFocus
            placeholder="Branch (new or existing)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setBranch(null);
            }}
          />
          <button className="btn" onClick={add}>Add</button>
        </div>
      )}
      {list.map((w) => {
        const space = project.spaces.find((s) => s.dir === w.path);
        return (
          <div
            key={w.path}
            className="git-row"
            onClick={() => space && setActiveSpace(project.id, space.id)}
            title={space ? `${w.path}\nOpen space` : w.path}
          >
            <Icon name="folder_special" size={14} className="accent" />
            <span className="ellipsis">{basename(w.path)}</span>
            {space && <Icon name="workspaces" size={13} className="dim" title="Is a space" />}
            <span className="hover-actions">
              {!space && <IconButton icon="library_add" title="Add as space" onClick={stop(() => addSpace(project.id, { name: basename(w.path), dir: w.path }))} />}
              <IconButton icon="terminal" title="Open terminal here" onClick={stop(() => newTerminal(project.id, { cwd: w.path }))} />
              <IconButton icon="delete" title="Remove worktree" onClick={stop(() => remove(w.path))} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
