import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type BrowserPin, type Tab } from "../ipc";
import { addPin, notify, recordBrowserHistory, removePin, renameServer, selectActiveSpace, setBrowserUrl, useStore } from "../store";
import { projectOfPort, termOfPort } from "../lib/ports";
import { Icon, IconButton } from "./ui";
import { popupMenu } from "../lib/menu";

type BrowserTab = Extract<Tab, { kind: "browser" }>;
const BLANK = "about:blank";

/** Address-bar text → a URL: keep schemes, resolve hosts (localhost/ports/IPs → http, domains →
 * https), else Google search. */
function toUrl(s: string): string {
  s = s.trim();
  if (!s) return BLANK;
  if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s; // explicit scheme
  if (/\s/.test(s)) return `https://www.google.com/search?q=${encodeURIComponent(s)}`; // spaces → search
  const isLocal = /^localhost(?:[:/?#]|$)/i.test(s) || /^\d{1,3}(?:\.\d{1,3}){3}/.test(s);
  const hasPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(s);
  if (isLocal || hasPort) return `http://${s}`;
  if (/^[^\s/?#]+\.[^\s]+/.test(s)) return `https://${s}`; // has a dot → domain
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};
const labelOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

const favicons = new Map<string, Promise<string | null>>();
/** Favicon data URL per origin (fetched by the backend so localhost works). Misses aren't cached,
 * so a server that wasn't up yet gets its icon next time. */
function faviconFor(url: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return Promise.resolve(null);
  }
  let p = favicons.get(origin);
  if (!p) {
    p = api.browserFavicon(url).catch(() => null);
    p.then((d) => !d && favicons.delete(origin));
    favicons.set(origin, p);
  }
  return p;
}

/** Site favicon; a globe until (or unless) one loads. */
export function Favicon({ url, size = 22 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (/^https?:/i.test(url)) faviconFor(url).then((d) => alive && setSrc(d));
    return () => void (alive = false);
  }, [url]);
  if (!src) return <Icon name="language" size={size} className="dim" />;
  return <img className="favicon" width={size} height={size} src={src} alt="" onError={() => setSrc(null)} />;
}

export function BrowserView({ tab }: { tab: BrowserTab }) {
  const id = tab.id;
  const body = useRef<HTMLDivElement>(null);
  const created = useRef(false); // whether the native webview exists yet (lazy: not while blank)
  const [cur, setCur] = useState(tab.url); // committed page URL (BLANK = new-tab page)
  const [addr, setAddr] = useState(tab.url === BLANK ? "" : tab.url);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const blank = cur === BLANK;
  // The native webview floats above app UI: hide under modals/popovers, and on the new-tab page.
  const hidden = useStore((s) => !!s.dialog || s.overlays > 0) || blank;

  // Create the native webview over the body and keep it tracking the body's rect.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const r = () => {
      const b = el.getBoundingClientRect();
      return [b.left, b.top, b.width, b.height] as const;
    };
    // A blank new tab shows the start page only; don't create a webview until a page is opened.
    if (tab.url !== BLANK) {
      const [x, y, w, h] = r();
      api.browserOpen({ id, url: tab.url, x, y, w, h }).catch((e) => notify(`Browser: ${e}`));
      created.current = true;
    }
    const sync = () => {
      const [x, y, w, h] = r();
      api.browserBounds(id, x, y, w, h).catch(() => {});
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      api.browserShow(id, false).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api.browserShow(id, !hidden).catch(() => {});
  }, [id, hidden]);

  // Real page-load events drive the address bar, tab title, loading bar, and history.
  useEffect(() => {
    const un = listen<{ id: string; url: string; loading: boolean }>("browser:nav", (e) => {
      if (e.payload.id !== id) return;
      setLoading(e.payload.loading);
      const url = e.payload.url;
      setCur(url);
      setAddr(url === BLANK ? "" : url);
      setBrowserUrl(id, url);
      if (!e.payload.loading) recordBrowserHistory(url);
    });
    return () => void un.then((f) => f());
  }, [id]);

  const open = (raw: string) => {
    const url = toUrl(raw);
    setCur(url);
    setAddr(url === BLANK ? "" : url);
    setBrowserUrl(id, url);
    if (url === BLANK) return;
    const el = body.current;
    if (!created.current && el) {
      const b = el.getBoundingClientRect();
      api.browserOpen({ id, url, x: b.left, y: b.top, w: b.width, h: b.height }).catch((e) => notify(`Browser: ${e}`));
      created.current = true;
    } else {
      api.browserNavigate(id, url).catch((e) => notify(`Browser: ${e}`));
    }
  };
  const bumpZoom = (d: number) => {
    const z = Math.min(3, Math.max(0.3, +(zoom + d).toFixed(2)));
    setZoom(z);
    api.browserZoom(id, z).catch(() => {});
  };

  return (
    <div className="browser-view">
      <div className="view-toolbar browser-bar">
        <IconButton icon="arrow_back" title="Back" onClick={() => api.browserNavAction(id, "back")} />
        <IconButton icon="arrow_forward" title="Forward" onClick={() => api.browserNavAction(id, "forward")} />
        <IconButton icon={blank ? "home" : "refresh"} title={blank ? "New tab page" : "Reload"} onClick={() => (blank ? undefined : api.browserNavAction(id, "reload"))} />
        <input
          className="browser-addr"
          value={addr}
          spellCheck={false}
          placeholder="Search or enter a URL"
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open(e.currentTarget.value);
          }}
          onFocus={(e) => e.target.select()}
        />
        {zoom !== 1 && <span className="dim small browser-zoom">{Math.round(zoom * 100)}%</span>}
        <IconButton icon="zoom_out" title="Zoom out" onClick={() => bumpZoom(-0.1)} />
        <IconButton icon="zoom_in" title="Zoom in" onClick={() => bumpZoom(0.1)} />
        <IconButton icon="build" title="Developer tools" onClick={() => api.browserDevtools(id).catch(() => {})} />
        <IconButton icon="open_in_new" title="Open in system browser" onClick={() => addr && openUrl(toUrl(addr)).catch(() => {})} />
      </div>
      <div className="browser-loadbar" aria-hidden={!loading} data-on={loading} />
      {/* The native webview floats over this region; the new-tab page sits on top when blank. */}
      <div className="browser-body" ref={body}>
        {blank && (
          <div className="browser-start">
            <WorkspaceLinks onOpen={open} editable />
            <RecentLinks onOpen={open} />
            <PinInput />
          </div>
        )}
      </div>
    </div>
  );
}

/** The active workspace's detected dev servers (named after their script, renamable) and pins. */
function useWorkspaceSites() {
  const space = useStore(selectActiveSpace);
  const ports = useStore((s) => s.ports);
  const scripts = useStore((s) => s.config.scripts);
  const activeProjectId = useStore((s) => s.config.layout.activeProjectId);
  const servers = ports
    .filter((p) => !activeProjectId || projectOfPort(p) === activeProjectId)
    .map((p) => {
      const script = termOfPort(p)?.scriptId;
      const def = (script && scripts[script]?.name) || p.name || `localhost:${p.port}`;
      return { url: `http://localhost:${p.port}`, name: space?.serverNames?.[String(p.port)] || def, port: p.port };
    })
    .filter((v, i, a) => a.findIndex((x) => x.url === v.url) === i);
  const pins: BrowserPin[] = space?.pins ?? [];
  return { space, servers, pins };
}

/** "This workspace": detected dev servers (named after their script, renamable) and per-workspace
 * pinned links. Shared by the browser new-tab page and the launcher tab. */
export function WorkspaceLinks({ onOpen, editable = false }: { onOpen: (url: string) => void; editable?: boolean }) {
  const { space, servers, pins } = useWorkspaceSites();
  const [renaming, setRenaming] = useState<number | null>(null);

  const serverMenu = (e: React.MouseEvent, s: { url: string; port: number }) => {
    e.preventDefault();
    popupMenu([
      { text: "Open", action: () => onOpen(s.url) },
      { text: "Open in System Browser", action: () => void openUrl(s.url).catch(() => {}) },
      ...(editable && space ? ["-" as const, { text: "Rename…", action: () => setRenaming(s.port) }] : []),
    ]);
  };
  const pinMenu = (e: React.MouseEvent, p: BrowserPin) => {
    e.preventDefault();
    popupMenu([
      { text: "Open", action: () => onOpen(p.url) },
      { text: "Open in System Browser", action: () => void openUrl(p.url).catch(() => {}) },
      ...(editable && space ? ["-" as const, { text: "Unpin", action: () => removePin(space.id, p.url) }] : []),
    ]);
  };

  if (!editable && servers.length === 0 && pins.length === 0) return null;
  return (
    <section className="start-section">
      <div className="start-head">This workspace{space ? ` · ${space.name}` : ""}</div>
      {servers.length === 0 && pins.length === 0 && <p className="dim small">No running dev servers. Pin a quick link below.</p>}
      <div className="start-grid">
        {servers.map((s) =>
          renaming === s.port ? (
            <div key={s.url} className="start-tile pin">
              <div className="start-open">
                <Favicon url={s.url} />
                <input
                  className="inline-input"
                  autoFocus
                  defaultValue={s.name}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    if (space) renameServer(space.id, s.port, e.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
                <span className="start-sub dim small">
                  <span className="dot live" /> localhost:{s.port}
                </span>
              </div>
            </div>
          ) : (
            <div key={s.url} className="start-tile pin" title={s.url} onContextMenu={(e) => serverMenu(e, s)}>
              <button className="start-open" onClick={() => onOpen(s.url)} onDoubleClick={() => editable && setRenaming(s.port)}>
                <Favicon url={s.url} />
                <span className="start-title">{s.name}</span>
                <span className="start-sub dim small">
                  <span className="dot live" /> localhost:{s.port}
                </span>
              </button>
              {editable && space && <IconButton icon="edit" title="Rename" size={14} className="pin-x" onClick={() => setRenaming(s.port)} />}
            </div>
          ),
        )}
        {pins.map((p) => (
          <div key={p.url} className="start-tile pin" title={p.url} onContextMenu={(e) => pinMenu(e, p)}>
            <button className="start-open" onClick={() => onOpen(p.url)}>
              <Favicon url={p.url} />
              <span className="start-title">{p.title || hostOf(p.url)}</span>
              <span className="start-sub dim small ellipsis">{labelOf(p.url)}</span>
            </button>
            {editable && space && <IconButton icon="close" title="Unpin" size={14} className="pin-x" onClick={() => removePin(space.id, p.url)} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Pin a URL for this workspace" field; sits at the bottom of the new-tab and launcher pages. */
export function PinInput() {
  const space = useStore(selectActiveSpace);
  const [value, setValue] = useState("");
  if (!space) return null;
  const add = () => {
    const url = toUrl(value);
    if (url !== BLANK) addPin(space.id, url);
    setValue("");
  };
  return (
    <div className="start-add">
      <Icon name="add" size={14} className="dim" />
      <input
        className="inline-input"
        placeholder="Pin a URL for this workspace…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
      />
    </div>
  );
}

/** Recently visited pages in the embedded browser. */
export function RecentLinks({ onOpen }: { onOpen: (url: string) => void }) {
  const history = useStore((s) => s.config.browserHistory);
  const { servers, pins } = useWorkspaceSites();
  // Skip what "This workspace" already shows: pages on a running server, and pinned URLs.
  const norm = (u: string) => u.replace(/\/+$/, "");
  const serverOrigins = new Set(servers.map((s) => originOf(s.url)));
  const pinned = new Set(pins.map((p) => norm(p.url)));
  const recent = history.filter((h) => !serverOrigins.has(originOf(h.url)) && !pinned.has(norm(h.url))).slice(0, 12);
  if (!recent.length) return null;
  return (
    <section className="start-section">
      <div className="start-head">Recent</div>
      <div className="start-grid">
        {recent.map((h) => (
          <button key={h.url} className="start-tile" onClick={() => onOpen(h.url)} title={h.url}>
            <Favicon url={h.url} />
            <span className="start-title ellipsis">{hostOf(h.url)}</span>
            <span className="start-sub dim small ellipsis">{labelOf(h.url)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
