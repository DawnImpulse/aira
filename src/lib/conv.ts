/**
 * A Claude Code transcript folded into conversation items for the phone (MOBILE.md `conv`).
 * Pure: `fold` takes the lines `agent_transcript` tailed and returns the ids it added or changed.
 * Items live in an insertion-ordered Map, so the backlog is just the last N values.
 */
import type { TranscriptLine } from "../ipc";

export interface ConvItem {
  id: string;
  role: "user" | "assistant" | "tool" | "prompt";
  ts: number;
  text?: string;
  /** tool: name plus a one-line summary of its input. */
  title?: string;
  /** tool: result excerpt. */
  detail?: string;
  status?: "pending" | "done" | "error";
}

export const DETAIL_CAP = 2048;
const TEXT_CAP = 8192;
const TITLE_CAP = 100;

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ms = (t: unknown) => (typeof t === "string" ? Date.parse(t) || Date.now() : Date.now());

/** Text of a tool_result or user content: a string, or text blocks joined. */
function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return (c as Block[])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n");
}

/** One line for a tool call: the field a person would look at first. */
export function toolTitle(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : undefined);
  const pick = str("command") ?? str("file_path") ?? str("pattern") ?? str("description") ?? str("url") ?? str("query") ?? str("prompt") ?? str("skill") ?? Object.values(i).find((v): v is string => typeof v === "string");
  const one = (pick ?? "").split("\n")[0].trim();
  return cap(one ? `${name} ${one}` : name, TITLE_CAP);
}

/** Slash commands arrive wrapped in tags; show the command. Local command output isn't a message. */
function userText(raw: string): string | null {
  if (raw.startsWith("<local-command")) return null;
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(raw);
  if (cmd) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(raw)?.[1]?.trim();
    return args ? `${cmd[1].trim()} ${args}` : cmd[1].trim();
  }
  return raw.startsWith("<") && raw.includes("</") ? null : raw;
}

/** Folds `lines` into `items`; returns the ids added or changed, in order. */
export function fold(items: Map<string, ConvItem>, lines: TranscriptLine[]): string[] {
  const changed: string[] = [];
  const put = (it: ConvItem) => {
    items.set(it.id, it);
    changed.push(it.id);
  };
  for (const l of lines) {
    if (l.isMeta) continue;
    const ts = ms(l.timestamp);
    const blocks = Array.isArray(l.content) ? (l.content as Block[]) : null;
    if (l.type === "user") {
      if (typeof l.content === "string") {
        const text = userText(l.content);
        if (text) put({ id: l.uuid, role: "user", ts, text: cap(text, TEXT_CAP) });
        continue;
      }
      // tool_result blocks are the tool's output, not a user message: fold into the tool item.
      let text = "";
      for (const b of blocks ?? []) {
        if (b.type === "tool_result" && b.tool_use_id) {
          const tool = items.get(b.tool_use_id);
          if (!tool) continue;
          tool.detail = cap(textOf(b.content), DETAIL_CAP);
          tool.status = b.is_error ? "error" : "done";
          changed.push(tool.id);
        } else if (b.type === "text" && b.text) text += (text ? "\n" : "") + b.text;
      }
      const t = text && userText(text);
      if (t) put({ id: l.uuid, role: "user", ts, text: cap(t, TEXT_CAP) });
    } else if (l.type === "assistant") {
      (blocks ?? []).forEach((b, i) => {
        if (b.type === "text" && b.text?.trim()) put({ id: `${l.uuid}:${i}`, role: "assistant", ts, text: cap(b.text, TEXT_CAP) });
        else if (b.type === "tool_use" && b.id) put({ id: b.id, role: "tool", ts, title: toolTitle(b.name ?? "tool", b.input), status: "pending" });
      });
    }
  }
  return [...new Set(changed)];
}
