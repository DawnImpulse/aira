import type { AiCfg, Settings } from "../ipc";

/**
 * ok: not used for training by default.
 * caution: training/human review possible depending on plan or login; the user must acknowledge once.
 * warning: trains by default and/or stores data abroad with no verified API opt-out; the user must acknowledge once.
 * Sources for every note: docs/ai-providers.md (reviewed 2026-09-30).
 */
export type AiRisk = "ok" | "caution" | "warning";

export interface AiProvider {
  id: string;
  label: string;
  group: "Cloud" | "Local" | "Agent CLI" | "Custom";
  kind: AiCfg["kind"];
  baseUrl?: string;
  needsKey?: boolean;
  /** Custom endpoints: key only used if the user saved one. */
  optionalKey?: boolean;
  editableBase?: boolean;
  cli?: string;
  defaultModel?: string;
  /** Where the diff goes and how the provider may use it (shown in Settings, and in the first-use prompt). */
  note: string;
  risk: AiRisk;
}

const cloud = (id: string, label: string, baseUrl: string, note: string, risk: AiRisk = "ok", defaultModel?: string): AiProvider => ({
  id, label, group: "Cloud", kind: "openai", baseUrl, needsKey: true, defaultModel, note, risk,
});
const local = (id: string, label: string, baseUrl: string): AiProvider => ({
  id, label, group: "Local", kind: "openai", baseUrl, editableBase: true, risk: "ok",
  note: "The diff stays on this machine (local server).",
});
const cli = (id: string, label: string, note: string, risk: AiRisk): AiProvider => ({
  id: `cli-${id}`, label, group: "Agent CLI", kind: "cli", cli: id, note, risk,
});

// Official endpoints only. Every non-Anthropic cloud provider speaks the OpenAI chat/completions format.
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "anthropic", label: "Anthropic", group: "Cloud", kind: "anthropic", needsKey: true, defaultModel: "claude-haiku-4-5", risk: "ok",
    note: "Sent to Anthropic's API with your key. API data isn't used for training.",
  },
  cloud("openai", "OpenAI", "https://api.openai.com/v1", "Sent to OpenAI's API with your key. API data isn't used for training by default (kept up to 30 days for abuse monitoring)."),
  cloud(
    "gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
    "Paid tier: not used for training. Free tier: Google may use your code to improve its products and humans may review it, so don't send confidential code with a free key. In the EEA, UK or Switzerland use a paid key.",
    "caution",
  ),
  cloud(
    "openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
    "Routed to the model's upstream provider. OpenRouter doesn't log prompts by default, but some upstream providers train on inputs unless you enable the no-training option in your OpenRouter privacy settings.",
    "caution", "anthropic/claude-haiku-4.5",
  ),
  cloud("groq", "Groq", "https://api.groq.com/openai/v1", "Sent to Groq (US) with your key. Not used for training."),
  cloud(
    "mistral", "Mistral", "https://api.mistral.ai/v1",
    "Paid plans: not used for training. The free Experiment plan may train on your inputs unless you opt out in the Mistral console.",
    "caution",
  ),
  cloud(
    "deepseek", "DeepSeek", "https://api.deepseek.com/v1",
    "Stored and processed in the People's Republic of China, and DeepSeek's privacy policy allows training on it; no API opt-out could be verified. Avoid for confidential or client code.",
    "warning",
  ),
  cloud("xai", "xAI (Grok)", "https://api.x.ai/v1", "Sent to xAI's API with your key. API inputs aren't used for training and are deleted within 30 days."),
  local("ollama", "Ollama", "http://localhost:11434/v1"),
  local("lmstudio", "LM Studio", "http://localhost:1234/v1"),
  cli(
    "claude", "Claude Code (claude -p)",
    "Runs your installed `claude` with your own login (Anthropic's documented headless mode). The IDE never reads your Claude credentials. Handling follows your Claude account's terms and privacy settings.",
    "ok",
  ),
  cli(
    "codex", "Codex (codex exec)",
    "Runs your installed `codex` with your own login. With a ChatGPT Plus/Pro login, OpenAI may train on it unless \"Improve the model for everyone\" is off; API-key and Business/Enterprise logins aren't used for training.",
    "caution",
  ),
  cli(
    "gemini", "Gemini CLI (gemini -p)",
    "Runs your installed `gemini` with your own login. With a personal Google account, Google may use prompts and code to improve its products (human review possible) unless you opt out; Vertex AI or paid Code Assist logins aren't used for training.",
    "caution",
  ),
  cli(
    "opencode", "OpenCode (opencode run)",
    "Runs your installed `opencode`; the diff goes to whichever model provider opencode is configured with, under that provider's terms.",
    "caution",
  ),
  {
    id: "custom", label: "Custom OpenAI-compatible", group: "Custom", kind: "openai", optionalKey: true, editableBase: true, risk: "caution",
    note: "Sent to the endpoint you configure; that service's terms apply.",
  },
];

export const aiProvider = (id: string) => AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];

/** Backend config for the selected provider. The Keychain entry is named after the provider id. */
export function aiCfg(ai: Settings["ai"]): AiCfg {
  const p = aiProvider(ai.provider);
  return {
    kind: p.kind,
    baseUrl: ai.baseUrls[p.id]?.trim() || p.baseUrl,
    keyId: p.needsKey || (p.optionalKey && ai.keySaved[p.id]) ? p.id : undefined,
    model: ai.models[p.id] ?? p.defaultModel ?? "",
    cli: p.cli,
    label: p.label,
  };
}
