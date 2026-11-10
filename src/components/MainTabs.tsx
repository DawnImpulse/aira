import { useEffect, useRef, useState } from "react";
import type { Tab } from "../ipc";
import { activateTab, basename, closeTab, formatBytes, isFailed, isUnder, notify, openBrowserTab, openLauncherTab, pinTab, selectActiveSpace, useStore } from "../store";
import { attach, newTerminal, renameTerm, restart, runScript, startSession, stop as stopTerm } from "../lib/terminals";
import { AGENTS, availableAgents, type Agent } from "../lib/agents";
import { fileIconUrl } from "../lib/icons";
import { DiffView, FileView } from "./Editors";
import { BrowserView, Favicon, PinInput, RecentLinks, WorkspaceLinks } from "./BrowserView";
import { AgentIcon, cx, Icon, IconButton, Spinner, stop, useOverlay } from "./ui";
import { popupMenu } from "../lib/menu";

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
        {current?.kind === "browser" && <BrowserView key={current.id} tab={current} />}
        {current?.kind === "launcher" && (
          <div className="welcome">
            <Launcher tabId={current.id} />
          </div>
        )}
        {!current && <Welcome />}
      </div>
    </div>
  );
}

const hostname = (url: string): string | null => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

/** Closes every tab except `keep` (dirty files still ask first). */
async function closeOthers(keep: string) {
  for (const t of useStore.getState().config.layout.tabs) if (t.id !== keep) await closeTab(t.id);
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const term = useStore((s) => (tab.kind === "terminal" ? s.terms[tab.key] : undefined));
  const working = useStore((s) => tab.kind === "terminal" && s.agentStatus[tab.key]?.state === "working" && s.terms[tab.key]?.status === "running");
  const agentColor = AGENTS.find((a) => a.id === term?.agent)?.color;
  const dirty = useStore((s) => tab.kind === "file" && !!s.dirty[tab.path]);
  const [editing, setEditing] = useState(false);
  const preview = tab.kind === "file" && !tab.pinned;
  const title =
    tab.kind === "terminal"
      ? (term?.name ?? "Terminal")
      : tab.kind === "file"
        ? basename(tab.path)
        : tab.kind === "browser"
          ? (hostname(tab.url) ?? "New Tab")
          : tab.kind === "launcher"
            ? "New…"
            : `${basename(tab.path)} (${tab.head ? "changes" : tab.staged ? "staged" : "working tree"})`;

  return (
    <div
      role="tab"
      aria-selected={active}
      className={cx("tab", active && "active", preview && "preview")}
      onClick={() => activateTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        popupMenu([
          ...(term ? [{ text: "Rename…", action: () => setEditing(true) }, "-" as const] : []),
          { text: "Close", action: () => closeTab(tab.id) },
          { text: "Close Others", action: () => closeOthers(tab.id) },
        ]);
      }}
      onDoubleClick={() => (tab.kind === "terminal" ? setEditing(true) : pinTab(tab.id))}
      title={tab.kind === "terminal" ? term?.cwd : tab.kind === "browser" ? tab.url : tab.kind === "file" ? tab.path : undefined}
    >
      {tab.kind === "terminal" &&
        (term?.agent ? (
          working ? <Spinner size={12} color={agentColor} title="Working" /> : <AgentIcon agent={term.agent} size={14} />
        ) : (
          <Icon name="terminal" size={14} className={cx(term?.status === "running" ? "green" : isFailed(term) && "red")} />
        ))}
      {tab.kind === "file" && <img className="file-icon" src={fileIconUrl(tab.path)} alt="" />}
      {tab.kind === "diff" && <Icon name="difference" size={14} className="accent" />}
      {tab.kind === "browser" && <Favicon url={tab.url} size={14} />}
      {tab.kind === "launcher" && <Icon name="add" size={14} className="dim" />}
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
  return (
    <div className="welcome">
      <Launcher />
    </div>
  );
}

/** Full "new…" page: new terminal, a new browser tab, and each installed coding agent. Shown on the
 * empty state and as the launcher tab (opened by clicking "+"). */
function Launcher({ tabId }: { tabId?: string }) {
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const space = useStore(selectActiveSpace);
  const hidden = useStore((s) => s.config.settings.hiddenAgents);
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  useEffect(() => {
    availableAgents().then(setInstalled);
  }, []);
  const agents = AGENTS.filter((a) => !hidden.includes(a.id) && (installed === null || installed.has(a.id)));
  const done = () => tabId && closeTab(tabId);
  const inSpace = (run: (projectId: string, dir: string) => void) => {
    if (!project || !space) return notify("Open a project first.");
    run(project.id, space.dir);
    done();
  };
  const openInBrowser = (url: string) => {
    openBrowserTab(url);
    done();
  };
  return (
    <div className="launcher">
      <h2 className="launcher-title">Open…</h2>
      {!project && <p className="dim small launcher-hint">Open a folder with ⌘O to get started.</p>}
      <WorkspaceLinks onOpen={openInBrowser} editable />
      <div className="launcher-grid">
        <button className="launch-tile" onClick={() => inSpace((id, cwd) => newTerminal(id, { cwd }))}>
          <Icon name="terminal" size={24} />
          <span>New terminal</span>
        </button>
        <button
          className="launch-tile"
          onClick={() => {
            openBrowserTab();
            done();
          }}
        >
          <Icon name="language" size={24} />
          <span>New browser tab</span>
        </button>
        {agents.map((a) => (
          <button key={a.id} className="launch-tile" onClick={() => inSpace((id, cwd) => newTerminal(id, { cwd, command: a.command, label: a.label, agent: a.id }))} title={a.command}>
            <AgentIcon agent={a.id} size={24} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <RecentLinks onOpen={openInBrowser} />
      <PinInput />
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
  const hoverTimer = useRef<number | undefined>(undefined);
  useOverlay(open);
  const hoverOpen = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(true), 300);
  };
  const hoverLeave = () => {
    clearTimeout(hoverTimer.current);
    setOpen(false);
  };
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
  // Show installed agents only (hidden ones are opt-in from Settings). While install state is still
  // loading, show the non-hidden ones so the menu isn't momentarily empty.
  const hidden = useStore((s) => s.config.settings.hiddenAgents);
  const visible = AGENTS.filter((a) => !hidden.includes(a.id) && (installed === null || installed.has(a.id)));

  return (
    <div className="popover-anchor tab-add" ref={ref} onMouseEnter={hoverOpen} onMouseLeave={hoverLeave}>
      {/* Hover (after a short delay) shows this quick menu; click opens the full launcher tab. */}
      <button
        className={cx("tab-add-btn", open && "on")}
        title="New… (click for all options)"
        aria-label="New terminal, agent, or browser tab"
        onClick={() => {
          clearTimeout(hoverTimer.current);
          setOpen(false);
          openLauncherTab();
        }}
      >
        <Icon name="add" size={16} />
      </button>
      {open && (
        <div className="popover agent-menu" role="menu">
          <div className="menu-label">Coding agent{space ? ` · ${space.name}` : ""}</div>
          {installed !== null && visible.length === 0 && (
            <div className="menu-item dim">No coding agents installed. Enable in Settings.</div>
          )}
          {visible.map((a) => (
            <div key={a.id} role="menuitem" className="menu-item" onClick={() => launch(a)} title={a.command}>
              <AgentIcon agent={a.id} size={16} />
              <span className="ellipsis">{a.label}</span>
            </div>
          ))}
          <div className="menu-sep" />
          <div role="menuitem" className="menu-item" onClick={shell}>
            <Icon name="terminal" size={16} /> New terminal
          </div>
          <div
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              openBrowserTab();
            }}
          >
            <Icon name="language" size={16} /> New browser tab
          </div>
          <div role="menuitem" className="menu-item" onClick={custom}>
            <Icon name="code" size={16} /> Custom command…
          </div>
        </div>
      )}
    </div>
  );
}
