import { Fragment, useRef, useState, type CSSProperties } from "react";
import { BorderBeam } from "border-beam";
import { api, type GitStatus, type Project, type Space } from "../ipc";
import {
  ago, discover, focusTerminal, isFailed, notify, openFolders, removeScript, removeSpace, repoOf, selectActiveSpace,
  setActiveSpace, spaceChanges, spaceOfPath, toggleCollapsed, toggleStar, toggleStartScript, updateConfig, updateProject, useStore,
  type AgentStatus, type SubAgentNode, type Term,
} from "../store";
import { restart, runScript, runStart, showScript, stop as stopTerm } from "../lib/terminals";
import { agentById } from "../lib/agents";
import { runnerById } from "../lib/runners";
import { iconUrl } from "../lib/icons";
import { AgentIcon, cx, Icon, IconButton, ProjectIcon, Spinner, stop, useNow } from "./ui";

const openScriptDialog = (projectId: string, scriptId?: string) => useStore.setState({ dialog: { kind: "script", projectId, scriptId } });
const openSpaceDialog = (projectId: string, spaceId?: string) => useStore.setState({ dialog: { kind: "space", projectId, spaceId } });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function LeftPanel() {
  const view = useStore((s) => s.config.layout.leftView);
  const projects = useStore((s) => s.config.projects);
  const setView = (v: "projects" | "spaces" | "scripts") => updateConfig((c) => void (c.layout.leftView = v));
  return (
    <div className="panel left-panel">
      <div className="panel-head">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={view === "projects"} className={cx(view === "projects" && "on")} onClick={() => setView("projects")} title="All projects">
            <Icon name="data_object" size={14} /> Projects
          </button>
          <button role="tab" aria-selected={view === "spaces"} className={cx(view === "spaces" && "on")} onClick={() => setView("spaces")} title="Starred spaces from every project">
            <Icon name="star" size={14} /> Spaces
          </button>
          <button role="tab" aria-selected={view === "scripts"} className={cx(view === "scripts" && "on")} onClick={() => setView("scripts")} title="Scripts of every project">
            <Icon name="play_circle" size={14} /> Scripts
          </button>
        </div>
        <span className="spacer" />
        <IconButton icon="create_new_folder" title="Open folder(s)… (⌘O)" onClick={openFolders} />
      </div>
      <div className="scroll">
        {view === "projects" && projects.map((p) => <ProjectSection key={p.id} project={p} />)}
        {view === "spaces" && <SpacesView projects={projects} />}
        {view === "scripts" && <ScriptsView projects={projects} />}
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

const projectStyle = (p: Project) => ({ "--project-color": p.color ?? "var(--accent)" }) as CSSProperties;

/** Starred ("active") spaces across every project, each with its project's bracket. */
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
        <div key={s.id} className="starred-space" style={projectStyle(p)}>
          <SpaceCard project={p} space={s} showProject />
        </div>
      ))}
    </div>
  );
}

function ProjectSection({ project: p }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  // Single click toggles collapse; wait a beat so a double-click (rename) doesn't also toggle.
  const clickTimer = useRef<number | undefined>(undefined);
  const onHeadClick = () => {
    setActiveSpace(p.id);
    clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => toggleCollapsed(p.id), 220);
  };
  return (
    <section className={cx("project", p.collapsed && "collapsed")} style={projectStyle(p)}>
      <div className="project-head" onClick={onHeadClick} title={p.collapsed ? "Click to expand" : "Click to collapse"}>
        <IconButton icon={p.collapsed ? "chevron_right" : "expand_more"} title={p.collapsed ? "Expand" : "Collapse"} onClick={stop(() => toggleCollapsed(p.id))} />
        <ProjectIcon icon={p.icon} color={p.color ?? "var(--accent)"} size={18} />
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
          <span
            className="project-name"
            title={`${p.path}\nClick to ${p.collapsed ? "expand" : "collapse"} · double-click to rename`}
            onDoubleClick={stop(() => {
              clearTimeout(clickTimer.current);
              setEditing(true);
            })}
          >
            {p.name}
          </span>
        )}
        <span className="hover-actions">
          <IconButton icon="library_add" title="Add space" onClick={stop(() => openSpaceDialog(p.id))} />
          <IconButton icon="settings" title="Project settings (name, icon, color, remove)" onClick={stop(() => useStore.setState({ dialog: { kind: "project", projectId: p.id } }))} />
        </span>
      </div>
      {!p.collapsed && (
        <div className="project-body">
          {p.spaces.map((s) => (
            <SpaceCard key={s.id} project={p} space={s} />
          ))}
          <ProjectScripts project={p} />
        </div>
      )}
    </section>
  );
}

/** Orca-style space: git status plus every agent terminal running in it. Only the selected one is highlighted. */
function SpaceCard({ project, space, showProject }: { project: Project; space: Space; showProject?: boolean }) {
  useNow();
  const selected = useStore((s) => s.config.layout.activeProjectId === project.id && selectActiveSpace(s)?.id === space.id);
  const terms = useStore((s) => s.terms);
  const agentStatus = useStore((s) => s.agentStatus);
  const subagents = useStore((s) => s.subagents);

  const mine = Object.values(terms).filter((t) => spaceOfPath(t.cwd)?.id === space.id);
  const agents = mine.filter((t) => t.agent).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const scripts = mine.filter((t) => t.scriptId);
  const running = scripts.some((t) => t.status === "running" || t.status === "stopping");
  const failed = !running && scripts.some(isFailed);
  const isPrimary = space.dir === project.path;
  const finishedUnseen = agents.some((t) => agentStatus[t.key]?.unseen);
  // Beam only while one of this space's agents is actively working.
  const working = agents.some((t) => t.status === "running" && agentStatus[t.key]?.state === "working");
  const theme = useStore((s) => s.config.settings.theme);

  const card = (
    <div
      className={cx("space-card", selected && "selected", finishedUnseen && "agent-done")}
      onClick={() => setActiveSpace(project.id, space.id)}
      title={finishedUnseen ? `${space.dir}\nAn agent finished here — click to view` : space.dir}
      role="button"
      aria-pressed={selected}
    >
      <div className="card-row">
        <span className="card-title">{space.name}</span>
        {showProject && (
          <span className="space-project">
            <ProjectIcon icon={project.icon} color={project.color} size={12} /> {project.name}
          </span>
        )}
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
      <SpaceGit project={project} space={space} />
      {agents.length > 0 && (
        <div className="agent-rows">
          {agents.map((t) => (
            <Fragment key={t.key}>
              <AgentRow t={t} st={agentStatus[t.key]} />
              <SubagentTree nodes={subagents[t.key] ?? []} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
  if (!working) return card;
  const dark = theme === "system" ? document.documentElement.dataset.theme !== "light" : theme === "dark";
  return (
    <BorderBeam size="md" colorVariant="ocean" theme={dark ? "dark" : "light"} borderRadius={10} strength={0.7} active={!reducedMotion.matches}>
      {card}
    </BorderBeam>
  );
}

const repoName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A space's git line (space card and project bar): branch + changes, or repo count + changes for several repos. */
export function SpaceGit({ project, space }: { project: Project; space: Space }) {
  const projectRepos = useStore((s) => s.repos[project.id]);
  const statuses = useStore((s) => s.status);
  const repo = repoOf(space.dir);
  const st = repo ? statuses[repo.path] : undefined;
  const changes = repo ? spaceChanges(space.dir, repo.path, st) : undefined;
  // Other git repos inside the space's folder (e.g. a workspace dir holding several repos).
  const nested = (projectRepos ?? []).filter((r) => r.kind !== "worktree" && r.path !== repo?.path && r.path.startsWith(space.dir + "/"));
  const init = () =>
    api
      .init(space.dir)
      .then(() => discover(project.id))
      .catch(notify);
  if (nested.length) {
    // Several repos: no branch, just "N of M Git Repos" + all changes combined (breakdown in the tooltip).
    return (
      <MultiRepoLine
        repos={[
          ...(repo ? [[repoName(repo.path), changes?.length ?? 0] as const] : []),
          ...nested.map((r) => [r.path.slice(space.dir.length + 1), statuses[r.path]?.files.length ?? 0] as const),
        ]}
      />
    );
  }
  if (repo) return <RepoLine st={st} changed={changes?.length ?? 0} />;
  return (
    <div className="card-sub">
      <button className="link-btn" onClick={stop(init)} title="Run git init in this folder">
        Initialize git
      </button>
    </div>
  );
}

/** A single-repo space's git line: branch, ahead/behind, changed files. */
function RepoLine({ st, changed }: { st?: GitStatus; changed: number }) {
  return (
    <div className="card-sub">
      <Icon name="alt_route" size={12} title="Branch" />
      <span className="ellipsis">{st ? (st.branch ?? `detached @ ${st.oid?.slice(0, 7)}`) : "…"}</span>
      {!!st?.ahead && <span className="sync" title={`${st.ahead} commit(s) to push`}>↑{st.ahead}</span>}
      {!!st?.behind && <span className="sync" title={`${st.behind} commit(s) to pull`}>↓{st.behind}</span>}
      {changed > 0 && <span className="changes">{changed} changed</span>}
    </div>
  );
}

/** A multi-repo space: git icon, repo count, combined changes (per-repo breakdown on hover). */
/** `repos`: [name, changed files] per repo. */
function MultiRepoLine({ repos }: { repos: (readonly [string, number])[] }) {
  const dirty = repos.filter(([, c]) => c > 0).length;
  const changed = repos.reduce((n, [, c]) => n + c, 0);
  return (
    <div className="card-sub" title={repos.map(([n, c]) => `${n}: ${c} changed`).join("\n")}>
      <img className="git-icon" src={iconUrl("git")} alt="" />
      <span>{dirty ? `${dirty} of ${repos.length}` : repos.length} Git Repos</span>
      {changed > 0 && <span className="changes">{changed} changed</span>}
    </div>
  );
}

function AgentRow({ t, st }: { t: Term; st?: AgentStatus }) {
  const a = agentById(t.agent);
  const live = t.status === "running" || t.status === "stopping";
  const working = live && st?.state === "working";
  const label = !live
    ? t.status === "exited" ? "Exited" : "Not running"
    : working ? "Working" : st?.state === "waiting" ? "Needs input" : st?.everWorked ? "Done" : "Idle";
  const name = t.renamed ? t.name : (a?.label ?? "Agent");
  return (
    <div className="agent-row" onClick={stop(() => focusTerminal(t.key))} title={`${t.name} — click to open`}>
      {working ? <Spinner size={12} color={a?.color} title="Working" /> : <AgentIcon agent={t.agent} size={14} />}
      <span className="ellipsis">
        <span className={cx(working && "working-label", st?.state === "waiting" && live && "waiting-label")}>{label}</span> – {name}
      </span>
      <span className="age">{ago(live ? (st?.since ?? t.startedAt) : t.endedAt)}</span>
    </div>
  );
}

/** Claude subagents nested under their spawner (main agent → subagent → sub-subagent …). */
function SubagentTree({ nodes, parent = null, depth = 0 }: { nodes: SubAgentNode[]; parent?: string | null; depth?: number }) {
  // A node whose parent was already cleared shows under the main agent.
  const parentOf = (n: SubAgentNode) => (n.parent && nodes.some((x) => x.id === n.parent) ? n.parent : null);
  const kids = nodes.filter((n) => parentOf(n) === parent).sort((a, b) => a.startedAt - b.startedAt);
  if (!kids.length) return null;
  return (
    <>
      {kids.map((n) => (
        <Fragment key={n.id}>
          <div
            className={cx("subagent-row", !n.running && "done")}
            style={{ "--indent": `${18 + depth * 14}px` } as CSSProperties}
            title={`${n.type}${n.description ? ` — ${n.description}` : ""}\n${n.running ? "Running" : "Finished"}`}
          >
            {n.running ? <Spinner size={10} /> : <Icon name="check_circle" size={12} className="green" />}
            <span className="ellipsis">
              <span className="subagent-type">{n.type}</span>
              {n.description && <span className="dim"> · {n.description}</span>}
            </span>
            <span className="age">{ago(n.running ? n.startedAt : n.endedAt)}</span>
          </div>
          <SubagentTree nodes={nodes} parent={n.id} depth={depth + 1} />
        </Fragment>
      ))}
    </>
  );
}

const isLive = (t?: Term) => t?.status === "running" || t?.status === "stopping";

/**
 * Scripts tab: one flat list like the Terminals popover; a squircle in the project's color tells projects apart.
 * Running scripts are listed; the rest collapse under "Inactive". Both sorted by last start, newest first.
 */
function ScriptsView({ projects }: { projects: Project[] }) {
  const terms = useStore((s) => s.terms);
  const scripts = useStore((s) => s.config.scripts);
  const active = useStore((s) => s.config.projects.find((p) => p.id === s.config.layout.activeProjectId)) ?? projects[0];
  const [showInactive, setShowInactive] = useState(false);
  if (!active) return null;
  const rows = projects
    .flatMap((p) => p.scriptIds.filter((id) => scripts[id]).map((id) => ({ p, id })))
    .sort((a, b) => (scripts[b.id].lastRunAt ?? 0) - (scripts[a.id].lastRunAt ?? 0));
  const running = rows.filter((r) => isLive(terms[r.id]));
  const inactive = rows.filter((r) => !isLive(terms[r.id]));
  const startCount = active.startScriptIds.filter((id) => active.scriptIds.includes(id)).length;
  const row = ({ p, id }: (typeof rows)[number]) => <ScriptRow key={`${p.id}:${id}`} project={p} id={id} />;
  return (
    <>
      <div className="scripts-filter row">
        <span className="sub-head">Running · {running.length}</span>
        <span className="spacer" />
        <IconButton
          icon="play_circle"
          title={`${active.name}: ${startCount ? `start ${startCount} selected script${startCount > 1 ? "s" : ""}` : "start all scripts"}`}
          onClick={() => runStart(active.id)}
          disabled={!active.scriptIds.length}
        />
        <IconButton icon="add" title={`Add script to ${active.name}`} onClick={() => openScriptDialog(active.id)} />
        <IconButton icon="link" title={`Link a script into ${active.name}`} onClick={() => useStore.setState({ dialog: { kind: "link", projectId: active.id } })} />
      </div>
      <div className="scripts">{running.map(row)}</div>
      {!running.length && <p className="empty-note">{rows.length ? "No scripts running." : "No scripts yet."}</p>}
      {inactive.length > 0 && (
        <>
          <button className="link-btn clean-toggle" onClick={() => setShowInactive(!showInactive)} aria-expanded={showInactive}>
            <Icon name={showInactive ? "expand_less" : "expand_more"} size={14} /> Inactive · {inactive.length}
          </button>
          {showInactive && <div className="scripts">{inactive.map(row)}</div>}
        </>
      )}
    </>
  );
}

/** The project's own scripts, under its spaces (the Scripts tab is the cross-project running view). */
function ProjectScripts({ project: p }: { project: Project }) {
  const open = !p.scriptsCollapsed;
  const startCount = p.startScriptIds.filter((id) => p.scriptIds.includes(id)).length;
  return (
    <div className="scripts">
      <div className="sub-head clickable" onClick={() => updateProject(p.id, { scriptsCollapsed: open })} aria-expanded={open} title={open ? "Collapse scripts" : "Expand scripts"}>
        <Icon name={open ? "expand_more" : "chevron_right"} size={14} />
        <span>Scripts{!open && p.scriptIds.length ? ` (${p.scriptIds.length})` : ""}</span>
        <span className="hover-actions always" onClick={(e) => e.stopPropagation()}>
          <IconButton
            icon="play_circle"
            title={startCount ? `Start ${startCount} selected script${startCount > 1 ? "s" : ""}` : "Start all scripts"}
            onClick={() => runStart(p.id)}
            disabled={!p.scriptIds.length}
          />
          <IconButton icon="add" title="Add script" onClick={() => openScriptDialog(p.id)} />
          <IconButton icon="link" title="Link a script from another project" onClick={() => useStore.setState({ dialog: { kind: "link", projectId: p.id } })} />
        </span>
      </div>
      {open && p.scriptIds.map((id) => <ScriptRow key={id} project={p} id={id} inProject />)}
      {open && !p.scriptIds.length && (
        <button className="ghost-add" onClick={() => openScriptDialog(p.id)}>
          <Icon name="add" size={14} /> Add script
        </button>
      )}
    </div>
  );
}

/** `inProject`: listed under its own project, so no squircle / project name. */
function ScriptRow({ project, id, inProject }: { project: Project; id: string; inProject?: boolean }) {
  const s = useStore((st) => st.config.scripts[id]);
  const t = useStore((st) => st.terms[id]);
  if (!s) return null;
  const live = isLive(t);
  const foreign = s.ownerProjectId !== project.id;
  const inStart = project.startScriptIds.includes(id);
  // The terminal tab opens in the active space, so select this row's project first.
  const inProjectSpace = (fn: () => void) =>
    stop(() => {
      setActiveSpace(project.id);
      fn();
    });
  return (
    <div
      className={cx("script-row", live && "live")}
      style={projectStyle(project)}
      onClick={() => {
        setActiveSpace(project.id);
        showScript(id, project.id);
      }}
      title={`${s.command}\n${runnerById(s.runner).id === "custom" ? "sh" : s.runner}${s.ownerProjectId === null ? ` · ${s.cwd}` : ""}`}
    >
      <button className={cx("start-toggle", inStart && "on")} title={inStart ? "Included in Start" : "Include in Start"} aria-pressed={inStart} onClick={stop(() => toggleStartScript(project.id, id))}>
        <Icon name={inStart ? "check_box" : "check_box_outline_blank"} size={14} />
      </button>
      {!inProject && <span className="squircle" title={project.name} />}
      <span className={cx("dot", live ? "green pulse" : isFailed(t) ? "red" : t?.status === "exited" ? "grey" : "hollow")} />
      <span className="script-name">{s.name}</span>
      {foreign && <Icon name={s.ownerProjectId === null ? "public" : "link"} size={13} className="dim" title={s.ownerProjectId === null ? "External script" : "Linked from another project"} />}
      {!inProject && <span className="dim nowrap">{project.name}</span>}
      <span className="hover-actions">
        {live ? (
          <>
            <IconButton icon="restart_alt" title="Restart" onClick={inProjectSpace(() => restart(id))} />
            <IconButton icon="stop" title="Stop" className="red" onClick={stop(() => stopTerm(id))} />
          </>
        ) : (
          <IconButton icon="play_arrow" title="Run" className="green" onClick={inProjectSpace(() => runScript(id))} />
        )}
        <IconButton icon="edit" title="Edit" onClick={stop(() => openScriptDialog(project.id, id))} />
        <IconButton icon={foreign ? "link_off" : "delete"} title={foreign ? "Unlink" : "Delete"} onClick={stop(() => removeScript(project.id, id))} />
      </span>
    </div>
  );
}
