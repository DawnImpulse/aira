import { Fragment, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, type Settings } from "../ipc";
import { notify, updateConfig, useStore } from "../store";
import { AI_PROVIDERS, aiCfg, aiProvider } from "../lib/aiProviders";
import { AGENTS, availableAgents, hasBinary } from "../lib/agents";
import { SHORTCUTS } from "../lib/shortcuts";
import { checkForUpdates, dismissUpdate, installUpdate, lastChecked, restartForUpdate } from "../lib/updates";
import { UpdateProgress } from "./UpdateStatus";
import { AgentIcon, cx, Icon, Modal, useNow } from "./ui";

// Fallbacks if the installed-font lookup fails (non-macOS or CoreText error).
const UI_FONTS = ["Inter", "Helvetica Neue", "Helvetica", "Avenir Next", "IBM Plex Sans", "Geist", "Roboto", "Open Sans", "Lato", "Source Sans 3", "Nunito", "Manrope", "DM Sans"];
const MONO_FONTS = ["SF Mono", "Menlo", "Monaco", "Courier New", "JetBrains Mono", "Fira Code", "Cascadia Code", "IBM Plex Mono", "Source Code Pro", "Geist Mono", "Hack", "Iosevka", "Victor Mono", "Roboto Mono", "Ubuntu Mono", "Inconsolata"];

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "agents", label: "Coding agents", icon: "smart_toy" },
  { id: "notifications", label: "Notifications", icon: "notifications" },
  { id: "ai", label: "Commit messages", icon: "auto_awesome" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  { id: "updates", label: "Updates", icon: "system_update_alt" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

/** Native select: a <datalist> filters by the current value, so it only ever offered the font already set. */
function FontSelect({ value, fonts, onChange }: { value: string; fonts: string[]; onChange: (f: string) => void }) {
  const list = fonts.includes(value) ? fonts : [value, ...fonts]; // keep a saved font that's no longer installed
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );
}

let installedFonts: Promise<{ all: string[]; mono: string[] }> | null = null;
let lastSection: Section = "appearance"; // reopening lands where you left off

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.config.settings);
  const upd = (fn: (s: Settings) => void) => updateConfig((c) => fn(c.settings));
  const [section, setSection] = useState(lastSection);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [cliFound, setCliFound] = useState<boolean | null>(null);
  const p = aiProvider(s.ai.provider);
  const saved = !!s.ai.keySaved[p.id];
  const [fonts, setFonts] = useState({ all: UI_FONTS, mono: MONO_FONTS });
  const [installedAgents, setInstalledAgents] = useState<Set<string> | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    installedFonts ??= api.listFonts().catch(() => ({ all: [], mono: [] }));
    installedFonts.then((f) => f.all.length && setFonts(f));
    availableAgents().then(setInstalledAgents);
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const pick = (id: Section) => setSection((lastSection = id));
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

  const appearance = (
    <>
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
        <FontSelect value={s.uiFont} fonts={["System", ...fonts.all]} onChange={(f) => upd((x) => void (x.uiFont = f))} />
      </label>

      <div className="row gap">
        <label className="field grow">
          <span>Editor & terminal font</span>
          <FontSelect value={s.monoFont} fonts={fonts.mono} onChange={(f) => upd((x) => void (x.monoFont = f))} />
        </label>
        <label className="field">
          <span>Size</span>
          <input type="number" min={9} max={28} value={s.fontSize} onChange={(e) => upd((x) => void (x.fontSize = Math.min(28, Math.max(9, Number(e.target.value) || 13))))} />
        </label>
      </div>
      <small className="dim">
        {fonts.all.length} installed fonts ({fonts.mono.length} monospace). With a list open, type a name to jump to it.
      </small>

      <label className="check">
        <input type="checkbox" checked={s.terminalWebgl} onChange={(e) => upd((x) => void (x.terminalWebgl = e.target.checked))} />
        <span>GPU (WebGL) terminal rendering – faster for heavy output; turn off if terminals render blank.</span>
      </label>
    </>
  );

  const notifications = (
    <>
      <label className="check">
        <input type="checkbox" checked={s.notifyAgents} onChange={(e) => upd((x) => void (x.notifyAgents = e.target.checked))} />
        <span>Notify me when a coding agent finishes, needs input, or exits (only when I'm not looking at it).</span>
      </label>
      <div className="row gap">
        <button type="button" className="btn" onClick={() => api.notifyAgent("", "Aira", "Test notification – banners are working.").catch(notify)}>
          Send a test notification
        </button>
      </div>
      <small className="dim">
        Nothing showing? Allow Aira under System Settings → Notifications. A dev build that isn't installed in /Applications posts its banners as “Terminal”.
      </small>
    </>
  );

  const agents = (
    <>
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
    </>
  );

  const ai = (
    <>
      <small className="dim">The AI that writes a commit message when you press Generate while committing.</small>
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
            <Icon name="lock" size={12} /> Stored only in your macOS Keychain (service “com.codevry.aira”); never written to Aira's config or logs.
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
    </>
  );

  return (
    <Modal title="Settings" onClose={onClose} width={720}>
      <div className="settings">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          {SECTIONS.map((x) => (
            <button key={x.id} role="tab" aria-selected={section === x.id} className={cx(section === x.id && "on")} onClick={() => pick(x.id)}>
              <Icon name={x.icon} size={16} /> {x.label}
            </button>
          ))}
          {version && <span className="settings-version" onClick={() => pick("updates")}>Aira {version}</span>}
        </nav>
        <div className="form settings-pane" role="tabpanel">
          <h3>{SECTIONS.find((x) => x.id === section)?.label}</h3>
          {section === "appearance" && appearance}
          {section === "agents" && agents}
          {section === "notifications" && notifications}
          {section === "ai" && ai}
          {section === "updates" && <Updates version={version} />}
          {section === "shortcuts" && (
            <dl className="shortcuts">
              {SHORTCUTS.map((k) => (
                <Fragment key={k.keys}>
                  <dt>{k.keys}</dt>
                  <dd>{k.label}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Modal>
  );
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Settings → Updates: the same state as the bottom-right card (lib/updates), shown even when the card was dismissed. */
function Updates({ version }: { version: string }) {
  const u = useStore((s) => s.update);
  useNow(30_000);
  const last = lastChecked();
  const v = u?.version ? `Aira ${u.version}` : "Aira";
  const check = (
    <button type="button" className="btn" onClick={() => checkForUpdates(true)}>
      <Icon name="refresh" size={14} /> Check for updates
    </button>
  );
  return (
    <>
      <div className="field">
        <span>Installed version</span>
        <div>Aira {version || "…"}</div>
      </div>
      {u?.stage === "available" && (
        <div className="update-box">
          <b>{v} is available</b>
          <span className="dim">Everything keeps running while it downloads.</span>
          {u.notes && <pre className="update-notes scroll">{u.notes}</pre>}
          <div className="row gap">
            <button type="button" className="btn primary" onClick={installUpdate}>Update</button>
          </div>
        </div>
      )}
      {u?.stage === "downloading" && (
        <div className="update-box">
          <b>Downloading {v}…</b>
          <UpdateProgress u={u} />
        </div>
      )}
      {u?.stage === "installed" && (
        <div className="update-box">
          <b>{v} is ready</b>
          <span className="dim">Restart to finish. Your terminals and tabs come back as they are.</span>
          <div className="row gap">
            <button type="button" className="btn primary" onClick={restartForUpdate}>Restart now</button>
          </div>
        </div>
      )}
      {u?.stage === "upToDate" && <small className="green"><Icon name="check_circle" size={13} /> You're on the latest version.</small>}
      {u?.stage === "error" && (
        <small className="red">
          Update failed: {u.error}{" "}
          <button type="button" className="link-btn" onClick={dismissUpdate}>dismiss</button>
        </small>
      )}
      {(!u || u.stage === "upToDate" || u.stage === "error") && <div className="row gap">{check}</div>}
      <small className="dim">
        Aira checks automatically every 12 hours{last ? `; last checked ${ago(last)}.` : "."} Updates download in the background and apply on the next restart.
      </small>
    </>
  );
}
