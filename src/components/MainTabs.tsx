import { useEffect, useRef, useState } from "react";
import type { Tab } from "../ipc";
import { activateTab, basename, closeTab, formatBytes, isFailed, isUnder, notify, openFolders, pinTab, selectActiveSpace, useStore } from "../store";
import { attach, newTerminal, renameTerm, restart, runScript, startSession, stop as stopTerm } from "../lib/terminals";
import { AGENTS, availableAgents, type Agent } from "../lib/agents";
import { fileIconUrl } from "../lib/icons";
import { DiffView, FileView } from "./Editors";
import { AgentIcon, cx, Icon, IconButton, Orb, stop } from "./ui";

export function MainTabs() {
  const tabs = useStore((s) => s.config.layout.tabs);
  const active = useStore((s) => s.config.layout.activeTab);
  const current = tabs.find((t) => t.id === active);
  return (
    <div className="main">
      <div className="tabbar-wrap">
        <div className="tabbar" role="tablist">
          {tabs.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === active} />
          ))}
        </div>
        {/* Outside the scrolling tab strip so its popover isn't clipped. */}
        <AgentLauncher />
      </div>
      <RestoreBanner />
      <div className="tab-body">
        {current?.kind === "terminal" && <TerminalView key={current.key} termKey={current.key} />}
        {current?.kind === "file" && <FileView key={current.path} path={current.path} tabId={current.id} />}
        {current?.kind === "diff" && <DiffView key={current.id} tab={current} />}
        {!current && <Welcome />}
      </div>
    </div>
  );
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const term = useStore((s) => (tab.kind === "terminal" ? s.terms[tab.key] : undefined));
  const working = useStore((s) => tab.kind === "terminal" && s.agentStatus[tab.key]?.state === "working" && s.terms[tab.key]?.status === "running");
  const agentColor = AGENTS.find((a) => a.id === term?.agent)?.color;
  const dirty = useStore((s) => tab.kind === "file" && !!s.dirty[tab.path]);
  const [editing, setEditing] = useState(false);
  const preview = tab.kind === "file" && !tab.pinned;
  const title =
    tab.kind === "terminal" ? (term?.name ?? "Terminal") : tab.kind === "file" ? basename(tab.path) : `${basename(tab.path)} (${tab.staged ? "staged" : "working tree"})`;

  return (
    <div
      role="tab"
      aria-selected={active}
      className={cx("tab", active && "active", preview && "preview")}
      onClick={() => activateTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
      onDoubleClick={() => (tab.kind === "terminal" ? setEditing(true) : pinTab(tab.id))}
      title={tab.kind === "terminal" ? term?.cwd : tab.path}
    >
      {tab.kind === "terminal" &&
        (term?.agent ? (
          working ? <Orb state="working" size={20} color={agentColor} title="Working" /> : <AgentIcon agent={term.agent} size={14} />
        ) : (
          <Icon name="terminal" size={14} className={cx(term?.status === "running" ? "green" : isFailed(term) && "red")} />
        ))}
      {tab.kind === "file" && <img className="file-icon" src={fileIconUrl(tab.path)} alt="" />}
      {tab.kind === "diff" && <Icon name="difference" size={14} className="accent" />}
      {editing && term ? (
        <input
          className="inline-input"
          autoFocus
          defaultValue={term.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            renameTerm(term.key, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="tab-title">{title}</span>
      )}
      <button className={cx("tab-close", dirty && "dirty")} title="Close (⌘W)" aria-label="Close tab" onClick={stop(() => closeTab(tab.id))}>
        <Icon name={dirty ? "circle" : "close"} size={dirty ? 9 : 14} />
      </button>
    </div>
  );
}

function TerminalView({ termKey }: { termKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const t = useStore((s) => s.terms[termKey]);
  const mem = useStore((s) => (t?.sessionId ? s.mem.sessions[t.sessionId] : undefined));
  useEffect(() => attach(termKey, host.current!), [termKey]);
  if (!t) return null;
  const live = t.status === "running" || t.status === "stopping";
  const run = () => (t.scriptId ? runScript(t.scriptId) : startSession(termKey));
  return (
    <div className="terminal-view">
      <div className="view-toolbar">
        <Icon name="terminal" size={14} className={live ? "green" : "dim"} />
        <span className="ellipsis">{t.name}</span>
        <code className="dim ellipsis">{t.command ?? t.cwd}</code>
        <span className="spacer" />
        {mem !== undefined && <span className="dim">{formatBytes(mem)}</span>}
        {live ? (
          <>
            {(t.scriptId || t.command) && <IconButton icon="restart_alt" title="Restart" onClick={() => restart(termKey)} />}
            <IconButton icon="stop" title="Stop" className="red" onClick={() => stopTerm(termKey)} />
          </>
        ) : (
          <IconButton icon="play_arrow" title="Run" className="green" onClick={run} />
        )}
      </div>
      <div className="term-host" ref={host} />
      {!live && (
        <div className={cx("term-bar", isFailed(t) && "failed")}>
          <Icon name={isFailed(t) ? "error" : t.status === "exited" && !t.stopped ? "check_circle" : "pause_circle"} size={16} />
          <span>{t.stopped ? "Stopped" : t.status === "exited" ? `Exited with code ${t.exitCode}` : "Not running"}</span>
          <button className="btn primary" onClick={run}>
            <Icon name={t.status === "exited" ? "restart_alt" : "play_arrow"} /> {t.status === "exited" ? "Restart" : "Run"}
          </button>
        </div>
      )}
    </div>
  );
}

function RestoreBanner() {
  const restore = useStore((s) => s.restore);
  const scripts = useStore((s) => s.config.scripts);
  if (!restore.length) return null;
  const dismiss = () => useStore.setState({ restore: [] });
  return (
    <div className="banner">
      <Icon name="history" size={16} />
      <span className="ellipsis">
        {restore.length} script{restore.length > 1 ? "s were" : " was"} running when you quit: {restore.map((id) => scripts[id]?.name).join(", ")}
      </span>
      <button
        className="btn primary"
        onClick={() => {
          restore.forEach((id, i) => runScript(id, i === 0));
          dismiss();
        }}
      >
        Run again
      </button>
      <IconButton icon="close" title="Dismiss" onClick={dismiss} />
    </div>
  );
}

function Welcome() {
  const hasProjects = useStore((s) => s.config.projects.length > 0);
  return (
    <div className="welcome">
      <Orb state="breathing" size={64} />
      <h2>{hasProjects ? "Nothing open" : "Open a folder to get started"}</h2>
      <p className="dim">Pick a script on the left, a file on the right, or a change in the Git view.</p>
      <button className="btn primary" onClick={openFolders}>
        <Icon name="folder_open" /> Open folder(s)
      </button>
      <dl className="shortcuts">
        <dt>⌘O</dt><dd>Open folder</dd>
        <dt>⌘T</dt><dd>New terminal</dd>
        <dt>⌘W</dt><dd>Close tab</dd>
        <dt>⌘B</dt><dd>Toggle projects</dd>
        <dt>⌘,</dt><dd>Settings</dd>
      </dl>
    </div>
  );
}

/** "+" beside the tabs: start a coding agent (or a shell / one-off command) in the selected space. */
function AgentLauncher() {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const space = useStore(selectActiveSpace);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    availableAgents().then(setInstalled);
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const ready = () => {
    setOpen(false);
    if (!project || !space) notify("Open a project first.");
    return project && space ? { project, space } : null;
  };
  const launch = (a: Agent) => {
    const ctx = ready();
    if (ctx) newTerminal(ctx.project.id, { cwd: ctx.space.dir, command: a.command, label: a.label, agent: a.id });
  };
  const shell = () => {
    const ctx = ready();
    if (ctx) newTerminal(ctx.project.id, { cwd: ctx.space.dir });
  };
  const custom = () => {
    const ctx = ready();
    if (!ctx) return;
    const inside = isUnder(ctx.space.dir, ctx.project.path);
    useStore.setState({
      dialog: {
        kind: "script",
        projectId: ctx.project.id,
        preset: {
          runner: "custom",
          ownerProjectId: inside ? ctx.project.id : null,
          cwd: inside ? ctx.space.dir.slice(ctx.project.path.length + 1) : ctx.space.dir,
        },
      },
    });
  };
  // Installed first; unknown install state keeps the table order.
  const sorted = [...AGENTS].sort((a, b) => Number(installed?.has(b.id) ?? 0) - Number(installed?.has(a.id) ?? 0));

  return (
    <div className="popover-anchor tab-add" ref={ref}>
      <button className={cx("tab-add-btn", open && "on")} title="New coding agent or terminal" aria-label="New coding agent or terminal" onClick={() => setOpen(!open)}>
        <Icon name="add" size={16} />
      </button>
      {open && (
        <div className="popover agent-menu" role="menu">
          <div className="menu-label">Coding agent{space ? ` · ${space.name}` : ""}</div>
          {sorted.map((a) => {
            const missing = installed !== null && !installed.has(a.id);
            return (
              <div key={a.id} role="menuitem" className={cx("menu-item", missing && "missing")} onClick={() => launch(a)} title={`${a.command}${missing ? ` (\`${a.bin}\` not found on PATH)` : ""}`}>
                <AgentIcon agent={a.id} size={16} />
                <span className="ellipsis">{a.label}</span>
                {missing && <span className="dim small">not installed</span>}
              </div>
            );
          })}
          <div className="menu-sep" />
          <div role="menuitem" className="menu-item" onClick={shell}>
            <Icon name="terminal" size={16} /> New terminal
          </div>
          <div role="menuitem" className="menu-item" onClick={custom}>
            <Icon name="code" size={16} /> Custom command…
          </div>
        </div>
      )}
    </div>
  );
}
