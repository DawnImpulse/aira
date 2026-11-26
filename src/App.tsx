import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useEffect, type CSSProperties } from "react";
import { isFailed, panelApi, scriptsWindow, selectActiveSpace, togglePanel, useStore } from "./store";
import { dismissUpdate, installUpdate, restartForUpdate } from "./lib/updates";
import type { Project } from "./ipc";
import { Icon, IconButton, ProjectIcon } from "./components/ui";
import { LeftPanel, SpaceGit } from "./components/LeftPanel";
import { MainTabs } from "./components/MainTabs";
import { RightPanel } from "./components/RightPanel";
import { StatusBar } from "./components/StatusBar";
import { LinkDialog, ScriptDialog } from "./components/ScriptDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { UpdateProgress } from "./components/UpdateStatus";
import { NewPathDialog, ProjectDialog, SpaceDialog } from "./components/SpaceDialog";

function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-center" data-tauri-drag-region />
      <div className="titlebar-actions">
        <IconButton icon="left_panel_close" title="Toggle projects panel (⌘B)" onClick={() => togglePanel(panelApi.left)} />
        <IconButton icon="right_panel_close" title="Toggle files/git panel (⌥⌘B)" onClick={() => togglePanel(panelApi.right)} />
        <IconButton icon="settings" title="Settings (⌘,)" onClick={() => useStore.setState({ dialog: { kind: "settings" } })} />
      </div>
    </header>
  );
}

/** Bottom-right update card (lib/updates): available → downloading → installed → restart. */
function UpdateCard() {
  const u = useStore((s) => s.update);
  if (!u || u.hidden) return null;
  const v = u.version ? `Aira ${u.version}` : "Aira";
  const act = u.stage === "available" || u.stage === "installed";
  return (
    <div className="update-card" role="status">
      <Icon name={u.stage === "error" ? "error" : u.stage === "upToDate" ? "check_circle" : "system_update_alt"} size={18} className={u.stage === "error" ? "red" : u.stage === "upToDate" ? "green" : undefined} />
      <div className="update-body">
        {u.stage === "available" && (
          <>
            <b>{v} is available</b>
            <span className="dim">Everything keeps running while it downloads.</span>
            {u.notes && <pre className="update-notes scroll">{u.notes}</pre>}
          </>
        )}
        {u.stage === "downloading" && (
          <>
            <b>Downloading {v}…</b>
            <UpdateProgress u={u} />
          </>
        )}
        {u.stage === "installed" && (
          <>
            <b>{v} is ready</b>
            <span className="dim">Restart to finish. Your terminals and tabs come back as they are.</span>
          </>
        )}
        {u.stage === "upToDate" && <b>You're on the latest version.</b>}
        {u.stage === "error" && (
          <>
            <b>Update failed</b>
            <span className="dim">{u.error}</span>
          </>
        )}
        {act && (
          <div className="update-actions">
            <button className="btn primary small" onClick={u.stage === "available" ? installUpdate : restartForUpdate}>
              {u.stage === "available" ? "Update" : "Restart now"}
            </button>
            <button className="btn small" onClick={dismissUpdate}>
              Later
            </button>
          </div>
        )}
      </div>
      {u.stage !== "downloading" && <IconButton icon="close" title="Dismiss" onClick={dismissUpdate} />}
    </div>
  );
}

/** Tinted bar over the main + right windows: which project (and space) they show. */
function ProjectBar() {
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const space = useStore(selectActiveSpace);
  const scripts = useStore((s) => !!project && s.config.layout.activeSpaceId === scriptsWindow(project.id));
  if (!project || !space) return null;
  const color = project.color ?? "var(--accent)";
  // The scripts window's right panel shows the project's primary space (its root folder).
  const name = scripts ? "Scripts" : space.name !== project.name ? space.name : null;
  return (
    <div className="project-bar" style={{ "--project-color": color } as CSSProperties} title={space.dir}>
      <ProjectIcon icon={project.icon} color={color} size={14} />
      <b className="ellipsis">{project.name}</b>
      {name && (
        <>
          <Icon name="chevron_right" size={14} className="dim" />
          <span className="ellipsis">{name}</span>
        </>
      )}
      {scripts ? <ScriptsSummary project={project} /> : <SpaceGit project={project} space={space} />}
    </div>
  );
}

/** Scripts window: how the project's scripts are doing, instead of git. */
function ScriptsSummary({ project }: { project: Project }) {
  // A string keeps the selector's result stable between renders.
  const counts = useStore((s) => {
    const n = [0, 0, 0]; // running, failed, not running
    for (const id of project.scriptIds) {
      const t = s.terms[id];
      n[t?.status === "running" || t?.status === "stopping" ? 0 : isFailed(t) ? 1 : 2]++;
    }
    return n.join();
  });
  const [running, failed, idle] = counts.split(",").map(Number);
  if (!project.scriptIds.length) return <div className="card-sub dim">No scripts</div>;
  return (
    <div className="card-sub scripts-summary">
      {running > 0 && (
        <span>
          <span className="dot green" /> {running} running
        </span>
      )}
      {failed > 0 && (
        <span className="failed">
          <span className="dot red" /> {failed} failed
        </span>
      )}
      {idle > 0 && (
        <span className="dim">
          <span className="dot hollow" /> {idle} not running
        </span>
      )}
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const dialog = useStore((s) => s.dialog);
  const confirm = useStore((s) => s.confirm);
  const toast = useStore((s) => s.toast);
  const left = usePanelRef();
  const right = usePanelRef();
  const outer = useDefaultLayout({ id: "outer-layout" });
  const work = useDefaultLayout({ id: "work-layout" });
  useEffect(() => {
    panelApi.left = left.current;
    panelApi.right = right.current;
  });
  if (!ready) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="app">
      <TitleBar />
      <Group orientation="horizontal" className="panels" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged}>
        <Panel id="left" panelRef={left} defaultSize="20%" minSize={200} collapsible collapsedSize={0}>
          <LeftPanel />
        </Panel>
        <Separator className="sep" />
        <Panel id="work" minSize="40%">
          {/* Main + right share the project bar; both are the selected space's own windows. */}
          <div className="work">
            <ProjectBar />
            <Group orientation="horizontal" className="panels" defaultLayout={work.defaultLayout} onLayoutChanged={work.onLayoutChanged}>
              <Panel id="main" minSize="30%">
                <MainTabs />
              </Panel>
              <Separator className="sep" />
              <Panel id="right" panelRef={right} defaultSize="28%" minSize={200} collapsible collapsedSize={0}>
                <RightPanel />
              </Panel>
            </Group>
          </div>
        </Panel>
      </Group>
      <StatusBar />
      {dialog?.kind === "script" && <ScriptDialog {...dialog} onClose={close} />}
      {dialog?.kind === "link" && <LinkDialog projectId={dialog.projectId} onClose={close} />}
      {dialog?.kind === "settings" && <SettingsDialog onClose={close} />}
      {dialog?.kind === "space" && <SpaceDialog projectId={dialog.projectId} spaceId={dialog.spaceId} dir={dialog.dir} onClose={close} />}
      {dialog?.kind === "project" && <ProjectDialog projectId={dialog.projectId} onClose={close} />}
      {dialog?.kind === "newPath" && <NewPathDialog dir={dialog.dir} isDir={dialog.isDir} onClose={close} />}
      <UpdateCard />
      {toast && (
        <div className="toast" role="alert" onClick={() => useStore.setState({ toast: null })}>
          <Icon name="error" size={16} /> <span>{toast}</span>
        </div>
      )}
      {confirm && <ConfirmDialog req={confirm} />}
    </div>
  );
}
