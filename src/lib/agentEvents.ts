import type { HookEvent } from "../ipc";
import type { AgentStatus, SubAgentNode } from "../store";

/**
 * Agent-neutral events. Each agent adapter maps its raw hook/plugin payloads to these; one fold
 * builds the subagent tree and main-agent status for every agent (plan 004).
 */
export type AgentEvent =
  | { kind: "prompt" } // main agent got a prompt → working
  | { kind: "stop" } // main agent finished its turn
  | { kind: "waiting" } // main agent needs input / permission
  | { kind: "spawn"; caller: string | null; type?: string; description?: string } // a subagent is about to start
  | { kind: "sub_start"; id?: string; parent?: string | null; type?: string; description?: string }
  | { kind: "sub_stop"; id?: string; type?: string }
  | { kind: "link"; parent: string | null; child: string; done?: boolean };

type Raw = HookEvent & Record<string, unknown>;
type Normalizer = (e: Raw) => AgentEvent[];

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const input = (e: Raw) => (e.tool_input ?? {}) as Record<string, unknown>;

/** Claude Code hooks (https://code.claude.com/docs/en/hooks). */
const claude: Normalizer = (e) => {
  const caller = e.agent_id ?? null; // set when the event comes from inside a subagent
  switch (e.hook_event_name) {
    case "PreToolUse":
      return [{ kind: "spawn", caller, type: str(input(e).subagent_type), description: str(input(e).description) }];
    case "SubagentStart":
      return e.agent_id ? [{ kind: "sub_start", id: e.agent_id, type: e.agent_type }] : [];
    case "PostToolUse": {
      const child = e.tool_response?.agentId;
      return child ? [{ kind: "link", parent: caller, child, done: e.tool_response?.status === "completed" }] : [];
    }
    case "SubagentStop":
      return [{ kind: "sub_stop", id: e.agent_id, type: e.agent_type }];
    case "UserPromptSubmit":
      return caller ? [] : [{ kind: "prompt" }];
    case "Stop":
      return caller ? [] : [{ kind: "stop" }];
    case "Notification": {
      // Only real asks. idle_prompt fires 60s after a finished turn, and auth_success, agent_completed,
      // quota_auto_resume_* etc. are status reports, so none of those count as "needs input".
      const t = str(e.notification_type) ?? "";
      const asks = ["permission_prompt", "agent_needs_input"].includes(t) || t.startsWith("elicitation");
      return caller || !asks ? [] : [{ kind: "waiting" }];
    }
  }
  return [];
};

/** Tagged payloads from repo-hook files: `{ ide_hook: "<event>", payload: {...} }`. */
const tagged = (map: (ev: string, p: Record<string, unknown>) => AgentEvent[]): Normalizer => (e) =>
  typeof e.ide_hook === "string" ? map(e.ide_hook, (e.payload ?? {}) as Record<string, unknown>) : [];
const tin = (p: Record<string, unknown>) => (p.tool_input ?? {}) as Record<string, unknown>;

/** Gemini CLI: no subagent events (subagents can't nest); exact main status only. */
const gemini: Normalizer = (e) =>
  e.hook_event_name === "BeforeAgent" ? [{ kind: "prompt" }] : e.hook_event_name === "AfterAgent" ? [{ kind: "stop" }] : e.hook_event_name === "Notification" ? [{ kind: "waiting" }] : [];

/** Codex (.codex/hooks.json): SubagentStart/Stop carry agent_id/agent_type; no parent field (shown top-level). */
const codex = tagged((ev, p) => {
  if (ev === "SubagentStart") return [{ kind: "sub_start", id: str(p.agent_id), parent: null, type: str(p.agent_type) }];
  if (ev === "SubagentStop") return [{ kind: "sub_stop", id: str(p.agent_id), type: str(p.agent_type) }];
  return ev === "UserPromptSubmit" ? [{ kind: "prompt" }] : ev === "Stop" ? [{ kind: "stop" }] : ev === "PermissionRequest" ? [{ kind: "waiting" }] : [];
});

/** Factory Droid: no SubagentStart — the Task tool call starts it; SubagentStop matches by name. */
const droid = tagged((ev, p) => {
  if (ev === "PreToolUse") {
    const i = tin(p);
    return [{ kind: "sub_start", parent: null, type: str(i.subagent_type) ?? str(i.task_name), description: str(i.description) ?? str(i.prompt)?.slice(0, 80) }];
  }
  if (ev === "SubagentStop") return [{ kind: "sub_stop", type: str(p.task_name) }];
  return ev === "UserPromptSubmit" ? [{ kind: "prompt" }] : ev === "Stop" ? [{ kind: "stop" }] : ev === "Notification" ? [{ kind: "waiting" }] : [];
});

/** GitHub Copilot CLI (.github/hooks/*.json): subagents identified by agentName. */
const copilot = tagged((ev, p) => {
  if (ev === "subagentStart") return [{ kind: "sub_start", parent: null, type: str(p.agentName), description: str(p.agentDescription) ?? str(p.agentDisplayName) }];
  if (ev === "subagentStop") return [{ kind: "sub_stop", type: str(p.agentName) }];
  return ev === "userPromptSubmitted" ? [{ kind: "prompt" }] : ev === "agentStop" ? [{ kind: "stop" }] : ev === "permissionRequest" ? [{ kind: "waiting" }] : [];
});

/** Cursor Agent (.cursor/hooks.json): subagent events only (status stays on the activity heuristic). */
const cursor = tagged((ev, p) => {
  if (ev === "subagentStart") return [{ kind: "sub_start", id: str(p.subagent_id), parent: null, type: str(p.subagent_type), description: str(p.task) }];
  if (ev === "subagentStop") return [{ kind: "sub_stop", id: str(p.subagent_id), type: str(p.subagent_type) }];
  return [];
});

/** Goose: no subagent events are emitted; prompt/turn-end only. */
const goose = tagged((ev) => (ev === "UserPromptSubmit" ? [{ kind: "prompt" }] : ev === "Stop" ? [{ kind: "stop" }] : []));

/** Payloads our own generated plugins (e.g. OpenCode's) write already normalized: `{ ide_event: AgentEvent }`. */
const passthrough = (e: Raw): AgentEvent[] | null => (e.ide_event ? [e.ide_event as AgentEvent] : null);

// Qwen Code's hooks are Claude-compatible (same event names and agent_id / subagent fields).
export const NORMALIZERS: Record<string, Normalizer> = { claude, qwen: claude, gemini, codex, droid, copilot, cursor, goose };

export function normalize(agent: string, raw: Raw): AgentEvent[] {
  return passthrough(raw) ?? NORMALIZERS[agent]?.(raw) ?? [];
}

// ---------- fold ----------

export interface TreeState {
  pending: { caller: string | null; type?: string; description?: string }[];
  nodes: Map<string, SubAgentNode>;
  seq: number;
}
export const emptyTree = (): TreeState => ({ pending: [], nodes: new Map(), seq: 0 });

/** Applies events to the tree; returns the main agent's new state if an event set it. */
export function fold(h: TreeState, events: AgentEvent[], now = Date.now()): AgentStatus["state"] | null {
  let main: AgentStatus["state"] | null = null;
  for (const e of events) {
    switch (e.kind) {
      case "spawn":
        h.pending.push({ caller: e.caller, type: e.type, description: e.description });
        break;
      case "sub_start": {
        let p: TreeState["pending"][number] | undefined;
        if (e.parent === undefined) {
          const i = h.pending.findIndex((x) => !x.type || !e.type || x.type === e.type);
          p = i >= 0 ? h.pending.splice(i, 1)[0] : undefined;
        }
        const id = e.id ?? `sub-${++h.seq}`; // some agents (e.g. Droid) give no subagent id
        h.nodes.set(id, {
          id,
          type: e.type ?? p?.type ?? "agent",
          description: e.description ?? p?.description,
          parent: e.parent !== undefined ? e.parent : (p?.caller ?? null),
          running: true,
          startedAt: now,
        });
        break;
      }
      case "sub_stop": {
        // By id; else the oldest running node of that type (agents without subagent ids).
        const n = (e.id && h.nodes.get(e.id)) || [...h.nodes.values()].find((x) => x.running && (!e.type || x.type === e.type));
        if (n) {
          n.running = false;
          n.endedAt = now;
        }
        break;
      }
      case "link": {
        const n = h.nodes.get(e.child);
        if (n) {
          n.parent = e.parent;
          if (e.done) {
            n.running = false;
            n.endedAt ??= now;
          }
        }
        break;
      }
      case "prompt":
        main = "working";
        for (const [id, n] of h.nodes) if (!n.running) h.nodes.delete(id); // new turn: drop finished subagents
        h.pending = [];
        break;
      case "stop":
        main = "idle";
        break;
      case "waiting":
        main = "waiting";
        break;
    }
  }
  return main;
}
