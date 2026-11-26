import { useEffect, useState } from "react";
import type { PortInfo, Project } from "../ipc";
import { ago, formatBytes, isFailed, focusTerminal, projectById, repoOf, selectActiveSpace, useStore, type Term } from "../store";
import { removeTerm, renameTerm, stop as stopTerm } from "../lib/terminals";
import { expectedPorts, freePort, projectOfPort, refreshPorts, termOfPort, type Expected } from "../lib/ports";
import { usageLabel, usageTitle } from "../lib/usage";
import { AgentIcon, cx, Icon, IconButton, ProjectIcon, stop, useOutsideClose, useOverlay } from "./ui";

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
  const [portsOpen, setPortsOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  useOverlay(open || portsOpen || noticesOpen);
  const unseen = useStore((s) => Object.values(s.agentStatus).filter((a) => a.unseen).length);
  const ports = useStore((s) => s.ports);
  const ours = ports.filter((p) => projectOfPort(p)).length;
  const live = Object.values(terms).filter((t) => t.status === "running" || t.status === "stopping");
  const update = useStore((s) => s.update);
  const updatePill = update?.hidden && (update.stage === "available" || update.stage === "installed");
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
        {updatePill && (
          <button className="status-btn update-pill" onClick={() => useStore.setState({ update: { ...update, hidden: false } })} title="Show the update">
            <Icon name="system_update_alt" size={13} /> {update.stage === "installed" ? "Restart to update" : `Update ${update.version}`}
          </button>
        )}
        <ClaudeUsageItem />
        </span>
        <div className="popover-anchor">
          <button className={cx("status-btn", portsOpen && "on")} onClick={() => setPortsOpen(!portsOpen)} title="Ports used by your projects: find and free them">
            <Icon name="lan" size={13} /> {ours ? `${ours} port${ours > 1 ? "s" : ""}` : "Ports"}
          </button>
          {portsOpen && <PortsPopover onClose={() => setPortsOpen(false)} />}
        </div>
        <div className="popover-anchor">
          <button className={cx("status-btn", noticesOpen && "on")} onClick={() => setNoticesOpen(!noticesOpen)} title="Agent notifications: finished, needs input, exited">
            <Icon name={unseen ? "notifications_unread" : "notifications"} size={13} className={unseen ? "amber" : undefined} />
            {unseen > 0 && unseen}
          </button>
          {noticesOpen && <NoticesPopover onClose={() => setNoticesOpen(false)} />}
        </div>
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

/**
 * Ports per project: what its scripts/terminals listen on, what blocks a port its scripts expect,
 * and expected ports that are free. Searching lists whatever listens on matching ports.
 */
function PortsPopover({ onClose }: { onClose: () => void }) {
  const ports = useStore((s) => s.ports);
  const projects = useStore((s) => s.config.projects);
  const scripts = useStore((s) => s.config.scripts);
  const [q, setQ] = useState("");
  const [expected, setExpected] = useState<Record<string, Expected[]>>({});
  const ref = useOutsideClose(onClose);
  useEffect(() => void refreshPorts(), []);
  useEffect(() => {
    let alive = true;
    Promise.all(projects.map(async (p) => [p.id, await expectedPorts(p)] as const)).then((e) => alive && setExpected(Object.fromEntries(e)));
    return () => {
      alive = false;
    };
  }, [projects, scripts]);
  const query = q.trim().replace(/^:/, "");
  const hits = ports.filter((p) => String(p.port).startsWith(query)).sort((a, b) => a.port - b.port);
  const sections = projects.map((p) => <ProjectPorts key={p.id} project={p} all={ports} expected={expected[p.id] ?? []} onOpen={onClose} />);
  return (
    <div className="popover up wide ports-popover" ref={ref}>
      <input autoFocus placeholder="Search a port, e.g. 3000" inputMode="numeric" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a port" />
      {query ? (
        hits.length ? (
          hits.map((p) => <PortRow key={`${p.pid}:${p.port}`} p={p} label={termOfPort(p)?.name ?? p.cwd ?? ""} onOpen={onClose} />)
        ) : (
          <div className="empty-note">No process of yours is listening on :{query}.</div>
        )
      ) : (
        sections
      )}
    </div>
  );
}

function ProjectPorts({ project, all, expected, onOpen }: { project: Project; all: PortInfo[]; expected: Expected[]; onOpen: () => void }) {
  // Its own listeners, plus those of scripts linked in from other projects.
  const mine = all
    .filter((p) => projectOfPort(p) === project.id || project.scriptIds.includes(termOfPort(p)?.scriptId ?? ""))
    .sort((a, b) => a.port - b.port);
  const expectedBy = (port: number) => expected.find((e) => e.port === port)?.label;
  // An expected port held by something outside this project is what usually breaks `dev`.
  const blocked = expected.flatMap((e) => all.filter((p) => p.port === e.port && !mine.includes(p)).map((p) => ({ p, e })));
  const free = expected.filter((e) => !all.some((p) => p.port === e.port));
  if (!mine.length && !blocked.length && !free.length) return null;
  return (
    <>
      <div className="menu-label ports-project">
        <ProjectIcon icon={project.icon} color={project.color} size={12} /> {project.name}
      </div>
      {mine.map((p) => {
        const by = expectedBy(p.port);
        return <PortRow key={`${p.pid}:${p.port}`} p={p} label={termOfPort(p)?.name ?? `outside Aira${by ? ` · ${by}` : ""}`} onOpen={onOpen} />;
      })}
      {blocked.map(({ p, e }) => (
        <PortRow key={`b${p.pid}:${p.port}`} p={p} label={`blocks ${e.label}`} warn onOpen={onOpen} />
      ))}
      {free.map((e) => (
        <div key={`f${e.port}`} className="menu-item port-row free" title={e.guessed ? "Guessed from the command" : "Seen on an earlier run"}>
          <span className="port-num">:{e.port}</span>
          <span className="ellipsis dim">
            {e.label}
            {e.guessed && " (guess)"}
          </span>
          <span className="port-free">free</span>
        </div>
      ))}
    </>
  );
}

function PortRow({ p, label, warn, onOpen }: { p: PortInfo; label: string; warn?: boolean; onOpen: () => void }) {
  const t = termOfPort(p);
  return (
    <div
      className={cx("menu-item port-row", warn && "warn")}
      title={`${p.cmd}${p.cwd ? `\n${p.cwd}` : ""}${t ? "\nClick to open its terminal" : ""}`}
      onClick={() => {
        if (!t) return;
        focusTerminal(t.key);
        onOpen();
      }}
    >
      <span className="port-num">:{p.port}</span>
      <span className="ellipsis">{label}</span>
      <span className="dim mono">
        {p.name} {p.pid}
      </span>
      <IconButton icon="close" title={t?.scriptId ? "Stop the script" : "Force close this process"} className="red" onClick={stop(() => freePort(p))} />
    </div>
  );
}

function NoticesPopover({ onClose }: { onClose: () => void }) {
  const notices = useStore((s) => s.notices);
  const agentStatus = useStore((s) => s.agentStatus);
  const terms = useStore((s) => s.terms);
  const ref = useOutsideClose(onClose);
  return (
    <div className="popover up wide" ref={ref}>
      <div className="menu-label notices-head">
        Notifications
        {notices.length > 0 && <IconButton icon="clear_all" title="Clear the list" onClick={stop(() => useStore.setState({ notices: [] }))} />}
      </div>
      {!notices.length && <div className="empty-note">Nothing yet. Agents that finish, ask or exit while you're elsewhere show up here.</div>}
      {notices.map((n) => (
        <div
          key={`${n.key}:${n.at}`}
          className={cx("menu-item notice-row", agentStatus[n.key]?.unseen && "unseen")}
          onClick={() => {
            focusTerminal(n.key);
            onClose();
          }}
          title={terms[n.key]?.cwd}
        >
          <AgentIcon agent={terms[n.key]?.agent} size={14} />
          <span className="ellipsis">
            {n.title} – {n.body}
          </span>
          <span className="dim">{ago(n.at)}</span>
        </div>
      ))}
    </div>
  );
}

function TerminalsPopover({ onClose }: { onClose: () => void }) {
  const terms = useStore((s) => s.terms);
  const sessions = useStore((s) => s.mem.sessions);
  const ref = useOutsideClose(onClose);
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
  const usage = useStore((s) => s.usage[t.key]);
  const live = t.status === "running" || t.status === "stopping";
  return (
    <div
      className="menu-item term-row"
      onClick={() => {
        focusTerminal(t.key);
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
      {usage && (
        <span className="dim mono" title={usageTitle(usage)}>
          {usageLabel(usage)}
        </span>
      )}
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
