import { useState } from "react";
import { BorderBeam } from "border-beam";
import { api, type Project, type Space } from "../ipc";
import {
  ago, discover, isFailed, notify, openFolders, openTerminalTab, removeProject, removeScript, removeSpace, repoOf, selectActiveSpace,
  setActiveSpace, spaceChanges, spaceOfPath, toggleCollapsed, toggleStar, toggleStartScript, updateConfig, updateProject, useStore,
  type AgentStatus, type Term,
} from "../store";
import { newTerminal, restart, runScript, runStart, showScript, stop as stopTerm } from "../lib/terminals";
import { agentById } from "../lib/agents";
import { runnerById } from "../lib/runners";
import { iconUrl } from "../lib/icons";
import { AgentIcon, cx, Icon, IconButton, Orb, stop, useNow } from "./ui";

const openScriptDialog = (projectId: string, scriptId?: string) => useStore.setState({ dialog: { kind: "script", projectId, scriptId } });
const openSpaceDialog = (projectId: string, spaceId?: string) => useStore.setState({ dialog: { kind: "space", projectId, spaceId } });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function LeftPanel() {
  const view = useStore((s) => s.config.layout.leftView);
  const projects = useStore((s) => s.config.projects);
  const setView = (v: "projects" | "spaces") => updateConfig((c) => void (c.layout.leftView = v));
  return (
    <div className="panel left-panel">
      <div className="panel-head">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={view === "projects"} className={cx(view === "projects" && "on")} onClick={() => setView("projects")}>
            <Icon name="data_object" size={14} /> Projects
          </button>
          <button role="tab" aria-selected={view === "spaces"} className={cx(view === "spaces" && "on")} onClick={() => setView("spaces")}>
            <Icon name="star" size={14} /> Spaces
          </button>
        </div>
        <span className="spacer" />
        <IconButton icon="create_new_folder" title="Open folder(s)… (⌘O)" onClick={openFolders} />
      </div>
      <div className="scroll">
        {view === "projects" ? projects.map((p) => <ProjectSection key={p.id} project={p} />) : <SpacesView projects={projects} />}
        {!projects.length && (
          <div className="empty-hint">
            <p>No projects yet.</p>
            <button className="btn" onClick={openFolders}>
              <Icon name="folder_open" /> Open folder(s)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Starred ("active") spaces across every project. */
function SpacesView({ projects }: { projects: Project[] }) {
  const starred = projects.flatMap((p) => p.spaces.filter((s) => s.starred).map((s) => ({ p, s })));
  if (!projects.length) return null;
  if (!starred.length) {
    return (
      <div className="empty-hint">
        <p>
          Star a space (<Icon name="star" size={13} />) to pin it here.
        </p>
      </div>
    );
  }
  return (
    <div className="spaces-list">
      {starred.map(({ p, s }) => (
        <SpaceCard key={s.id} project={p} space={s} showProject />
      ))}
    </div>
  );
}

function ProjectSection({ project: p }: { project: Project }) {
  const active = useStore((s) => s.config.layout.activeProjectId === p.id);
  const [editing, setEditing] = useState(false);
  const startCount = p.startScriptIds.filter((id) => p.scriptIds.includes(id)).length;
  // New terminals open in the project's selected space when it's the active project.
  const terminalHere = () => newTerminal(p.id, { cwd: (active ? selectActiveSpace(useStore.getState()) : undefined)?.dir });
  return (
    <section className={cx("project", active && "active")}>
      <div className="project-head" onClick={() => setActiveSpace(p.id)}>
        <IconButton icon={p.collapsed ? "chevron_right" : "expand_more"} title={p.collapsed ? "Expand" : "Collapse"} onClick={stop(() => toggleCollapsed(p.id))} />
        <Icon name={p.icon ?? "data_object"} className={p.color ? undefined : "accent"} color={p.color} size={16} />
        {editing ? (
          <input
            className="inline-input wide"
            autoFocus
            defaultValue={p.name}
            aria-label="Project name"
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              if (!e.target.dataset.cancel) updateProject(p.id, { name: e.target.value });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.dataset.cancel = "1";
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
          />
        ) : (
          <span className="project-name" style={{ color: p.color }} title={`${p.path}\nDouble-click to rename`} onDoubleClick={stop(() => setEditing(true))}>
            {p.name}
          </span>
        )}
        <span className="hover-actions">
          <IconButton
            icon="play_circle"
            title={startCount ? `Start ${startCount} selected script${startCount > 1 ? "s" : ""}` : "Start all scripts"}
            onClick={stop(() => runStart(p.id))}
            disabled={!p.scriptIds.length}
          />
          <IconButton icon="library_add" title="Add space" onClick={stop(() => openSpaceDialog(p.id))} />
          <IconButton icon="terminal" title="New terminal (⌘T)" onClick={stop(terminalHere)} />
          <IconButton icon="settings" title="Project settings" onClick={stop(() => useStore.setState({ dialog: { kind: "project", projectId: p.id } }))} />
          <IconButton icon="close" title="Remove project" onClick={stop(() => removeProject(p.id))} />
        </span>
      </div>
      {!p.collapsed && (
        <div className="project-body">
          {p.spaces.map((s) => (
            <SpaceCard key={s.id} project={p} space={s} />
          ))}
          <ScriptList project={p} />
        </div>
      )}
    </section>
  );
}

/** Orca-style space: git status plus every agent terminal running in it. Only the selected one is highlighted. */
function SpaceCard({ project, space, showProject }: { project: Project; space: Space; showProject?: boolean }) {
  useNow();
  const selected = useStore((s) => s.config.layout.activeProjectId === project.id && selectActiveSpace(s)?.id === space.id);
  useStore((s) => s.repos); // re-render when repos are (re)discovered
  const repo = repoOf(space.dir);
  const st = useStore((s) => (repo ? s.status[repo.path] : undefined));
  const terms = useStore((s) => s.terms);
  const agentStatus = useStore((s) => s.agentStatus);
  const theme = useStore((s) => s.config.settings.theme);

  const mine = Object.values(terms).filter((t) => spaceOfPath(t.cwd)?.id === space.id);
  const agents = mine.filter((t) => t.agent);
  const scripts = mine.filter((t) => t.scriptId);
  const running = scripts.some((t) => t.status === "running" || t.status === "stopping");
  const failed = !running && scripts.some(isFailed);
  const changes = repo ? spaceChanges(space.dir, repo.path, st) : undefined;
  const isPrimary = space.dir === project.path;
  const init = () =>
    api
      .init(space.dir)
      .then(() => discover(project.id))
      .catch(notify);

  const card = (
    <div
      className={cx("space-card", selected && "selected")}
      onClick={() => setActiveSpace(project.id, space.id)}
      title={space.dir}
      role="button"
      aria-pressed={selected}
    >
      <div className="card-row">
        <Icon name={space.icon ?? (isPrimary ? "folder_special" : "folder")} size={15} className={space.color ? undefined : "dim"} color={space.color} />
        <span className="card-title" style={{ color: space.color }}>{space.name}</span>
        {showProject && <span className="dim small ellipsis">{project.name}</span>}
        {(running || failed) && <span className={cx("dot", running ? "green pulse" : "red")} title={running ? "Scripts running" : "A script failed"} />}
        <span className="spacer" />
        <span className="hover-actions">
          <IconButton icon="settings" title="Space settings" size={14} onClick={stop(() => openSpaceDialog(project.id, space.id))} />
          {!isPrimary && <IconButton icon="close" title="Remove space" size={14} onClick={stop(() => removeSpace(project.id, space.id))} />}
        </span>
        <button
          className={cx("star", space.starred && "on")}
          title={space.starred ? "Unstar (remove from Spaces view)" : "Star (show in Spaces view)"}
          aria-pressed={!!space.starred}
          onClick={stop(() => toggleStar(project.id, space.id))}
        >
          <Icon name="star" size={15} />
        </button>
      </div>
      <div className="card-sub">
        {repo ? (
          <>
            <Icon name="alt_route" size={12} />
            <span className="ellipsis">{st ? (st.branch ?? `detached @ ${st.oid?.slice(0, 7)}`) : "…"}</span>
            {!!st?.ahead && <span className="sync">↑{st.ahead}</span>}
            {!!st?.behind && <span className="sync">↓{st.behind}</span>}
            {!!changes?.length && <span className="changes">{changes.length} changed</span>}
          </>
        ) : (
          <button className="link-btn" onClick={stop(init)}>
            Initialize git
          </button>
        )}
      </div>
      {agents.map((t) => (
        <AgentRow key={t.key} t={t} st={agentStatus[t.key]} />
      ))}
    </div>
  );
  if (!selected) return card;
  const dark = theme === "system" ? document.documentElement.dataset.theme !== "light" : theme === "dark";
  return (
    <BorderBeam size="line" colorVariant="ocean" theme={dark ? "dark" : "light"} borderRadius={10} strength={0.7} active={!reducedMotion.matches}>
      {card}
    </BorderBeam>
  );
}

function AgentRow({ t, st }: { t: Term; st?: AgentStatus }) {
  const a = agentById(t.agent);
  const live = t.status === "running" || t.status === "stopping";
  const working = live && st?.state === "working";
  const label = !live ? (t.status === "exited" ? "Exited" : "Not running") : working ? "Working" : st?.everWorked ? "Done" : "Idle";
  return (
    <div className="agent-row" onClick={stop(() => openTerminalTab(t.key))} title={t.name}>
      {working ? <Orb state="working" size={20} color={a?.color} title="Working" /> : <AgentIcon agent={t.agent} size={14} />}
      <span className="ellipsis">
        <span className={cx(working && "working-label")}>{label}</span> – {a?.label ?? "Agent"}
      </span>
      <span className="age">{ago(live ? (st?.since ?? t.startedAt) : t.endedAt)}</span>
    </div>
  );
}

function ScriptList({ project }: { project: Project }) {
  const scripts = useStore((s) => s.config.scripts);
  const terms = useStore((s) => s.terms);
  return (
    <div className="scripts">
      <div className="sub-head">
        <span>Scripts</span>
        <span className="hover-actions always">
          <IconButton icon="add" title="Add script" onClick={() => openScriptDialog(project.id)} />
          <IconButton icon="link" title="Link a script from another project" onClick={() => useStore.setState({ dialog: { kind: "link", projectId: project.id } })} />
        </span>
      </div>
      {project.scriptIds.map((id) => {
        const s = scripts[id];
        if (!s) return null;
        const t = terms[id];
        const live = t?.status === "running" || t?.status === "stopping";
        const failed = isFailed(t);
        const foreign = s.ownerProjectId !== project.id;
        const inStart = project.startScriptIds.includes(id);
        return (
          <div
            key={id}
            className={cx("script-row", live && "live")}
            onClick={() => {
              setActiveSpace(project.id);
              showScript(id, project.id);
            }}
            title={`${s.command}\n${s.ownerProjectId === null ? s.cwd : ""}`.trim()}
          >
            <button
              className={cx("start-toggle", inStart && "on")}
              title={inStart ? "Included in Start" : "Include in Start"}
              aria-pressed={inStart}
              onClick={stop(() => toggleStartScript(project.id, id))}
            >
              <Icon name={inStart ? "check_box" : "check_box_outline_blank"} size={14} />
            </button>
            <span className={cx("dot", live ? "green pulse" : failed ? "red" : t?.status === "exited" ? "grey" : "hollow")} />
            <span className="script-name">{s.name}</span>
            {foreign && <Icon name={s.ownerProjectId === null ? "public" : "link"} size={13} className="dim" title={s.ownerProjectId === null ? "External script" : "Linked from another project"} />}
            <span className="chip">
              <img src={iconUrl(runnerById(s.runner).icon)} alt="" />
              {runnerById(s.runner).id === "custom" ? "sh" : s.runner}
            </span>
            <span className="hover-actions">
              {live ? (
                <>
                  <IconButton icon="restart_alt" title="Restart" onClick={stop(() => restart(id))} />
                  <IconButton icon="stop" title="Stop" className="red" onClick={stop(() => stopTerm(id))} />
                </>
              ) : (
                <IconButton icon="play_arrow" title="Run" className="green" onClick={stop(() => runScript(id))} />
              )}
              <IconButton icon="edit" title="Edit" onClick={stop(() => openScriptDialog(project.id, id))} />
              <IconButton icon={foreign ? "link_off" : "delete"} title={foreign ? "Unlink" : "Delete"} onClick={stop(() => removeScript(project.id, id))} />
            </span>
          </div>
        );
      })}
      {!project.scriptIds.length && (
        <button className="ghost-add" onClick={() => openScriptDialog(project.id)}>
          <Icon name="add" size={14} /> Add script
        </button>
      )}
    </div>
  );
}
