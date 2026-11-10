import { Fragment, useEffect, useState } from "react";
import { api, type Settings } from "../ipc";
import { notify, updateConfig, useStore } from "../store";
import { AI_PROVIDERS, aiCfg, aiProvider } from "../lib/aiProviders";
import { AGENTS, availableAgents, hasBinary } from "../lib/agents";
import { SHORTCUTS } from "../lib/shortcuts";
import { AgentIcon, cx, Icon, Modal } from "./ui";

// Fallbacks if the installed-font lookup fails (non-macOS or CoreText error).
const UI_FONTS = ["Inter", "Helvetica Neue", "Helvetica", "Avenir Next", "IBM Plex Sans", "Geist", "Roboto", "Open Sans", "Lato", "Source Sans 3", "Nunito", "Manrope", "DM Sans"];
const MONO_FONTS = ["SF Mono", "Menlo", "Monaco", "Courier New", "JetBrains Mono", "Fira Code", "Cascadia Code", "IBM Plex Mono", "Source Code Pro", "Geist Mono", "Hack", "Iosevka", "Victor Mono", "Roboto Mono", "Ubuntu Mono", "Inconsolata"];

let installedFonts: Promise<{ all: string[]; mono: string[] }> | null = null;

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.config.settings);
  const upd = (fn: (s: Settings) => void) => updateConfig((c) => fn(c.settings));
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [cliFound, setCliFound] = useState<boolean | null>(null);
  const p = aiProvider(s.ai.provider);
  const saved = !!s.ai.keySaved[p.id];
  const [fonts, setFonts] = useState({ all: UI_FONTS, mono: MONO_FONTS });
  const [installedAgents, setInstalledAgents] = useState<Set<string> | null>(null);
  useEffect(() => {
    installedFonts ??= api.listFonts().catch(() => ({ all: [], mono: [] }));
    installedFonts.then((f) => f.all.length && setFonts(f));
    availableAgents().then(setInstalledAgents);
  }, []);
  const toggleAgent = (id: string, show: boolean) =>
    upd((x) => {
      const set = new Set(x.hiddenAgents);
      if (show) set.delete(id);
      else set.add(id);
      x.hiddenAgents = [...set];
    });

  useEffect(() => {
    setModels([]);
    setCliFound(null);
    if (p.cli) hasBinary(p.cli).then(setCliFound);
  }, [p.id, p.cli]);

  const saveKey = async (value: string) => {
    try {
      await api.aiSetKey(p.id, value);
      upd((x) => void (x.ai.keySaved = { ...x.ai.keySaved, [p.id]: !!value.trim() }));
      setKey("");
    } catch (e) {
      notify(e);
    }
  };
  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const list = await api.aiListModels(aiCfg(s.ai));
      setModels(list);
      if (!list.length) notify("The provider returned no models; type one in.");
    } catch (e) {
      notify(e);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} width={540}>
      <div className="form">
        <div className="field">
          <span>Theme</span>
          <div className="segmented">
            {(["dark", "light", "system"] as const).map((t) => (
              <button key={t} className={cx(s.theme === t && "on")} onClick={() => upd((x) => void (x.theme = t))}>
                <Icon name={t === "dark" ? "dark_mode" : t === "light" ? "light_mode" : "contrast"} size={14} /> {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Interface font</span>
          <input list="ui-fonts" value={s.uiFont} onChange={(e) => upd((x) => void (x.uiFont = e.target.value))} placeholder="System" title="Type to search installed fonts" />
          <datalist id="ui-fonts">{["System", ...fonts.all].map((f) => <option key={f} value={f} />)}</datalist>
        </label>

        <div className="row gap">
          <label className="field grow">
            <span>Editor & terminal font</span>
            <input list="mono-fonts" value={s.monoFont} onChange={(e) => upd((x) => void (x.monoFont = e.target.value))} title="Type to search installed monospace fonts" />
            <datalist id="mono-fonts">{fonts.mono.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label className="field">
            <span>Size</span>
            <input type="number" min={9} max={28} value={s.fontSize} onChange={(e) => upd((x) => void (x.fontSize = Math.min(28, Math.max(9, Number(e.target.value) || 13))))} />
          </label>
        </div>
        <small className="dim">
          {fonts.all.length} installed fonts ({fonts.mono.length} monospace) — type to search. Unknown names fall back to SF Mono / system.
        </small>

        <label className="check">
          <input type="checkbox" checked={s.notifyAgents} onChange={(e) => upd((x) => void (x.notifyAgents = e.target.checked))} />
          <span>Notify me when a coding agent finishes, needs input, or exits (only when I'm not looking at it).</span>
        </label>

        <label className="check">
          <input type="checkbox" checked={s.terminalWebgl} onChange={(e) => upd((x) => void (x.terminalWebgl = e.target.checked))} />
          <span>GPU (WebGL) terminal rendering – faster for heavy output; turn off if terminals render blank.</span>
        </label>

        <div className="section-title">Coding agents</div>
        <small className="dim">The “+” menu shows installed agents. Hide any you don’t use; enable others once their CLI is installed.</small>
        <div className="agent-list">
          {AGENTS.map((a) => {
            const inst = installedAgents?.has(a.id) ?? false;
            const shown = !s.hiddenAgents.includes(a.id);
            return (
              <label key={a.id} className={cx("agent-opt", !inst && "off")} title={inst ? a.command : `\`${a.bin}\` not found on PATH`}>
                <AgentIcon agent={a.id} size={16} />
                <span className="ellipsis">{a.label}</span>
                {!inst && installedAgents !== null && (
                  <span className="dim small">
                    install <code>{a.bin}</code>
                  </span>
                )}
                <input type="checkbox" disabled={!inst} checked={inst && shown} onChange={(e) => toggleAgent(a.id, e.target.checked)} />
              </label>
            );
          })}
        </div>

        <div className="section-title">Keyboard shortcuts</div>
        <dl className="shortcuts">
          {SHORTCUTS.map((k) => (
            <Fragment key={k.keys}>
              <dt>{k.keys}</dt>
              <dd>{k.label}</dd>
            </Fragment>
          ))}
        </dl>

        <div className="section-title">AI (commit messages)</div>
        <label className="field">
          <span>Provider</span>
          <select className="select" value={p.id} onChange={(e) => upd((x) => void (x.ai.provider = e.target.value))}>
            {(["Cloud", "Local", "Agent CLI", "Custom"] as const).map((g) => (
              <optgroup key={g} label={g}>
                {AI_PROVIDERS.filter((x) => x.group === g).map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {(p.editableBase || p.group === "Custom") && (
          <label className="field">
            <span>Base URL</span>
            <input
              value={s.ai.baseUrls[p.id] ?? ""}
              placeholder={p.baseUrl ?? "https://your-endpoint/v1"}
              spellCheck={false}
              onChange={(e) => upd((x) => void (x.ai.baseUrls = { ...x.ai.baseUrls, [p.id]: e.target.value }))}
            />
          </label>
        )}

        <label className="field">
          <span>Model{p.kind === "cli" ? " (optional – the CLI's default otherwise)" : ""}</span>
          <div className="row gap">
            <input
              className="grow"
              list="ai-models"
              value={s.ai.models[p.id] ?? p.defaultModel ?? ""}
              placeholder={p.kind === "cli" ? "default" : "Pick or type a model id"}
              spellCheck={false}
              onChange={(e) => upd((x) => void (x.ai.models = { ...x.ai.models, [p.id]: e.target.value }))}
            />
            {p.kind !== "cli" && (
              <button type="button" className="btn" onClick={loadModels} disabled={loadingModels || (!!p.needsKey && !saved)} title="Fetch the model list from the provider">
                <Icon name="refresh" size={14} className={cx(loadingModels && "spin")} /> Models
              </button>
            )}
          </div>
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>

        {(p.needsKey || p.optionalKey) && (
          <label className="field">
            <span>
              API key{p.optionalKey ? " (optional)" : ""} {saved && <em className="green">· saved</em>}
            </span>
            <div className="row gap">
              <input
                type="password"
                className="grow"
                value={key}
                placeholder={saved ? "•••••••• (enter a new key to replace)" : `${p.label} API key`}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
              <button type="button" className="btn primary" disabled={!key.trim()} onClick={() => saveKey(key)}>Save</button>
              {saved && <button type="button" className="btn" onClick={() => saveKey("")}>Remove</button>}
            </div>
            <small className="dim">
              <Icon name="lock" size={12} /> Stored only in your macOS Keychain (service “com.codevry.ide”); never written to Aira's config or logs.
            </small>
          </label>
        )}

        {p.cli && cliFound !== null && (
          <small className={cliFound ? "green" : "red"}>
            {cliFound ? `\`${p.cli}\` found – uses your own login and subscription.` : `\`${p.cli}\` not found on PATH – install and sign in to it first.`}
          </small>
        )}
        <small className={cx("privacy-note", `risk-${p.risk}`)}>
          <Icon name={p.risk === "ok" ? "shield" : "warning"} size={13} />
          <span>
            {p.note} Nothing is sent until you press Generate.
            {p.risk !== "ok" && " You'll be asked to confirm once before the first send."}
          </span>
        </small>
      </div>
    </Modal>
  );
}
