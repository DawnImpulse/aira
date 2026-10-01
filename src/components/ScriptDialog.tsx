import { useEffect, useState } from "react";
import type { Script } from "../ipc";
import { joinPath, linkScript, pickFolder, projectById, projectOf, saveScript, uid, useStore } from "../store";
import { newTerminal, runScript } from "../lib/terminals";
import { availableRunners, detectScripts, RUNNERS, runnerById, type Detected } from "../lib/runners";
import { iconUrl } from "../lib/icons";
import { cx, Icon, Modal } from "./ui";

export function ScriptDialog({ projectId, scriptId, preset, onClose }: { projectId: string; scriptId?: string; preset?: Partial<Script>; onClose: () => void }) {
  const existing = useStore((s) => (scriptId ? s.config.scripts[scriptId] : undefined));
  const [s, setS] = useState<Script>(
    () => existing ?? { id: uid(), name: "", runner: "", target: "", command: "", cwd: "", ownerProjectId: projectId, ...preset },
  );
  const projects = useStore((st) => st.config.projects);
  // A new script belongs to this project only (link it elsewhere via Link); an edit keeps its links.
  const [targets] = useState<string[]>(() =>
    existing ? projects.filter((p) => p.scriptIds.includes(existing.id)).map((p) => p.id) : [projectId],
  );
  const [avail, setAvail] = useState<Set<string> | null>(null);
  const [detected, setDetected] = useState<Detected[]>([]);
  // Opened from a package.json ▶: the script is already chosen, so skip detection.
  const fromGutter = !existing && !!preset?.target;
  const owner = projectById(s.ownerProjectId);
  const absCwd = owner ? joinPath(owner.path, s.cwd) : s.cwd;

  useEffect(() => void availableRunners().then(setAvail), []);
  useEffect(() => {
    if (fromGutter) return;
    detectScripts(absCwd).then((d) => {
      setDetected(d);
      // New script: default the runner to the folder's package manager.
      setS((cur) => (cur.runner ? cur : { ...cur, runner: d[0]?.runner ?? "custom" }));
    });
  }, [absCwd, fromGutter]);

  const runner = runnerById(s.runner || "custom");
  const command = runner.command(s.target.trim());

  const chooseFolder = async () => {
    const dir = await pickFolder(absCwd, "Working directory");
    if (!dir) return;
    const home = projectOf(dir);
    setS(home ? { ...s, ownerProjectId: home.id, cwd: dir === home.path ? "" : dir.slice(home.path.length + 1) } : { ...s, ownerProjectId: null, cwd: dir });
  };

  const save = (run: boolean) => {
    if (!s.target.trim()) return;
    const script = { ...s, runner: runner.id, name: s.name.trim() || s.target.trim(), target: s.target.trim(), command };
    saveScript(targets, script);
    onClose();
    if (run) runScript(script.id);
  };

  return (
    <Modal
      title={existing ? "Edit script" : "Add script"}
      subtitle={projects.filter((p) => targets.includes(p.id)).map((p) => p.name).join(", ")}
      onClose={onClose}
      width={560}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <label className="field">
          <span>Working directory</span>
          <div className="row">
            <code className="path-box" title={absCwd}>{absCwd}</code>
            <button type="button" className="btn" onClick={chooseFolder}>Choose…</button>
          </div>
          {s.ownerProjectId === null && <small className="dim">External folder – not part of any project</small>}
        </label>

        {detected.length > 0 && (
          <div className="field">
            <span>Detected</span>
            <div className="chips">
              {detected.map((d) => (
                <button
                  type="button"
                  key={`${d.source}:${d.name}`}
                  className={cx("chip-btn", s.target === d.target && s.runner === d.runner && "on")}
                  title={d.source}
                  onClick={() => setS({ ...s, name: s.name || d.name, runner: d.runner, target: d.target })}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span>Runner</span>
          <div className="chips">
            {RUNNERS.map((r) => {
              const missing = avail !== null && !avail.has(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  className={cx("chip-btn", runner.id === r.id && "on", missing && "missing")}
                  title={missing ? `${r.bin} not found on PATH` : r.label}
                  onClick={() => setS({ ...s, runner: r.id })}
                >
                  <img src={iconUrl(r.icon)} alt="" />
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="field">
          <span>{runner.targetLabel}</span>
          <input autoFocus value={s.target} onChange={(e) => setS({ ...s, target: e.target.value })} placeholder={runner.id === "custom" ? "e.g. docker compose up" : "e.g. dev"} spellCheck={false} />
        </label>

        <label className="field">
          <span>Name</span>
          <input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder={s.target || "Name shown in the sidebar"} />
        </label>

        <code className="cmd-preview">$ {command || "…"}</code>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            title="Run once in a terminal without saving the script"
            disabled={!s.target.trim()}
            onClick={() => {
              onClose();
              newTerminal(targets[0], { cwd: absCwd, command, label: s.name.trim() || s.target.trim() });
            }}
          >
            <Icon name="play_arrow" /> Only run
          </button>
          <button type="submit" className="btn" disabled={!s.target.trim()}>Save</button>
          <button type="button" className="btn primary" disabled={!s.target.trim()} onClick={() => save(true)}>
            <Icon name="play_arrow" /> Save & run
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Link scripts owned by other projects (or external ones) into this project. */
export function LinkDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const config = useStore((s) => s.config);
  const project = config.projects.find((p) => p.id === projectId);
  const candidates = Object.values(config.scripts).filter((s) => !project?.scriptIds.includes(s.id));
  const groups = new Map<string, Script[]>();
  for (const s of candidates) {
    const label = config.projects.find((p) => p.id === s.ownerProjectId)?.name ?? "External";
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return (
    <Modal title={`Link script into ${project?.name ?? "project"}`} onClose={onClose}>
      {!candidates.length && <p className="dim">No scripts in other projects yet.</p>}
      {[...groups].map(([label, list]) => (
        <div key={label} className="link-group">
          <div className="sub-head">{label}</div>
          {list.map((s) => (
            <div key={s.id} className="link-row">
              <span className="script-name">{s.name}</span>
              <code className="dim ellipsis">{s.command}</code>
              <button
                className="btn"
                onClick={() => {
                  linkScript(projectId, s.id);
                  onClose();
                }}
              >
                <Icon name="link" /> Link
              </button>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}
