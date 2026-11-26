import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ask } from "../lib/dialog";
import { api, type Branches, type FileEntry, type Project, type Repo, type Space } from "../ipc";
import {
  addSpace, basename, discover, dirname, excludesFor, isUnder, notify, openDiff, openFile, refreshStatus,
  setActiveSpace, spaceReposOf, updateConfig, useStore,
} from "../store";
import { newTerminal } from "../lib/terminals";
import { fileIconUrl } from "../lib/icons";
import { aiCfg, aiProvider } from "../lib/aiProviders";
import { cx, Icon, IconButton, Spinner, stop } from "./ui";

const PALETTE = ["#6aa8ff", "#3fcf6e", "#e6b450", "#c084fc", "#22d3ee", "#fb923c", "#f472b6", "#a3e635"];

/** One commit = one repository; checking a file elsewhere moves the selection there. */
type Selection = { repo: string | null; paths: Set<string> };

const fileClass = (f: FileEntry) =>
  f.conflict ? "fs-conflict" : f.x === "?" ? "fs-new" : f.x === "D" || f.y === "D" ? "fs-deleted" : f.x === "A" ? "fs-added" : "fs-modified";
const fileLetter = (f: FileEntry) => (f.conflict ? "!" : f.x === "?" ? "U" : f.y !== "." ? f.y : f.x);

/** WebStorm-style Commit panel: one tree of changes across the project's repos, one commit area. */
export function GitPanel({ project, space }: { project: Project; space: Space }) {
  const all = useStore((s) => s.repos[project.id]);
  const status = useStore((s) => s.status);
  const ai = useStore((s) => s.config.settings.ai);
  const [sel, setSel] = useState<Selection>({ repo: null, paths: new Set() });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  const [showClean, setShowClean] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [focused, setFocused] = useState<{ repo: string; file: FileEntry } | null>(null);

  const repos = useMemo(() => spaceReposOf(project, space, all), [project, space, all]);
  const colorOf = (r: Repo) => (r.path === project.path ? (project.color ?? PALETTE[0]) : PALETTE[repos.indexOf(r) % PALETTE.length]);
  const labelOf = (r: Repo) =>
    project.spaces.find((s) => s.dir === r.path)?.name ??
    (r.path === project.path ? project.name : isUnder(r.path, project.path) ? r.path.slice(project.path.length + 1) : basename(r.path));
  const filesOf = (r: string) => status[r]?.files ?? [];
  const changed = repos.filter((r) => filesOf(r.path).length > 0);
  const clean = repos.filter((r) => !changed.includes(r));
  const total = changed.reduce((n, r) => n + filesOf(r.path).length, 0);

  // Default selection: everything in this space's repo (or the first changed repo).
  useEffect(() => {
    if (sel.repo && changed.some((r) => r.path === sel.repo)) return;
    const pick = changed.find((r) => isUnder(space.dir, r.path)) ?? changed[0];
    if (pick) {
      setSel({ repo: pick.path, paths: new Set(filesOf(pick.path).map((f) => f.path)) });
      setOpen((o) => new Set(o).add(pick.path));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed.map((r) => r.path).join("|")]);

  if (!all) {
    return (
      <div className="empty-hint">
        <Spinner size={18} />
        <p>Scanning for repositories…</p>
      </div>
    );
  }
  if (!repos.length) {
    return (
      <div className="empty-hint">
        <p>Not a git repository.</p>
        <button className="btn" onClick={() => api.init(space.dir).then(() => discover(project.id)).catch(notify)}>
          <Icon name="add" /> Initialize repository
        </button>
      </div>
    );
  }

  const selRepo = repos.find((r) => r.path === sel.repo);
  // Only paths that still exist count (a commit or refresh may have removed some).
  const checked = selRepo ? filesOf(selRepo.path).filter((f) => sel.paths.has(f.path)) : [];
  const moveTo = (repo: string, paths: string[]) => {
    if (sel.repo && sel.repo !== repo && checked.length) {
      const r = repos.find((x) => x.path === repo);
      setNote(`Commits are per repository — selection moved to ${r ? labelOf(r) : basename(repo)}.`);
    } else setNote(null);
    setSel({ repo, paths: new Set(paths) });
  };
  const toggleFile = (repo: string, path: string) => {
    if (sel.repo !== repo) return moveTo(repo, [path]);
    const next = new Set(sel.paths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSel({ repo, paths: next });
  };
  const toggleRepo = (repo: string) => {
    const files = filesOf(repo).map((f) => f.path);
    const allOn = sel.repo === repo && files.every((p) => sel.paths.has(p));
    if (allOn) setSel({ repo, paths: new Set() });
    else moveTo(repo, files);
  };
  const toggleOpen = (repo: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(repo)) n.delete(repo);
      else n.add(repo);
      return n;
    });

  const run = async (what: string, fn: () => Promise<unknown>, refresh: string[] = sel.repo ? [sel.repo] : []) => {
    setBusy(what);
    try {
      await fn();
      return true;
    } catch (e) {
      notify(e);
      return false;
    } finally {
      setBusy(null);
      refresh.forEach(refreshStatus);
    }
  };

  const commit = async (push: boolean) => {
    if (!selRepo) return;
    const repo = selRepo.path;
    if (!msg.trim()) return notify("Write a commit message first.");
    if (!checked.length && !amend) return notify("Check the files to commit.");
    const merging = filesOf(repo).some((f) => f.conflict);
    const paths = checked.flatMap((f) => (f.orig ? [f.path, f.orig] : [f.path]));
    const untracked = checked.filter((f) => f.x === "?").map((f) => f.path);
    const ok = await run(push ? "commit-push" : "commit", async () => {
      if (merging) {
        // Git refuses partial commits during a merge: stage the checked files, commit the index.
        await api.stage(repo, paths, []);
        await api.commit(repo, msg.trim(), [], [], amend);
      } else await api.commit(repo, msg.trim(), paths, untracked, amend);
      if (push) await api.push(repo);
    });
    if (ok) {
      setMsg("");
      setAmend(false);
      setSel({ repo: null, paths: new Set() }); // re-defaults to what's left
    }
  };

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    const repo = sel.repo ?? changed[0]?.path ?? repos[0]?.path;
    if (on && !msg.trim() && repo) setMsg(await api.lastMessage(repo).catch(() => ""));
  };

  const provider = aiProvider(ai.provider);
  const generate = async () => {
    if (!selRepo) return;
    // No key yet: send them to Settings before any data-use notice.
    if (provider.needsKey && !ai.keySaved[provider.id]) {
      notify(`Add your ${provider.label} API key in Settings to generate commit messages.`);
      return useStore.setState({ dialog: { kind: "settings" } });
    }
    if (provider.risk !== "ok" && !ai.acknowledged[provider.id]) {
      const ok = await ask(`${provider.note}\n\nSend this repository's diff to ${provider.label}?`, {
        title: `Generate with ${provider.label}`,
        kind: provider.risk === "warning" ? "warning" : "info",
        okLabel: "Send diff",
      });
      if (!ok) return;
      updateConfig((c) => void (c.settings.ai.acknowledged = { ...c.settings.ai.acknowledged, [provider.id]: true }));
    }
    const paths = checked.flatMap((f) => (f.orig ? [f.path, f.orig] : [f.path]));
    run("ai", async () => setMsg(await api.aiCommitMessage(selRepo.path, excludesFor(selRepo.path), aiCfg(ai), paths)), []);
  };

  const rollback = async () => {
    if (!selRepo || !checked.length) return notify("Check the files to roll back.");
    const what = checked.length === 1 ? basename(checked[0].path) : `${checked.length} files`;
    if (!(await ask(`Roll back ${what} in ${labelOf(selRepo)} to the last commit? This cannot be undone.`, { title: "Rollback", kind: "warning", okLabel: "Rollback" })))
      return;
    run("rollback", () => api.discard(selRepo.path, checked.filter((f) => f.x !== "?").map((f) => f.path), checked.filter((f) => f.x === "?").map((f) => f.path)));
  };

  const fetchAll = () => run("fetch", async () => { for (const r of repos) await api.fetch(r.path); }, repos.map((r) => r.path));
  const shown = showClean ? [...changed, ...clean] : changed;
  const label = selRepo ? labelOf(selRepo) : "";
  const commitLabel = amend && !checked.length ? `Amend ${label}` : `Commit${checked.length ? ` ${checked.length} file${checked.length > 1 ? "s" : ""}` : ""}${label ? ` to ${label}` : ""}`;

  const repoNode = (r: Repo) => {
    const files = filesOf(r.path);
    const isSel = sel.repo === r.path;
    const n = isSel ? checked.length : 0;
    const st = status[r.path];
    return (
      <div key={r.path} className="repo-node" style={{ "--repo-color": colorOf(r) } as CSSProperties}>
        <div className="tree-node" onClick={() => toggleOpen(r.path)}>
          <Icon name={open.has(r.path) ? "expand_more" : "chevron_right"} size={16} className="dim" />
          <input
            type="checkbox"
            checked={n > 0 && n === files.length}
            ref={(el) => {
              if (el) el.indeterminate = n > 0 && n < files.length;
            }}
            disabled={!files.length}
            onChange={() => toggleRepo(r.path)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Check ${labelOf(r)}`}
          />
          <span className="repo-swatch" />
          <span className="repo-label ellipsis" title={r.path}>{labelOf(r)}</span>
          <span className="dim nowrap">{files.length} {files.length === 1 ? "file" : "files"}</span>
          {files.length ? (
            // No switching with uncommitted changes: the branch is shown, not offered.
            <span className="branch-label dim nowrap" title="Commit or roll back the changes to switch branches">
              <Icon name="alt_route" size={13} /> <span className="ellipsis">{st?.branch ?? "detached"}</span>
            </span>
          ) : (
            <span className="branch-chip" onClick={(e) => e.stopPropagation()}>
              <BranchMenu repo={r.path} current={st?.branch ?? null} onDone={() => refreshStatus(r.path)} />
            </span>
          )}
          {!files.length && (
            // Like the branch menu: pull/push only on a clean repo (Commit and Push covers the rest).
            <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton icon="download" size={14} title={`Pull${st?.behind ? ` (${st.behind} behind)` : ""}`} onClick={() => run("pull", () => api.pull(r.path), [r.path])} disabled={!!busy} />
              <IconButton icon="upload" size={14} title={`Push${st?.ahead ? ` (${st.ahead} ahead)` : ""}`} onClick={() => run("push", () => api.push(r.path), [r.path])} disabled={!!busy} />
            </span>
          )}
        </div>
        {open.has(r.path) &&
          files.map((f) => {
            const isDir = f.path.endsWith("/");
            const name = basename(f.path.replace(/\/$/, ""));
            const dir = f.path.includes("/") ? dirname(f.path.replace(/\/$/, "")) : "";
            const isFocused = focused?.repo === r.path && focused.file.path === f.path;
            return (
              <div
                key={f.path}
                className={cx("tree-node file", isFocused && "focused")}
                onClick={() => {
                  setFocused({ repo: r.path, file: f });
                  if (!isDir) openDiff(r.path, f, false, true);
                }}
                title={f.orig ? `${f.orig} → ${f.path}` : f.path}
              >
                <input
                  type="checkbox"
                  checked={isSel && sel.paths.has(f.path)}
                  onChange={() => toggleFile(r.path, f.path)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Check ${name}`}
                />
                <img className="file-icon" src={fileIconUrl(f.path)} alt="" />
                <span className={cx("ellipsis", fileClass(f))}>
                  {name}
                  {dir && dir !== "/" && <span className="dim"> {dir}</span>}
                </span>
                <span className="hover-actions">
                  {!isDir && fileLetter(f) !== "D" && <IconButton icon="description" size={14} title="Open file" onClick={stop(() => openFile(`${r.path}/${f.path}`, true))} />}
                </span>
                <span className={cx("letter", `l-${fileLetter(f)}`)}>{fileLetter(f)}</span>
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div className="git commit-panel">
      <div className="git-toolbar">
        <IconButton icon="refresh" title="Refresh" onClick={() => repos.forEach((r) => refreshStatus(r.path))} />
        <IconButton icon="undo" title="Rollback checked files to HEAD" onClick={rollback} disabled={!checked.length || !!busy} />
        <IconButton icon="difference" title="Show diff of the focused file" onClick={() => focused && openDiff(focused.repo, focused.file, false, true)} disabled={!focused} />
        <IconButton icon="sync" title="Fetch all repositories" className={cx(busy === "fetch" && "spin")} onClick={fetchAll} disabled={!!busy} />
        <span className="spacer" />
        <IconButton icon="unfold_more" title="Expand all" onClick={() => setOpen(new Set(shown.map((r) => r.path)))} />
        <IconButton icon="unfold_less" title="Collapse all" onClick={() => setOpen(new Set())} />
      </div>

      <div className="scroll changes-tree">
        <div className="tree-node root" onClick={() => setRootOpen(!rootOpen)}>
          <Icon name={rootOpen ? "expand_more" : "chevron_right"} size={16} className="dim" />
          <input
            type="checkbox"
            disabled={changed.length !== 1}
            checked={changed.length === 1 && checked.length === filesOf(changed[0].path).length && checked.length > 0}
            onChange={() => changed.length === 1 && toggleRepo(changed[0].path)}
            onClick={(e) => e.stopPropagation()}
            title={changed.length > 1 ? "Commits are per repository — check a repository or its files" : "Check all changes"}
            aria-label="Check all changes"
          />
          <span className="node-title">Changes</span>
          <span className="dim">{total} {total === 1 ? "file" : "files"}</span>
        </div>
        {rootOpen && changed.map(repoNode)}
        {!changed.length && <p className="empty-note">No changes in any repository.</p>}
        {clean.length > 0 && (
          <button className="link-btn clean-toggle" onClick={() => setShowClean(!showClean)} aria-expanded={showClean} title="Repositories without uncommitted changes">
            <Icon name={showClean ? "expand_less" : "expand_more"} size={14} /> {clean.length} {clean.length === 1 ? "repo" : "repos"} with no changes · {showClean ? "Hide" : "Show"}
          </button>
        )}
        {rootOpen && showClean && clean.map(repoNode)}
        <button className="link-btn clean-toggle" onClick={() => setShowWorktrees(!showWorktrees)} aria-expanded={showWorktrees}>
          <Icon name={showWorktrees ? "expand_less" : "expand_more"} size={14} /> Worktrees
        </button>
        {showWorktrees && repos.filter((r) => r.kind !== "worktree").map((r) => <Worktrees key={r.path} project={project} repo={r} all={all} label={labelOf(r)} />)}
      </div>

      <div className="commit-area">
        {note && (
          <div className="commit-note" role="status">
            <Icon name="info" size={13} /> {note}
          </div>
        )}
        <div className="row commit-opts">
          <label className="check inline">
            <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} disabled={!sel.repo && !changed.length} />
            <span>Amend last commit</span>
          </label>
          <span className="spacer" />
          <button
            className="btn small"
            title={checked.length ? `Generate a commit message with ${provider.label} from the checked files` : "Check files to generate a message"}
            onClick={generate}
            disabled={!!busy || !checked.length}
          >
            {busy === "ai" ? <Spinner size={12} /> : <Icon name="auto_awesome" size={14} />} Generate
          </button>
        </div>
        {selRepo && (
          <div className="commit-target" style={{ "--repo-color": colorOf(selRepo) } as CSSProperties} title={commitLabel}>
            {amend ? "Amend last commit in" : "Commit to"} <span className="repo-swatch" /> <b className="ellipsis">{label}</b>
            <span className="dim nowrap">· {checked.length} {checked.length === 1 ? "file" : "files"}</span>
          </div>
        )}
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={selRepo ? `Commit message for ${label} (⌘⏎ to commit)` : "Commit message"}
          rows={5}
          onKeyDown={(e) => e.key === "Enter" && e.metaKey && commit(false)}
        />
        <div className="row gap">
          <button className="btn primary grow" disabled={!!busy || !msg.trim() || (!checked.length && !amend)} onClick={() => commit(false)} title={commitLabel}>
            {busy === "commit" ? <Spinner size={12} /> : <Icon name="check" size={14} />} {amend ? "Amend" : "Commit"}
          </button>
          <button className="btn" disabled={!!busy || !msg.trim() || (!checked.length && !amend)} onClick={() => commit(true)} title="Commit, then push this repository">
            {busy === "commit-push" ? <Spinner size={12} /> : <Icon name="upload" size={14} />} Commit and Push
          </button>
        </div>
      </div>
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

function Worktrees({ project, repo, all, label }: { project: Project; repo: Repo; all: Repo[]; label: string }) {
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
        <span className="ellipsis">{label}</span>
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
