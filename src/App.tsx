import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useEffect, type CSSProperties } from "react";
import { panelApi, selectActiveSpace, togglePanel, useStore } from "./store";
import { Icon, IconButton, ProjectIcon } from "./components/ui";
import { LeftPanel, SpaceGit } from "./components/LeftPanel";
import { MainTabs } from "./components/MainTabs";
import { RightPanel } from "./components/RightPanel";
import { StatusBar } from "./components/StatusBar";
import { LinkDialog, ScriptDialog } from "./components/ScriptDialog";
import { SettingsDialog } from "./components/SettingsDialog";
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

/** Tinted bar over the main + right windows: which project (and space) they show. */
function ProjectBar() {
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const space = useStore(selectActiveSpace);
  if (!project || !space) return null;
  const color = project.color ?? "var(--accent)";
  return (
    <div className="project-bar" style={{ "--project-color": color } as CSSProperties} title={space.dir}>
      <ProjectIcon icon={project.icon} color={color} size={14} />
      <b className="ellipsis">{project.name}</b>
      {space.name !== project.name && (
        <>
          <Icon name="chevron_right" size={14} className="dim" />
          <span className="ellipsis">{space.name}</span>
        </>
      )}
      <SpaceGit project={project} space={space} />
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const dialog = useStore((s) => s.dialog);
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
      {toast && (
        <div className="toast" role="alert" onClick={() => useStore.setState({ toast: null })}>
          <Icon name="error" size={16} /> <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
