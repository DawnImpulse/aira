import { useState, type CSSProperties, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type ProjectIcon as ProjectIconValue } from "../ipc";
import { addSpace, basename, isUnder, joinPath, notify, openFile, removeProject, removeSpace, updateProject, updateSpace, useStore } from "../store";
import { isSingleEmoji, PROJECT_COLORS, PROJECT_EMOJIS, PROJECT_ICONS } from "../lib/identity";
import { AGENTS } from "../lib/agents";
import { cx, Icon, Modal, ProjectIcon } from "./ui";

const VISIBLE = 30; // 3 rows of 10; the rest sit under "More" (collapsed by default)

/** Add or edit a space: just a name and a folder (spaces take their project's identity). */
export function SpaceDialog({ projectId, spaceId, dir: presetDir, onClose }: { projectId: string; spaceId?: string; dir?: string; onClose: () => void }) {
  const project = useStore((s) => s.config.projects.find((p) => p.id === projectId));
  const space = project?.spaces.find((s) => s.id === spaceId);
  const [name, setName] = useState(space?.name ?? (presetDir ? basename(presetDir) : ""));
  const [dir, setDir] = useState(space?.dir ?? presetDir ?? "");
  if (!project) return null;
  const isPrimary = !!space && space.dir === project.path;

  const choose = async () => {
    const d = await openDialog({ directory: true, defaultPath: dir || project.path, title: "Space folder" });
    if (typeof d !== "string") return;
    setDir(d);
    if (!name.trim()) setName(basename(d));
  };
  const save = () => {
    if (space) updateSpace(projectId, space.id, { name, ...(isPrimary || !dir ? {} : { dir }) });
    else if (dir) addSpace(projectId, { name, dir });
    else return;
    onClose();
  };

  return (
    <Modal title={space ? "Space settings" : "Add space"} subtitle={project.name} onClose={onClose} width={460}>
      <form
        className="form"
        style={{ "--project-color": project.color ?? "var(--accent)" } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={dir ? basename(dir) : "Name"} />
        </label>
        <div className="field">
          <span>Folder</span>
          <div className="row gap">
            <code className="path-box" title={dir}>{dir || "Choose a folder…"}</code>
            <button type="button" className="btn" onClick={choose} disabled={isPrimary} title="Pick the space's folder (inside or outside the project)">Choose…</button>
          </div>
          <small className="dim">
            {isPrimary ? "Primary space: the project folder." : dir && !isUnder(dir, project.path) ? "Outside the project folder." : "A folder inside (or outside) the project."}
          </small>
        </div>
        <div className="form-actions">
          {space && !isPrimary && (
            <button type="button" className="btn danger" onClick={() => removeSpace(projectId, space.id).then(onClose)}>
              <Icon name="delete" size={14} /> Remove space
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!space && !dir}>{space ? "Save" : "Add space"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** First `VISIBLE` items, the rest behind a collapsed "More" toggle. */
function Collapsible<T>({ items, render, label }: { items: T[]; render: (item: T) => ReactNode; label: string }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <div className="icon-grid">{items.slice(0, VISIBLE).map(render)}</div>
      {items.length > VISIBLE && (
        <>
          <button type="button" className="link-btn more-toggle" onClick={() => setMore(!more)} aria-expanded={more}>
            <Icon name={more ? "expand_less" : "expand_more"} size={14} /> {more ? "Fewer" : `More ${label}`} ({items.length - VISIBLE})
          </button>
          {more && <div className="icon-grid">{items.slice(VISIBLE).map(render)}</div>}
        </>
      )}
    </>
  );
}

/** Project name, icon (symbol / emoji / image from the project), color, and removal. */
export function ProjectDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.config.projects.find((p) => p.id === projectId));
  const [name, setName] = useState(project?.name ?? "");
  const [icon, setIcon] = useState<ProjectIconValue | undefined>(project?.icon);
  const [color, setColor] = useState(project?.color);
  const [tab, setTab] = useState<ProjectIconValue["type"]>(project?.icon?.type ?? "symbol");
  const [emojiText, setEmojiText] = useState(project?.icon?.type === "emoji" ? project.icon.value : "");
  if (!project) return null;
  const tint = color ?? "var(--accent)";

  const pickImage = async () => {
    const f = await openDialog({ defaultPath: project.path, title: "Project icon (PNG or SVG inside the project)", filters: [{ name: "Images", extensions: ["png", "svg"] }] });
    if (typeof f !== "string") return;
    if (!isUnder(f, project.path)) return notify("Pick an image inside the project folder.");
    setIcon({ type: "image", value: f });
  };
  const typedEmoji = (v: string) => {
    setEmojiText(v);
    if (isSingleEmoji(v)) setIcon({ type: "emoji", value: v.trim() });
  };
  const save = () => {
    updateProject(projectId, { name, icon, color });
    onClose();
  };
  const tile = (selected: boolean, onClick: () => void, title: string, child: ReactNode) => (
    <button type="button" key={title} className={cx("icon-choice", selected && "on")} title={title} aria-label={title} aria-pressed={selected} onClick={onClick}>
      {child}
    </button>
  );

  return (
    <Modal title="Project settings" subtitle={project.name} onClose={onClose} width={500}>
      <form
        className="form"
        style={{ "--project-color": tint } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <div className="row gap">
            <span className="icon-preview" title="Current icon">
              <ProjectIcon icon={icon} color={tint} size={22} />
            </span>
            <input className="grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={basename(project.path)} />
          </div>
        </label>

        <div className="field">
          <span>Icon</span>
          <div className="segmented">
            {(["symbol", "emoji", "image"] as const).map((t) => (
              <button type="button" key={t} className={cx(tab === t && "on")} onClick={() => setTab(t)}>
                <Icon name={t === "symbol" ? "category" : t === "emoji" ? "mood" : "image"} size={14} /> {t === "symbol" ? "Icon" : t === "emoji" ? "Emoji" : "Image"}
              </button>
            ))}
          </div>
          {tab === "symbol" && (
            <Collapsible
              items={PROJECT_ICONS}
              label="icons"
              render={(i) => tile(icon?.type === "symbol" && icon.value === i, () => setIcon({ type: "symbol", value: i }), i, <Icon name={i} size={18} />)}
            />
          )}
          {tab === "emoji" && (
            <>
              <Collapsible
                items={PROJECT_EMOJIS}
                label="emoji"
                render={(e) => tile(icon?.type === "emoji" && icon.value === e, () => typedEmoji(e), e, <span className="emoji-tile">{e}</span>)}
              />
              <input value={emojiText} onChange={(e) => typedEmoji(e.target.value)} placeholder="Or type / paste any emoji (⌃⌘Space opens the picker)" aria-label="Emoji" />
              {emojiText && !isSingleEmoji(emojiText) && <small className="red">Enter exactly one emoji.</small>}
            </>
          )}
          {tab === "image" && (
            <div className="row gap">
              <button type="button" className="btn" onClick={pickImage} title="PNG or SVG file inside this project">
                <Icon name="image" size={14} /> Use image from project…
              </button>
              {icon?.type === "image" && <code className="path-box" title={icon.value}>{icon.value.slice(project.path.length + 1)}</code>}
            </div>
          )}
        </div>

        <div className="field">
          <span>Color</span>
          <div className="swatches">
            <button type="button" className={cx("swatch none", !color && "on")} title="Default (accent)" aria-label="Default color" onClick={() => setColor(undefined)} />
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} className={cx("swatch", color === c && "on")} style={{ background: c }} title={c} aria-label={c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <AgentTracking projectId={projectId} />

        <div className="form-actions">
          <button type="button" className="btn danger" onClick={() => removeProject(projectId).then(() => !useStore.getState().config.projects.some((p) => p.id === projectId) && onClose())}>
            <Icon name="delete" size={14} /> Remove project
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** Opt-in hook files per agent (plan 004): see what's enabled, remove the files, or enable again. */
function AgentTracking({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.config.projects.find((p) => p.id === projectId));
  const repos = useStore((s) => s.repos[projectId]);
  const repoAgents = AGENTS.filter((a) => a.observe === "repo" && project?.agentHooks?.[a.id]);
  if (!project || !repoAgents.length) return null;
  const set = async (agent: string, on: boolean) => {
    if (!on) {
      // Remove the IDE's file from every repo of the project (only files still identical to ours).
      for (const r of repos?.filter((x) => x.kind !== "worktree") ?? [{ path: project.path }]) {
        await api.agentRepoHooks(agent, r.path, false).catch(notify);
      }
    }
    useStore.setState((s) => ({
      config: {
        ...s.config,
        projects: s.config.projects.map((p) => (p.id === projectId ? { ...p, agentHooks: { ...p.agentHooks, [agent]: on ? "on" : "off" } } : p)),
      },
    }));
  };
  return (
    <div className="field">
      <span>Agent tracking files</span>
      {repoAgents.map((a) => {
        const on = project.agentHooks?.[a.id] === "on";
        return (
          <div key={a.id} className="row gap tracking-row">
            <span className="grow ellipsis">
              <b>{a.label}</b> <code className="dim">{a.repoFiles}</code>
            </span>
            <button type="button" className="btn small" onClick={() => set(a.id, !on)} title={on ? "Delete the IDE's hook file from this project" : "Create it at the next launch"}>
              {on ? "Remove files" : "Enable"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Creates an empty file or folder inside `dir` (never overwrites). */
export function NewPathDialog({ dir, isDir, onClose }: { dir: string; isDir: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const clean = name.trim();
  const valid = !!clean && !clean.includes("/") && clean !== "." && clean !== "..";
  const create = async () => {
    if (!valid) return;
    const path = joinPath(dir, clean);
    try {
      await api.createPath(path, isDir);
      onClose();
      if (!isDir) openFile(path, true);
    } catch (e) {
      notify(e);
    }
  };
  return (
    <Modal title={isDir ? "New folder" : "New file"} subtitle={basename(dir)} onClose={onClose} width={420}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isDir ? "folder-name" : "file.ts"} spellCheck={false} aria-label="Name" />
        {clean.includes("/") && <small className="red">Names can't contain "/".</small>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid}>Create</button>
        </div>
      </form>
    </Modal>
  );
}
