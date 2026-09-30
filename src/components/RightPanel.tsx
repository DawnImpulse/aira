import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type DirEntry, type Project, type Space } from "../ipc";
import {
  addSpace, basename, dirname, gitReposOf, joinPath, notify, onFsChange, openFile, selectActiveSpace, updateConfig, useStore,
} from "../store";
import { newTerminal } from "../lib/terminals";
import { popupMenu, type MenuEntry } from "../lib/menu";
import { dirIconUrl, fileIconUrl } from "../lib/icons";
import { GitPanel } from "./GitPanel";
import { cx, Icon, IconButton, stop } from "./ui";

export function RightPanel() {
  const view = useStore((s) => s.config.layout.rightView);
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const space = useStore(selectActiveSpace);
  const changes = useStore((s) =>
    project ? gitReposOf(project, s.repos[project.id]).reduce((n, r) => n + (s.status[r.path]?.files.length ?? 0), 0) : 0,
  );
  const setView = (v: "files" | "git") => updateConfig((c) => void (c.layout.rightView = v));
  return (
    <div className="panel right-panel">
      <div className="panel-head">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={view === "files"} className={cx(view === "files" && "on")} onClick={() => setView("files")}>
            <Icon name="folder" size={14} /> Files
          </button>
          <button role="tab" aria-selected={view === "git"} className={cx(view === "git" && "on")} onClick={() => setView("git")}>
            <Icon name="account_tree" size={14} /> Git {changes > 0 && <span className="count">{changes}</span>}
          </button>
        </div>
      </div>
      {!project || !space ? (
        <div className="empty-hint">
          <p>No project selected.</p>
        </div>
      ) : view === "files" ? (
        // Keyed by dir: switching spaces starts a fresh tree (no stale expansion/listings).
        <FileTree key={space.dir} project={project} space={space} />
      ) : (
        <GitPanel project={project} />
      )}
    </div>
  );
}

const LETTER_CLASS: Record<string, string> = { M: "st-mod", T: "st-mod", A: "st-add", U: "st-add", D: "st-del", "!": "st-del", R: "st-ren", C: "st-ren" };

const newPath = (dir: string, isDir: boolean) => useStore.setState({ dialog: { kind: "newPath", dir, isDir } });

async function addAsSpace(project: Project, dir: string) {
  if (!(await ask(`Add "${basename(dir)}" as a nested space of ${project.name}? Nothing on disk changes.`, { title: "Add nested space", okLabel: "Add space" })))
    return;
  addSpace(project.id, { name: basename(dir), dir });
}

function FileTree({ project, space }: { project: Project; space: Space }) {
  const root = space.dir;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]));
  const [kids, setKids] = useState<Record<string, DirEntry[]>>({});
  const kidsRef = useRef(kids);
  kidsRef.current = kids;
  const activePath = useStore((s) => {
    const t = s.config.layout.tabs.find((x) => x.id === s.config.layout.activeTab);
    return t?.kind === "file" ? t.path : null;
  });
  const repos = useStore((s) => s.repos[project.id]);
  const status = useStore((s) => s.status);
  const spaceDirs = new Set(project.spaces.map((s) => s.dir));

  const load = useCallback(async (dir: string) => {
    const list = await api.readDir(dir).catch(() => null);
    setKids((k) => {
      if (list) return { ...k, [dir]: list };
      const { [dir]: _, ...rest } = k; // deleted dir
      return rest;
    });
  }, []);

  useEffect(() => void load(root), [root, load]);
  useEffect(
    () =>
      onFsChange((paths) => {
        const dirs = new Set<string>();
        for (const p of paths) {
          if (kidsRef.current[dirname(p)]) dirs.add(dirname(p));
          if (kidsRef.current[p]) dirs.add(p);
        }
        dirs.forEach(load);
      }),
    [load],
  );

  // Git decorations: file → letter, plus every ancestor dir of a change.
  const deco = useMemo(() => {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    for (const r of repos ?? []) {
      for (const f of status[r.path]?.files ?? []) {
        const abs = joinPath(r.path, f.path.replace(/\/$/, ""));
        files.set(abs, f.conflict ? "!" : f.x === "?" ? "U" : f.y !== "." ? f.y : f.x);
        for (let d = dirname(abs); d.length > root.length; d = dirname(d)) dirs.add(d);
      }
    }
    return { files, dirs };
  }, [repos, status, root]);

  const toggle = (dir: string) => {
    const next = new Set(expanded);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      if (!kids[dir]) load(dir);
    }
    setExpanded(next);
  };

  /** Native menu for a row (or the root when `e` is the folder itself). */
  const rowMenu = (ev: MouseEvent, e: DirEntry) => {
    ev.preventDefault();
    ev.stopPropagation();
    const dir = e.dir ? e.path : dirname(e.path);
    const items: MenuEntry[] = [
      { text: "New File…", action: () => newPath(dir, false) },
      { text: "New Folder…", action: () => newPath(dir, true) },
      "-",
    ];
    if (e.dir && !spaceDirs.has(e.path)) items.push({ text: "Add as Nested Space…", action: () => addAsSpace(project, e.path) }, "-");
    if (!e.dir) items.push({ text: "Open", action: () => openFile(e.path, true) });
    items.push(
      { text: "Open Terminal Here", action: () => newTerminal(project.id, { cwd: dir }) },
      { text: "Reveal in Finder", action: () => revealItemInDir(e.path).catch(notify) },
      { text: "Copy Path", action: () => api.copyText(e.path).catch(notify) },
    );
    popupMenu(items);
  };

  const rows: ReactNode[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of kids[dir] ?? []) {
      const open = e.dir && expanded.has(e.path);
      const letter = deco.files.get(e.path);
      rows.push(
        <div
          key={e.path}
          className={cx("tree-row", activePath === e.path && "selected", letter ? LETTER_CLASS[letter] : e.dir && deco.dirs.has(e.path) && "st-dir")}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (e.dir ? toggle(e.path) : openFile(e.path))}
          onDoubleClick={() => !e.dir && openFile(e.path, true)}
          onContextMenu={(ev) => rowMenu(ev, e)}
          title={e.path}
        >
          {e.dir ? <Icon name={open ? "expand_more" : "chevron_right"} size={14} className="chev" /> : <span className="chev" />}
          <img className="file-icon" src={e.dir ? dirIconUrl(e.path, open) : fileIconUrl(e.path)} alt="" />
          <span className="ellipsis">{e.name}</span>
          {e.dir && spaceDirs.has(e.path) && <Icon name="workspaces" size={13} className="accent" title="Nested space" />}
          {e.dir && (
            <span className="hover-actions">
              {!spaceDirs.has(e.path) && <IconButton icon="workspaces" size={14} title="Add as nested space" onClick={stop(() => addAsSpace(project, e.path))} />}
              <IconButton
                icon="add"
                size={14}
                title="New file or folder here"
                onClick={(ev) => {
                  ev.stopPropagation();
                  popupMenu([
                    { text: "New File…", action: () => newPath(e.path, false) },
                    { text: "New Folder…", action: () => newPath(e.path, true) },
                  ]);
                }}
              />
            </span>
          )}
          {letter && !e.dir && <span className="letter">{letter}</span>}
        </div>,
      );
      if (open) walk(e.path, depth + 1);
    }
  };
  walk(root, 0);

  return (
    <div className="tree" onContextMenu={(ev) => rowMenu(ev, { name: basename(root), path: root, dir: true })}>
      <div className="sub-head">
        <Icon name={space.icon ?? "folder"} size={13} color={space.color} />
        <span className="ellipsis" title={root}>{space.name}</span>
        <span className="hover-actions always">
          <IconButton
            icon="add"
            title="New file or folder"
            onClick={() =>
              popupMenu([
                { text: "New File…", action: () => newPath(root, false) },
                { text: "New Folder…", action: () => newPath(root, true) },
              ])
            }
          />
          <IconButton icon="unfold_less" title="Collapse all" onClick={() => setExpanded(new Set([root]))} />
          <IconButton icon="refresh" title="Refresh" onClick={() => [...expanded].forEach(load)} />
          <IconButton icon="folder_open" title="Reveal in Finder" onClick={() => revealItemInDir(root).catch(notify)} />
        </span>
      </div>
      <div className="scroll">{rows}</div>
    </div>
  );
}
