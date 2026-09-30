import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../ipc";
import { addSpace, basename, isUnder, joinPath, notify, openFile, removeSpace, updateProject, updateSpace, useStore } from "../store";
import { cx, Icon, Modal } from "./ui";

export const SPACE_ICONS = [
  "data_object", "code", "terminal", "rocket_launch", "api", "cloud", "database", "dns",
  "web", "smartphone", "desktop_mac", "bolt", "science", "bug_report", "palette", "extension",
  "hub", "memory", "layers", "deployed_code", "psychology", "auto_awesome", "school", "work",
  "home", "favorite", "flag", "shopping_cart", "sports_esports", "token",
];
export const SPACE_COLORS = ["#6aa8ff", "#3fcf6e", "#e6b450", "#ff6b6b", "#c084fc", "#f472b6", "#22d3ee", "#fb923c", "#a3e635", "#94a3b8"];

/** Add/edit a space, or edit a project's name, icon and color. */
export function SpaceDialog({
  projectId, spaceId, dir: presetDir, editProject, onClose,
}: {
  projectId: string;
  spaceId?: string;
  dir?: string;
  editProject?: boolean;
  onClose: () => void;
}) {
  const project = useStore((s) => s.config.projects.find((p) => p.id === projectId));
  const space = project?.spaces.find((s) => s.id === spaceId);
  const current = editProject ? project : space;
  const [name, setName] = useState(current?.name ?? (presetDir ? basename(presetDir) : ""));
  const [dir, setDir] = useState(space?.dir ?? presetDir ?? "");
  const [icon, setIcon] = useState(current?.icon);
  const [color, setColor] = useState(current?.color);
  if (!project) return null;
  const isPrimary = !!space && space.dir === project.path;
  const adding = !editProject && !space;

  const choose = async () => {
    const d = await openDialog({ directory: true, defaultPath: dir || project.path, title: "Space folder" });
    if (typeof d !== "string") return;
    setDir(d);
    if (!name.trim()) setName(basename(d));
  };

  const save = () => {
    if (editProject) updateProject(projectId, { name, icon, color });
    else if (space) updateSpace(projectId, space.id, { name, icon, color, ...(isPrimary || !dir ? {} : { dir }) });
    else if (dir) addSpace(projectId, { name, dir, icon, color });
    else return;
    onClose();
  };

  return (
    <Modal title={editProject ? "Project settings" : adding ? "Add space" : "Space settings"} subtitle={project.name} onClose={onClose} width={480}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={dir ? basename(dir) : "Name"} />
        </label>

        {!editProject && (
          <div className="field">
            <span>Folder</span>
            <div className="row gap">
              <code className="path-box" title={dir}>{dir || "Choose a folder…"}</code>
              <button type="button" className="btn" onClick={choose} disabled={isPrimary}>Choose…</button>
            </div>
            <small className="dim">
              {isPrimary ? "Primary space: the project folder." : dir && !isUnder(dir, project.path) ? "Outside the project folder." : "A folder inside (or outside) the project."}
            </small>
          </div>
        )}

        <div className="field">
          <span>Icon</span>
          <div className="icon-grid">
            {SPACE_ICONS.map((i) => (
              <button type="button" key={i} className={cx("icon-choice", icon === i && "on")} title={i} aria-label={i} aria-pressed={icon === i} onClick={() => setIcon(icon === i ? undefined : i)}>
                <Icon name={i} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Color</span>
          <div className="row gap">
            <button type="button" className={cx("swatch none", !color && "on")} title="Default" aria-label="Default color" onClick={() => setColor(undefined)} />
            {SPACE_COLORS.map((c) => (
              <button type="button" key={c} className={cx("swatch", color === c && "on")} style={{ background: c }} title={c} aria-label={c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <div className="form-actions">
          {space && !isPrimary && (
            <button type="button" className="btn danger" onClick={() => removeSpace(projectId, space.id).then(onClose)}>
              <Icon name="delete" size={14} /> Remove space
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={adding && !dir}>{adding ? "Add space" : "Save"}</button>
        </div>
      </form>
    </Modal>
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
