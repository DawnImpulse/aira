import { useEffect, useRef, useState } from "react";
import { formatBytes, isFailed, openTerminalTab, projectById, repoOf, selectActiveSpace, useStore, type Term } from "../store";
import { removeTerm, renameTerm, stop as stopTerm } from "../lib/terminals";
import { cx, Icon, IconButton, stop } from "./ui";

export function StatusBar() {
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const st = useStore((s) => {
    const space = selectActiveSpace(s);
    const repo = space && repoOf(space.dir);
    return repo ? s.status[repo.path] : undefined;
  });
  const mem = useStore((s) => s.mem);
  const terms = useStore((s) => s.terms);
  const [open, setOpen] = useState(false);
  const live = Object.values(terms).filter((t) => t.status === "running" || t.status === "stopping");
  const termMem = Object.values(mem.sessions).reduce((a, b) => a + b, 0);

  return (
    <footer className="statusbar">
      <div className="status-left">
        {project && (
          <span>
            <Icon name="data_object" size={13} /> {project.name}
          </span>
        )}
        {st && (
          <span>
            <Icon name="alt_route" size={13} /> {st.branch ?? "detached"}
            {st.ahead > 0 && ` ↑${st.ahead}`}
            {st.behind > 0 && ` ↓${st.behind}`}
          </span>
        )}
      </div>
      <div className="status-right">
        <span title={`App ${formatBytes(mem.app)} + terminals ${formatBytes(termMem)} (resident memory)`}>
          <Icon name="memory" size={13} /> {formatBytes(mem.app + termMem)}
        </span>
        <div className="popover-anchor">
          <button className={cx("status-btn", open && "on")} onClick={() => setOpen(!open)}>
            <Icon name="terminal" size={13} className={live.length ? "green" : undefined} /> {live.length} running
          </button>
          {open && <TerminalsPopover onClose={() => setOpen(false)} />}
        </div>
      </div>
    </footer>
  );
}

function TerminalsPopover({ onClose }: { onClose: () => void }) {
  const terms = useStore((s) => s.terms);
  const sessions = useStore((s) => s.mem.sessions);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const rank = (t: Term) => (t.status === "running" || t.status === "stopping" ? 0 : 1);
  const list = Object.values(terms).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return (
    <div className="popover up wide" ref={ref}>
      <div className="menu-label">Terminals</div>
      {!list.length && <div className="empty-note">No terminals.</div>}
      {list.map((t) => (
        <TermRow key={t.key} t={t} mem={t.sessionId ? sessions[t.sessionId] : undefined} onOpen={onClose} />
      ))}
    </div>
  );
}

function TermRow({ t, mem, onOpen }: { t: Term; mem?: number; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const live = t.status === "running" || t.status === "stopping";
  return (
    <div
      className="menu-item term-row"
      onClick={() => {
        openTerminalTab(t.key);
        onOpen();
      }}
      title={t.cwd}
    >
      <span className={cx("dot", live ? "green" : isFailed(t) ? "red" : "grey")} />
      {editing ? (
        <input
          className="inline-input"
          autoFocus
          defaultValue={t.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            renameTerm(t.key, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="ellipsis"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {t.name}
        </span>
      )}
      <span className="dim">{projectById(t.projectId)?.name ?? ""}</span>
      <span className="dim mono">{mem !== undefined ? formatBytes(mem) : ""}</span>
      <IconButton icon="edit" title="Rename" onClick={stop(() => setEditing(true))} />
      {live ? (
        <IconButton icon="stop" title="Stop" className="red" onClick={stop(() => stopTerm(t.key))} />
      ) : (
        !t.scriptId && <IconButton icon="close" title="Remove" onClick={stop(() => removeTerm(t.key, true))} />
      )}
    </div>
  );
}
