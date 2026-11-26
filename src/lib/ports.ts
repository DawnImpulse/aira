import { ask } from "./dialog";
import { api, type PortInfo, type Project, type Script } from "../ipc";
import { notify, projectOf, scriptCwd, updateConfig, useStore } from "../store";
import { stop } from "./terminals";

const get = () => useStore.getState();

/** Re-reads the listening ports and remembers which ones each running script uses. */
export async function refreshPorts() {
  const ports = await api.portsList().catch(() => null);
  if (!ports) return;
  useStore.setState({ ports });
  const { terms, config } = get();
  const seen: [string, number[]][] = [];
  for (const t of Object.values(terms)) {
    if (!t.scriptId || !t.sessionId || !config.scripts[t.scriptId]) continue;
    const mine = [...new Set(ports.filter((p) => p.session === t.sessionId).map((p) => p.port))].sort((a, b) => a - b);
    if (mine.length && mine.join() !== config.scripts[t.scriptId].ports?.join()) seen.push([t.scriptId, mine]);
  }
  if (seen.length) updateConfig((c) => seen.forEach(([id, ports]) => c.scripts[id] && (c.scripts[id].ports = ports)));
}

// ponytail: polls lsof (~40ms) every 5s while the window has focus. A script's ports are only
// learned while it runs and we're polling; push from the Rust mem thread if that proves too coarse.
setInterval(() => document.hasFocus() && refreshPorts(), 5000);

/** The IDE terminal (script, shell or agent) a listener runs in. */
export const termOfPort = (p: PortInfo) => (p.session ? Object.values(get().terms).find((t) => t.sessionId === p.session) : undefined);

/** Project a listener belongs to: its terminal's, else the project its working dir is in (started outside the IDE). */
export const projectOfPort = (p: PortInfo) => termOfPort(p)?.projectId ?? (p.cwd ? projectOf(p.cwd)?.id : undefined);

/** Stops the script that holds the port; anything else is force closed after a confirm. */
export async function freePort(p: PortInfo) {
  const t = termOfPort(p);
  if (t?.scriptId) stop(t.key);
  else {
    const ok = await ask(`Force close ${p.name} (pid ${p.pid}) listening on :${p.port}?\n\n${p.cmd}`, {
      title: "Free port",
      kind: "warning",
      okLabel: "Force close",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await api.killPid(p.pid).catch(notify);
  }
  setTimeout(refreshPorts, 500);
  setTimeout(refreshPorts, 3500); // terminate() waits up to 3s before SIGKILL
}

// ---------- expected ports (scripts that aren't running) ----------

const FLAG = /(?:--port[=\s]+|\s-p\s+|\bPORT=)(\d{2,5})\b/;
/** `tool`, but not `tool build|lint|…`. */
const dev = (tool: string) => new RegExp(`\\b${tool}(?!\\s+(build|lint|test|check|generate|export|sync|format|typecheck|optimize))\\b`);
const DEFAULTS: [RegExp, number][] = [
  [/\bvite\s+preview\b/, 4173],
  [dev("vite"), 5173],
  [dev("next"), 3000],
  [dev("nuxi?"), 3000],
  [dev("astro"), 4321],
  [/\bremix\s+dev\b/, 3000],
  [/\bng\s+serve\b/, 4200],
  [/\breact-scripts\s+start\b/, 3000],
  [/\bstorybook\s+dev\b|\bstart-storybook\b/, 6006],
  [/\bexpo\s+start\b/, 8081],
  [/\bgatsby\s+develop\b/, 8000],
  [/\bwebpack(-dev-server|\s+serve)\b/, 8080],
  [/\bdocusaurus\s+start\b/, 3000],
  [/\bwrangler\s+dev\b/, 8787],
  [/\bvercel\s+dev\b/, 3000],
  [/\bnetlify\s+dev\b/, 8888],
  [/\bmanage\.py\s+runserver\b/, 8000],
  [/\bflask\s+run\b/, 5000],
  [/\buvicorn\b|\bfastapi\s+dev\b/, 8000],
  [/\bhttp\.server\b/, 8000],
  [/\brails\s+s(erver)?\b/, 3000],
  [/\bartisan\s+serve\b/, 8000],
  [/\bhugo\s+server\b/, 1313],
  [/\bjekyll\s+serve\b/, 4000],
];

/** Port a command will most likely listen on: an explicit flag, else its tool's default. */
export function guessPort(text: string): number | undefined {
  const m = FLAG.exec(text);
  if (m) return Number(m[1]);
  return DEFAULTS.find(([re]) => re.test(text))?.[1];
}

const JS_RUNNERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const pkgScripts = (dir: string): Promise<Record<string, string>> =>
  api
    .readFile(`${dir}/package.json`)
    .then((t) => JSON.parse(t).scripts ?? {})
    .catch(() => ({}));

export interface Expected {
  port: number;
  /** Who expects it: a script name, or a package.json script. */
  label: string;
  guessed: boolean;
}

/** Ports a project's scripts use: remembered from earlier runs, else guessed from the command (package.json scripts too). */
export async function expectedPorts(p: Project): Promise<Expected[]> {
  const out: Expected[] = [];
  const add = (port: number | undefined, label: string, guessed: boolean) => port && !out.some((e) => e.port === port) && out.push({ port, label, guessed });
  const scripts = p.scriptIds.map((id) => get().config.scripts[id]).filter((s): s is Script => !!s);
  for (const s of scripts) {
    if (s.ports?.length) s.ports.forEach((port) => add(port, s.name, false));
    else {
      const resolved = JS_RUNNERS.has(s.runner) ? ((await pkgScripts(scriptCwd(s)))[s.target] ?? "") : "";
      add(guessPort(`${s.command} ${resolved}`), s.name, true);
    }
  }
  for (const [name, cmd] of Object.entries(await pkgScripts(p.path))) add(guessPort(cmd), `package.json · ${name}`, true);
  return out.sort((a, b) => a.port - b.port);
}
