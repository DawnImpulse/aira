import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useEffect } from "react";
import { panelApi, repoOf, selectActiveSpace, togglePanel, useStore } from "./store";
import { Icon, IconButton } from "./components/ui";
import { LeftPanel } from "./components/LeftPanel";
import { MainTabs } from "./components/MainTabs";
import { RightPanel } from "./components/RightPanel";
import { StatusBar } from "./components/StatusBar";
import { LinkDialog, ScriptDialog } from "./components/ScriptDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { NewPathDialog, SpaceDialog } from "./components/SpaceDialog";

function TitleBar() {
  const project = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId));
  const branch = useStore((s) => {
    const space = selectActiveSpace(s);
    const repo = space && repoOf(space.dir);
    return repo ? (s.status[repo.path]?.branch ?? null) : null;
  });
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-center" data-tauri-drag-region>
        {project && (
          <>
            <span data-tauri-drag-region>{project.name}</span>
            {branch && (
              <span className="dim" data-tauri-drag-region>
                <Icon name="alt_route" size={14} /> {branch}
              </span>
            )}
          </>
        )}
      </div>
      <div className="titlebar-actions">
        <IconButton icon="left_panel_close" title="Toggle projects panel (⌘B)" onClick={() => togglePanel(panelApi.left)} />
        <IconButton icon="right_panel_close" title="Toggle files/git panel (⌥⌘B)" onClick={() => togglePanel(panelApi.right)} />
        <IconButton icon="settings" title="Settings (⌘,)" onClick={() => useStore.setState({ dialog: { kind: "settings" } })} />
      </div>
    </header>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const dialog = useStore((s) => s.dialog);
  const toast = useStore((s) => s.toast);
  const left = usePanelRef();
  const right = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "main-layout" });
  useEffect(() => {
    panelApi.left = left.current;
    panelApi.right = right.current;
  });
  if (!ready) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="app">
      <TitleBar />
      <Group orientation="horizontal" className="panels" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        <Panel id="left" panelRef={left} defaultSize="20%" minSize={200} collapsible collapsedSize={0}>
          <LeftPanel />
        </Panel>
        <Separator className="sep" />
        <Panel id="main" minSize="30%">
          <MainTabs />
        </Panel>
        <Separator className="sep" />
        <Panel id="right" panelRef={right} defaultSize="22%" minSize={200} collapsible collapsedSize={0}>
          <RightPanel />
        </Panel>
      </Group>
      <StatusBar />
      {dialog?.kind === "script" && <ScriptDialog {...dialog} onClose={close} />}
      {dialog?.kind === "link" && <LinkDialog projectId={dialog.projectId} onClose={close} />}
      {dialog?.kind === "settings" && <SettingsDialog onClose={close} />}
      {dialog?.kind === "space" && <SpaceDialog projectId={dialog.projectId} spaceId={dialog.spaceId} dir={dialog.dir} onClose={close} />}
      {dialog?.kind === "project" && <SpaceDialog projectId={dialog.projectId} editProject onClose={close} />}
      {dialog?.kind === "newPath" && <NewPathDialog dir={dialog.dir} isDir={dialog.isDir} onClose={close} />}
      {toast && (
        <div className="toast" role="alert" onClick={() => useStore.setState({ toast: null })}>
          <Icon name="error" size={16} /> <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
