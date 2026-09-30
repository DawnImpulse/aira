import { api } from "../ipc";
import claude from "../assets/agents/claude.svg";
import codex from "../assets/agents/codex.svg";
import gemini from "../assets/agents/gemini.svg";
import opencode from "../assets/agents/opencode.svg";
import aider from "../assets/agents/aider.png";
import cursor from "../assets/agents/cursor.svg";
import copilot from "../assets/agents/copilot.svg";
import amp from "../assets/agents/amp.svg";
import goose from "../assets/agents/goose.svg";
import qwen from "../assets/agents/qwen.svg";
import crush from "../assets/agents/crush.png";
import droid from "../assets/agents/droid.svg";

export interface Agent {
  id: string;
  label: string;
  /** Executable checked on PATH. */
  bin: string;
  /** What the terminal runs. */
  command: string;
  icon: string;
  /** Single-color logo drawn with `currentColor`: rendered as a mask in the theme's text color. */
  mono?: boolean;
  /** Brand color (orbs, accents). */
  color: string;
}

// Logos: see src/assets/agents/NOTICE.md.
export const AGENTS: Agent[] = [
  { id: "claude", label: "Claude Code", bin: "claude", command: "claude", icon: claude, color: "#D97757" },
  { id: "codex", label: "Codex", bin: "codex", command: "codex", icon: codex, color: "#7A9DFF" },
  { id: "gemini", label: "Gemini CLI", bin: "gemini", command: "gemini", icon: gemini, color: "#4796E3" },
  { id: "opencode", label: "OpenCode", bin: "opencode", command: "opencode", icon: opencode, mono: true, color: "#A1A1AA" },
  { id: "aider", label: "Aider", bin: "aider", command: "aider", icon: aider, color: "#14B014" },
  { id: "cursor", label: "Cursor Agent", bin: "cursor-agent", command: "cursor-agent", icon: cursor, mono: true, color: "#A1A1AA" },
  { id: "copilot", label: "GitHub Copilot CLI", bin: "copilot", command: "copilot", icon: copilot, mono: true, color: "#A1A1AA" },
  { id: "amp", label: "Amp", bin: "amp", command: "amp", icon: amp, color: "#F34E3F" },
  { id: "goose", label: "Goose", bin: "goose", command: "goose session", icon: goose, mono: true, color: "#A1A1AA" },
  { id: "qwen", label: "Qwen Code", bin: "qwen", command: "qwen", icon: qwen, color: "#615CED" },
  { id: "crush", label: "Crush", bin: "crush", command: "crush", icon: crush, color: "#FF5FD2" },
  { id: "droid", label: "Factory Droid", bin: "droid", command: "droid", icon: droid, color: "#EE6018" },
];

export const agentById = (id?: string) => AGENTS.find((a) => a.id === id);

let installed: Promise<Set<string>> | null = null;
/** Agent ids whose CLI is on the login-shell PATH (cached). */
export function availableAgents(): Promise<Set<string>> {
  installed ??= api.which(AGENTS.map((a) => a.bin)).then((bins) => new Set(AGENTS.filter((a) => bins.includes(a.bin)).map((a) => a.id)));
  return installed;
}

/** Same check for arbitrary binaries (AI CLI providers). */
export const hasBinary = (bin: string) => api.which([bin]).then((b) => b.length > 0);
