import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type BrowserPin, type CookieSource, type Tab } from "../ipc";
import {
  addCustomDevice,
  addPin,
  basename,
  notify,
  openTerminalTab,
  patchBrowserTab,
  popOutBrowser,
  recordBrowserHistory,
  removeCustomDevice,
  removeHistory,
  removePin,
  renameHistory,
  renamePin,
  renameServer,
  selectActiveSpace,
  setBrowserUrl,
  setServerHidden,
  toggleQuickDevice,
  spaceAgents,
  useStore,
  type Term,
} from "../store";
import { projectOfPort, termOfPort } from "../lib/ports";
import { PICK_POLL, PICK_STOP, pickScript, SCROLL_READ, scrollToRatio, type Pick, type PickMode } from "../lib/picker";
import { cx, Icon, IconButton, Modal, useOutsideClose, useOverlay } from "./ui";
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

// ---------- device views ----------

type Device = { key: string; label: string; w: number; h: number; ua?: string };
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const DEVICE_GROUPS = ["Phones", "Tablets", "Laptops", "Desktops"] as const;
/** Popular devices at their CSS viewport sizes. Keys are stored in tabs: never rename one. */
const DEVICES: (Device & { group: (typeof DEVICE_GROUPS)[number] })[] = [
  { group: "Phones", key: "iphone-se", label: "iPhone SE", w: 375, h: 667, ua: UA.iphone },
  { group: "Phones", key: "iphone-mini", label: "iPhone 13 mini", w: 375, h: 812, ua: UA.iphone },
  { group: "Phones", key: "iphone", label: "iPhone 16", w: 393, h: 852, ua: UA.iphone },
  { group: "Phones", key: "iphone-pro", label: "iPhone 16 Pro", w: 402, h: 874, ua: UA.iphone },
  { group: "Phones", key: "iphone-max", label: "iPhone 16 Pro Max", w: 440, h: 956, ua: UA.iphone },
  { group: "Phones", key: "pixel", label: "Pixel 8", w: 412, h: 915, ua: UA.android },
  { group: "Phones", key: "pixel-pro", label: "Pixel 8 Pro", w: 448, h: 998, ua: UA.android },
  { group: "Phones", key: "galaxy-s24", label: "Galaxy S24", w: 360, h: 780, ua: UA.android },
  { group: "Phones", key: "galaxy-ultra", label: "Galaxy S24 Ultra", w: 384, h: 824, ua: UA.android },
  { group: "Phones", key: "galaxy-fold", label: "Galaxy Z Fold (folded)", w: 344, h: 882, ua: UA.android },
  { group: "Tablets", key: "ipad-mini", label: "iPad mini", w: 744, h: 1133, ua: UA.ipad },
  { group: "Tablets", key: "ipad", label: "iPad Air", w: 820, h: 1180, ua: UA.ipad },
  { group: "Tablets", key: "ipad-pro-11", label: "iPad Pro 11″", w: 834, h: 1194, ua: UA.ipad },
  { group: "Tablets", key: "ipad-pro-13", label: "iPad Pro 13″", w: 1024, h: 1366, ua: UA.ipad },
  { group: "Tablets", key: "galaxy-tab", label: "Galaxy Tab S9", w: 800, h: 1280, ua: UA.androidTablet },
  { group: "Tablets", key: "surface-pro", label: "Surface Pro", w: 912, h: 1368 },
  { group: "Laptops", key: "laptop-hd", label: "Laptop HD", w: 1366, h: 768 },
  { group: "Laptops", key: "laptop", label: "Laptop", w: 1280, h: 800 },
  { group: "Laptops", key: "macbook-air", label: "MacBook Air 13″", w: 1470, h: 956 },
  { group: "Laptops", key: "macbook-pro-14", label: "MacBook Pro 14″", w: 1512, h: 982 },
  { group: "Laptops", key: "macbook-pro-16", label: "MacBook Pro 16″", w: 1728, h: 1117 },
  { group: "Desktops", key: "desktop", label: "Desktop", w: 1440, h: 900 },
  { group: "Desktops", key: "full-hd", label: "Full HD", w: 1920, h: 1080 },
  { group: "Desktops", key: "imac", label: "iMac 24″", w: 2240, h: 1260 },
  { group: "Desktops", key: "qhd", label: "QHD", w: 2560, h: 1440 },
];
const DEFAULT_DEVICES = ["iphone", "ipad", "desktop"];
/** Preset id or "WxH" custom size → device. */
function deviceOf(key: string): Device | null {
  const preset = DEVICES.find((d) => d.key === key);
  if (preset) return preset;
  const m = /^(\d+)x(\d+)$/.exec(key);
  if (!m) return null;
  const [w, h] = [+m[1], +m[2]];
  // ponytail: phone UA for narrow custom sizes; add a UA picker if someone needs another.
  return { key, label: "Custom", w, h, ua: w < 768 ? UA.iphone : undefined };
}

/** Floating app UI that raises `overlays` (see `useOverlay`). */
const OVERLAY_SEL = ".popover, .agent-menu, .modal-backdrop";

/** A navigation request for the panes: they navigate whenever `seq` changes. */
type Go = { url: string; seq: number };

/** Per-webview call queue. Tauri runs commands concurrently, so a remount's hide and show (or an open
 * still creating the webview) could land in either order and leave a pane hidden; one pane's
 * open/show/hide/bounds calls run one after another instead. */
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(wid: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(wid) ?? Promise.resolve()).then(fn, fn);
  queues.set(wid, next.catch(() => {}));
  return next;
}

/** One native webview (`wid`) floating over this element: created on mount (or re-shown, since
 * browser_open is idempotent), kept on the element's rect, hidden on unmount. */
function BrowserPane({ wid, start, go, ua, zoom, hidden, className, style }: { wid: string; start: string; go: Go; ua?: string; zoom: number; hidden: boolean; className?: string; style?: CSSProperties }) {
  const el = useRef<HTMLDivElement>(null);
  const created = useRef(false); // lazy: no webview while the page is blank
  const rect = () => {
    const b = el.current!.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  };
  const create = (url: string) => {
    created.current = true;
    sent.current = JSON.stringify(rect());
    inOrder(wid, () => api.browserOpen({ id: wid, url, ...rect(), userAgent: ua, zoom })).catch((e) => notify(`Browser: ${e}`));
  };
  const sent = useRef(""); // last rect sent, so unchanged ones aren't resent
  const sync = () => {
    if (!el.current) return;
    const r = rect();
    const key = JSON.stringify(r);
    if (key === sent.current) return;
    sent.current = key;
    inOrder(wid, () => api.browserBounds(wid, r.x, r.y, r.w, r.h)).catch(() => {});
  };
  // Frames also move without resizing (a device added beside them re-centers the row): check every render.
  useLayoutEffect(sync);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (start !== BLANK) create(start);
    // Its own size, plus the body: a device frame can move without resizing when the panels do.
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    const body = node.closest(".browser-body");
    if (body && body !== node) ro.observe(body);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      inOrder(wid, () => api.browserShow(wid, false)).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  const firstSeq = useRef(go.seq);
  useEffect(() => {
    if (go.seq === firstSeq.current || go.url === BLANK) return;
    if (created.current) api.browserNavigate(wid, go.url).catch((e) => notify(`Browser: ${e}`));
    else create(go.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go.seq]);

  useEffect(() => {
    if (created.current) api.browserZoom(wid, zoom).catch(() => {});
  }, [wid, zoom]);

  // The native webview draws over app UI and ignores CSS clipping, so it steps aside (for a still,
  // below) while a popover/menu/modal overlaps it, or while it's scrolled partly out of the device row.
  const overlays = useStore((s) => s.overlays);
  const [covered, setCovered] = useState(false);
  const recheck = () => {
    const node = el.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const box = node.closest(".device-row")?.getBoundingClientRect();
    const clipped = !!box && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1);
    const under =
      useStore.getState().overlays > 0 &&
      [...document.querySelectorAll(OVERLAY_SEL)].some((o) => {
        const b = o.getBoundingClientRect();
        return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      });
    setCovered(clipped || under);
  };
  useLayoutEffect(recheck);
  useEffect(() => {
    if (!overlays) return;
    const t = window.setTimeout(recheck, 120); // popovers that fill in after a fetch
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);
  useEffect(() => {
    const row = el.current?.closest(".device-row");
    if (!row) return;
    const onScroll = () => {
      sync();
      recheck();
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    return () => row.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);
  // Under a popover, a still of the page stands in for the webview so the frame doesn't go blank.
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    if (hidden || !covered) {
      inOrder(wid, () => api.browserShow(wid, !hidden)).then(() => setStill(null), () => setStill(null));
      return;
    }
    let alive = true;
    const hide = () => void (alive && inOrder(wid, () => api.browserShow(wid, false)).catch(() => {}));
    if (!created.current) return hide();
    api
      .browserStill(wid)
      .then((s) => alive && setStill(s), () => {})
      .finally(hide);
    return () => void (alive = false);
  }, [wid, hidden, covered]);
  return (
    <div ref={el} className={className} style={style}>
      {still && <img className="browser-still" src={still} alt="" />}
    </div>
  );
}

/** Devices side by side at one shared scale (the tallest fits the height), scrolling sideways. Page
 * zoom = that scale, so each page still lays out at the device's real CSS width. */
function DeviceRow({ tabId, devices, start, go, hidden, scale, zoom }: { tabId: string; devices: Device[]; start: string; go: Go; hidden: boolean; scale: { current: Record<string, number> }; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fit the tallest to the height, times the toolbar zoom; the row scrolls when they don't fit.
  const PAD = 16, LABEL = 24, SCROLLBAR = 12;
  const fit = Math.min(1, (size.h - 2 * PAD - LABEL - SCROLLBAR) / Math.max(...devices.map((d) => d.h)));
  const s = Math.min(2, Math.max(0.05, +(fit * zoom).toFixed(3)));
  return (
    <div className="device-row" ref={ref}>
      {size.w > 0 &&
        devices.map((d) => {
          const wid = `${tabId}/${d.key}`;
          scale.current[wid] = s;
          return (
            <div className="device" key={d.key}>
              <div className="device-label dim small" title={`${d.label} · ${d.w}×${d.h} · shown at ${Math.round(s * 100)}%`}>
                <span className="ellipsis grow">
                  {d.label} {d.w}×{d.h}
                </span>
                <IconButton icon="refresh" title={`Reload ${d.label}`} size={13} className="device-reload" onClick={() => void api.browserNavAction(wid, "reload").catch(() => {})} />
              </div>
              <BrowserPane wid={wid} start={start} go={go} ua={d.ua} zoom={s} hidden={hidden} className="device-screen" style={{ width: d.w * s, height: d.h * s }} />
            </div>
          );
        })}
    </div>
  );
}

/** Shared by the device bar and dialog: what a tab shows, and how to change it. */
function useDeviceChoice(tab: BrowserTab, selected: string[]) {
  const setDevices = (devices: string[]) => {
    if (!devices.length) return; // at least one; the toolbar button leaves device view
    for (const k of selected) if (!devices.includes(k)) api.browserClose(`${tab.id}/${k}`).catch(() => {});
    const rank = (k: string) => (DEVICES.findIndex((d) => d.key === k) + DEVICES.length + 1) % (DEVICES.length + 1); // presets in order, customs after
    patchBrowserTab(tab.id, { devices: [...devices].sort((a, b) => rank(a) - rank(b)) });
  };
  const toggle = (k: string) => setDevices(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return { setDevices, toggle };
}
const sizeLabel = (k: string) => k.replace("x", "×");
const deviceName = (k: string) => (DEVICES.find((d) => d.key === k)?.label ?? sizeLabel(k));

/** Device view's own bar (in the layout, so nothing covers the screens): quick toggles for the
 * devices you use most, plus anything else this tab shows; "More devices…" for the full list. */
function DeviceBar({ tab, selected }: { tab: BrowserTab; selected: string[] }) {
  const quick = useStore((s) => s.config.quickDevices);
  const { toggle } = useDeviceChoice(tab, selected);
  const [more, setMore] = useState(false);
  const chips = [...quick, ...selected.filter((k) => !quick.includes(k))].filter((k) => deviceOf(k));
  return (
    <div className="device-bar">
      {chips.map((k) => {
        const d = deviceOf(k)!;
        return (
          <button key={k} className={cx("device-chip", selected.includes(k) && "on")} title={`${d.w}×${d.h}`} onClick={() => toggle(k)}>
            {deviceName(k)}
          </button>
        );
      })}
      <button className="device-chip more" onClick={() => setMore(true)}>
        More devices…
      </button>
      <label className="device-sync" title="Navigate and scroll every device together">
        <input type="checkbox" checked={!!tab.sync} onChange={(e) => patchBrowserTab(tab.id, { sync: e.target.checked })} />
        Sync
      </label>
      {more && <DevicesDialog tab={tab} selected={selected} onClose={() => setMore(false)} />}
    </div>
  );
}

/** Every preset and saved size: show it in this tab, pin it to the quick bar, delete saved sizes,
 * add a new size. Custom sizes are kept for all tabs. */
function DevicesDialog({ tab, selected, onClose }: { tab: BrowserTab; selected: string[]; onClose: () => void }) {
  useOverlay(true); // device screens under the modal switch to stills
  const quick = useStore((s) => s.config.quickDevices);
  const saved = useStore((s) => s.config.customDevices);
  const { setDevices, toggle } = useDeviceChoice(tab, selected);
  const [custom, setCustom] = useState("");
  const row = (k: string, name: string, size: string, removable: boolean) => (
    <div key={k} className="device-row-item">
      <label className="device-pick">
        <input type="checkbox" checked={selected.includes(k)} disabled={selected.length === 1 && selected.includes(k)} onChange={() => toggle(k)} />
        <span className="grow ellipsis">{name}</span>
        <span className="dim small">{size}</span>
      </label>
      <IconButton
        icon="keep"
        title={quick.includes(k) ? "Remove from quick bar" : "Add to quick bar"}
        className={cx("device-pin", quick.includes(k) && "on")}
        size={15}
        onClick={() => toggleQuickDevice(k)}
      />
      {removable && <IconButton icon="delete" title="Delete this size" size={15} onClick={() => { api.browserClose(`${tab.id}/${k}`).catch(() => {}); removeCustomDevice(k); }} />}
    </div>
  );
  return (
    <Modal title="Devices" subtitle="check to show · pin to keep on the quick bar" onClose={onClose} width={560}>
      <div className="devices-dialog">
        {DEVICE_GROUPS.map((g) => (
          <section key={g}>
            <h4 className="devices-group dim small">{g}</h4>
            {DEVICES.filter((d) => d.group === g).map((d) => row(d.key, d.label, `${d.w}×${d.h}`, false))}
          </section>
        ))}
        <section>
          <h4 className="devices-group dim small">Your sizes</h4>
          {saved.map((k) => row(k, "Custom", sizeLabel(k), true))}
          <input
            className="inline-input device-custom"
            placeholder="New size, e.g. 800x600, then Enter"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const m = /^\s*(\d{2,5})\s*[x×*,\s]\s*(\d{2,5})\s*$/.exec(custom);
              if (!m) return notify("Size looks like 800x600");
              const k = `${m[1]}x${m[2]}`;
              addCustomDevice(k);
              if (!selected.includes(k)) setDevices([...selected, k]);
              setCustom("");
            }}
          />
        </section>
      </div>
    </Modal>
  );
}

/** Sign-in import: each browser profile on this Mac, all its cookies or just the current site's. */
function LoginsPopover({ host, onDone, onClose }: { host: string | null; onDone: () => void; onClose: () => void }) {
  const ref = useOutsideClose(onClose);
  const [sources, setSources] = useState<CookieSource[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api.cookieSources().then((s) => setSources(s ?? []), () => setSources([]));
  }, []);
  const run = async (s: CookieSource, site: boolean) => {
    setBusy(`${s.browser}/${s.profile}`);
    try {
      const n = await api.cookieImport(s.browser, s.profile, site ? (host ?? undefined) : undefined);
      notify(`Imported ${n} cookie${n === 1 ? "" : "s"} from ${s.browser}${site && host ? ` for ${host}` : ""}`);
      onDone();
    } catch (e) {
      notify(`Import failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="popover logins-pop" ref={ref}>
      <p className="dim small logins-note">Copies cookies so you're signed in here too. macOS asks once per browser to read its Keychain key.</p>
      {sources === null && <p className="dim small">Looking for browsers…</p>}
      {sources?.length === 0 && <p className="dim small">No Chromium browser profiles found (Chrome, Arc, Brave, Edge, Dia…).</p>}
      {sources?.map((s) => {
        const key = `${s.browser}/${s.profile}`;
        return (
          <div key={key} className="menu-item logins-row">
            <span className="grow ellipsis">
              {s.browser} <span className="dim">· {s.name}</span>
            </span>
            {busy === key ? (
              <span className="dim small">Importing…</span>
            ) : (
              <>
                {host && (
                  <button className="link-btn" disabled={!!busy} onClick={() => run(s, true)} title={`Only cookies for ${host}`}>
                    This site
                  </button>
                )}
                <button className="link-btn" disabled={!!busy} onClick={() => run(s, false)} title="Every site's cookies">
                  All
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- capture ----------

/** Pastes into an agent's terminal as one bracketed paste each, so CLIs like Claude Code turn the
 * image path into an attachment; no Enter, the user writes the prompt. */
function sendToAgent(t: Term, text: string, png: string) {
  const paste = (s: string) => `\x1b[200~${s}\x1b[201~`;
  api.ptyWrite(t.sessionId!, paste(text + " ") + paste(png) + " ").catch((e) => notify(`Send failed: ${e}`));
  openTerminalTab(t.key);
}

/** What to do with a capture: save it, or hand it to an agent in this space. */
function captureMenu(png: string, pageUrl: string, selector?: string) {
  const agents = spaceAgents();
  const text = selector ? `\`${selector}\` on ${pageUrl}` : `Screenshot of ${pageUrl}`;
  popupMenu([
    { text: "Save Screenshot", action: () => void api.browserSaveShot(png).then((p) => notify(`Saved to Desktop: ${basename(p)}`), notify) },
    ...(selector ? [{ text: "Copy Selector", action: () => void api.copyText(selector).catch(notify) }] : []),
    "-",
    ...(agents.length
      ? agents.map((t) => ({ text: `Send to ${t.name}`, action: () => sendToAgent(t, text, png) }))
      : [{ text: "No agent open in this space", action: () => {}, enabled: false }]),
  ]);
}

type NavAction = "back" | "forward" | "reload";

/** Back / forward / reload and the address field; extra buttons go in `children`. Shared by the tab
 * and its pop-out window. */
function NavBar({ addr, setAddr, blank, onOpen, onNav, children }: { addr: string; setAddr: (s: string) => void; blank: boolean; onOpen: (raw: string) => void; onNav: (a: NavAction) => void; children: ReactNode }) {
  return (
    <div className="view-toolbar browser-bar">
      <IconButton icon="arrow_back" title="Back" onClick={() => onNav("back")} />
      <IconButton icon="arrow_forward" title="Forward" onClick={() => onNav("forward")} />
      <IconButton icon={blank ? "home" : "refresh"} title={blank ? "New tab page" : "Reload"} onClick={() => (blank ? undefined : onNav("reload"))} />
      <input
        className="browser-addr"
        value={addr}
        spellCheck={false}
        placeholder="Search or enter a URL"
        onChange={(e) => setAddr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(e.currentTarget.value);
        }}
        onFocus={(e) => e.target.select()}
      />
      {children}
    </div>
  );
}

/** Device-view sync between a tab's panes, used by the tab and by its pop-out window. Always tracks
 * each pane's last loaded URL (returned); when `on`, a page change in one pane follows in the others,
 * and the latest user scroll is mirrored (as a ratio of page height). */
function useDeviceSync(id: string, panes: string[], on: boolean, paused: boolean) {
  const urls = useRef<Record<string, string>>({}); // pane → last loaded URL
  const following = useRef(new Set<string>()); // panes navigated by sync; their load doesn't propagate
  const live = useRef({ panes, on });
  live.current = { panes, on };
  useEffect(() => {
    const un = listen<{ id: string; url: string; loading: boolean }>("browser:nav", (e) => {
      const { id: wid, url, loading } = e.payload;
      if (loading || (wid !== id && !wid.startsWith(id + "/"))) return;
      urls.current[wid] = url;
      // A pane we moved doesn't pass its own load on, which stops redirect ping-pong (e.g. a site
      // sending phones to m.example.com).
      if (following.current.delete(wid) || !live.current.on) return;
      for (const p of live.current.panes) {
        if (p === wid || urls.current[p] === url) continue;
        following.current.add(p);
        api.browserNavigate(p, url).catch(() => {});
      }
    });
    return () => void un.then((f) => f());
  }, [id]);

  // ponytail: scroll polled at 150ms while on; child webviews have no channel to push events.
  useEffect(() => {
    if (!on || paused) return;
    let alive = true;
    let last = 0;
    let timer = 0;
    const tick = async () => {
      const ids = live.current.panes;
      const res = await api.browserQuery(ids, SCROLL_READ).catch(() => [] as (string | null)[]);
      const vals = res.map((r) => {
        try {
          return r ? (JSON.parse(r) as { r: number; t: number }) : null;
        } catch {
          return null;
        }
      });
      let lead = -1;
      vals.forEach((v, i) => {
        if (v && v.t > last && (lead < 0 || v.t > vals[lead]!.t)) lead = i;
      });
      if (lead >= 0) {
        const { r, t } = vals[lead]!;
        last = t;
        const others = ids.filter((_, i) => i !== lead && Math.abs((vals[i]?.r ?? -1) - r) > 0.001);
        if (others.length) await api.browserQuery(others, scrollToRatio(r)).catch(() => {});
      }
      if (alive) timer = window.setTimeout(tick, 150);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, on, paused]);
  return urls;
}

/** The UI of a pop-out window (`?popout=<id>`): drives the tab's webviews, which Rust moved here (the
 * single view, or every device pane). Runs without `boot()`, so devices are picked in the main tab;
 * that tab keeps recording URL and history from the same events. */
export function BrowserPopout({ id, url, zoom: startZoom, devices: keys, sync: startSync }: { id: string; url: string; zoom: number; devices: string[]; sync: boolean }) {
  const [addr, setAddr] = useState(url);
  const [go, setGo] = useState<Go>({ url, seq: 0 });
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(startZoom);
  const [sync, setSync] = useState(startSync);
  const devices = keys.map(deviceOf).filter((d): d is Device => !!d);
  const multi = devices.length > 0;
  const panes = multi ? devices.map((d) => `${id}/${d.key}`) : [id];
  const scale = useRef<Record<string, number>>({});
  useDeviceSync(id, panes, multi && sync, false);
  useEffect(() => {
    const un = listen<{ id: string; url: string; loading: boolean }>("browser:nav", (e) => {
      if (e.payload.id !== id && !e.payload.id.startsWith(id + "/")) return;
      setLoading(e.payload.loading);
      setAddr(e.payload.url);
    });
    return () => void un.then((f) => f());
  }, [id]);
  const open = (raw: string) => {
    const u = toUrl(raw);
    setAddr(u);
    setGo((g) => ({ url: u, seq: g.seq + 1 }));
  };
  const bumpZoom = (d: number) => setZoom((z) => Math.min(3, Math.max(0.25, +(z + d).toFixed(2))));
  const devtools = () =>
    multi
      ? popupMenu(devices.map((d) => ({ text: `${d.label} ${d.w}×${d.h}`, action: () => void api.browserDevtools(`${id}/${d.key}`).catch(() => {}) })))
      : void api.browserDevtools(id).catch(() => {});
  return (
    <div className="browser-view browser-popout">
      <NavBar addr={addr} setAddr={setAddr} blank={false} onOpen={open} onNav={(a) => panes.forEach((p) => api.browserNavAction(p, a).catch(() => {}))}>
        {zoom !== 1 && (
          <button className="link-btn dim small browser-zoom" title={multi ? "Back to fit" : "Back to 100%"} onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
        )}
        <IconButton icon="zoom_out" title={multi ? "Smaller devices" : "Zoom out"} onClick={() => bumpZoom(-0.1)} />
        <IconButton icon="zoom_in" title={multi ? "Bigger devices" : "Zoom in"} onClick={() => bumpZoom(0.1)} />
        {multi && (
          <label className="device-sync" title="Navigate and scroll every device together">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            Sync
          </label>
        )}
        <IconButton icon="build" title="Developer tools" onClick={devtools} />
        <IconButton icon="close_fullscreen" title="Back into the tab" onClick={() => void api.browserDock(id).catch(() => {})} />
      </NavBar>
      <div className="browser-loadbar" aria-hidden={!loading} data-on={loading} />
      <div className="browser-body">
        {multi ? (
          <div className="device-view">
            <DeviceRow tabId={id} devices={devices} start={url} go={go} hidden={false} scale={scale} zoom={zoom} />
          </div>
        ) : (
          <BrowserPane wid={id} start={url} go={go} zoom={zoom} hidden={false} className="browser-pane" />
        )}
      </div>
    </div>
  );
}

export function BrowserView({ tab }: { tab: BrowserTab }) {
  const id = tab.id;
  const [cur, setCur] = useState(tab.url); // committed page URL (BLANK = new-tab page)
  const [addr, setAddr] = useState(tab.url === BLANK ? "" : tab.url);
  const [go, setGo] = useState<Go>({ url: tab.url, seq: 0 });
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [devZoom, setDevZoom] = useState(1);
  const [picking, setPicking] = useState(false);
  const [loginsOpen, setLoginsOpen] = useState(false);
  useOverlay(loginsOpen);
  // The device selection is kept while device view is off, so toggling back restores it.
  const selected = tab.devices?.length ? tab.devices : DEFAULT_DEVICES;
  const devices = selected.map(deviceOf).filter((d): d is Device => !!d);
  const multi = !!tab.deviceView && devices.length > 0;
  const panes = multi ? devices.map((d) => `${id}/${d.key}`) : [id];
  const blank = cur === BLANK;
  const popped = useStore((s) => !!s.popped[id]);
  // The native webview floats above app UI: hide under modals and on the new-tab page. (Popovers
  // are handled per pane, by overlap.)
  const hidden = useStore((s) => !!s.dialog) || blank;

  const scale = useRef<Record<string, number>>({}); // device pane → its drawn scale (for captures)
  const live = useRef({ panes, multi, cur });
  live.current = { panes, multi, cur };
  // While popped out, the pop-out window runs the sync.
  const urls = useDeviceSync(id, panes, multi && !!tab.sync && !popped, hidden);

  // Real page-load events drive the address bar, tab title, loading bar and history.
  useEffect(() => {
    const un = listen<{ id: string; url: string; loading: boolean }>("browser:nav", (e) => {
      const { id: wid, url, loading } = e.payload;
      if (wid !== id && !wid.startsWith(id + "/")) return;
      setLoading(loading);
      setCur(url);
      setAddr(url === BLANK ? "" : url);
      setBrowserUrl(id, url);
      if (!loading) recordBrowserHistory(url);
    });
    return () => void un.then((f) => f());
  }, [id]);

  // Element / region picking: inject the picker into every pane, poll until one returns a pick.
  const pickTimer = useRef(0);
  const stopPick = () => {
    clearTimeout(pickTimer.current);
    pickTimer.current = 0;
    setPicking(false);
    api.browserQuery(live.current.panes, PICK_STOP).catch(() => {});
  };
  useEffect(() => () => clearTimeout(pickTimer.current), []);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopPick();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  const pick = async (mode: PickMode) => {
    const ids = live.current.panes;
    await api.browserQuery(ids, pickScript(mode)).catch(() => {});
    setPicking(true);
    // ponytail: 200ms poll; no push channel from child webviews.
    const poll = async () => {
      const res = await api.browserQuery(ids, PICK_POLL).catch(() => null);
      if (!pickTimer.current) return; // cancelled meanwhile
      const i = res?.findIndex((r) => r && r !== "cancel") ?? -1;
      if (i < 0) {
        if (res && res.every((r) => r === "cancel")) return stopPick();
        pickTimer.current = window.setTimeout(poll, 200);
        return;
      }
      stopPick(); // also clears the picker in the other panes
      const p = JSON.parse(res![i]!) as Pick;
      const z = live.current.multi ? (scale.current[ids[i]] ?? 1) : zoom;
      const [x, y, w, h] = p.rect.map((v) => v * z);
      if (w < 1 || h < 1) return notify("That element is off screen");
      try {
        captureMenu(await api.browserSnapshot(ids[i], x, y, w, h), urls.current[ids[i]] ?? live.current.cur, p.selector);
      } catch (e) {
        notify(`Capture failed: ${e}`);
      }
    };
    pickTimer.current = window.setTimeout(poll, 200);
  };
  const fullPage = async (wid: string) => {
    notify("Capturing the full page…");
    try {
      captureMenu(await api.browserFullpage(wid), urls.current[wid] ?? cur);
    } catch (e) {
      notify(`Capture failed: ${e}`);
    }
  };
  const captureMenuOpen = () => {
    if (picking) return stopPick();
    popupMenu([
      { text: "Select Element", action: () => void pick("element") },
      { text: "Drag Region", action: () => void pick("region") },
      "-",
      ...(multi ? devices.map((d) => ({ text: `Full Page: ${d.label} ${d.w}×${d.h}`, action: () => void fullPage(`${id}/${d.key}`) })) : [{ text: "Full Page", action: () => void fullPage(id) }]),
    ]);
  };
  const devtools = () => {
    if (!multi) return void api.browserDevtools(id).catch(() => {});
    popupMenu(devices.map((d) => ({ text: `${d.label} ${d.w}×${d.h}`, action: () => void api.browserDevtools(`${id}/${d.key}`).catch(() => {}) })));
  };

  const open = (raw: string) => {
    const url = toUrl(raw);
    setCur(url);
    setAddr(url === BLANK ? "" : url);
    setBrowserUrl(id, url);
    if (popped && url !== BLANK) return void api.browserNavigate(id, url).catch(notify); // no pane here to take it
    setGo((g) => ({ url, seq: g.seq + 1 }));
  };
  // Both sides' webviews stay alive (hidden) across switches, so nothing reloads. A side coming back
  // only navigates if its page is behind the one you're on now.
  const toggleDeviceView = () => {
    patchBrowserTab(id, { deviceView: !multi, devices: selected });
    const back = multi ? [id] : selected.map((k) => `${id}/${k}`);
    for (const p of back) if (urls.current[p] && urls.current[p] !== cur) api.browserNavigate(p, cur).catch(() => {});
  };
  const navAll = (action: NavAction) => panes.forEach((p) => api.browserNavAction(p, action).catch(() => {}));
  // Single view: page zoom. Device view: how big the frames are drawn, relative to fitting the
  // height (each page keeps its device's CSS width either way).
  const [zoomV, setZoomV] = multi ? [devZoom, setDevZoom] : [zoom, setZoom];
  const bumpZoom = (d: number) => setZoomV(Math.min(3, Math.max(0.25, +(zoomV + d).toFixed(2))));

  return (
    <div className="browser-view">
      <NavBar addr={addr} setAddr={setAddr} blank={blank} onOpen={open} onNav={navAll}>
        {zoomV !== 1 && (
          <button className="link-btn dim small browser-zoom" title={multi ? "Back to fit" : "Back to 100%"} onClick={() => setZoomV(1)}>
            {Math.round(zoomV * 100)}%
          </button>
        )}
        <IconButton icon="zoom_out" title={multi ? "Smaller devices" : "Zoom out"} onClick={() => bumpZoom(-0.1)} />
        <IconButton icon="zoom_in" title={multi ? "Bigger devices" : "Zoom in"} onClick={() => bumpZoom(0.1)} />
        <IconButton
          icon={picking ? "close" : "screenshot_region"}
          title={picking ? "Cancel capture (Esc)" : "Capture: element, region or full page"}
          className={cx(picking && "on")}
          disabled={blank}
          onClick={captureMenuOpen}
        />
        <IconButton icon="devices" title={multi ? "Back to single view" : "Device view"} className={cx(multi && "on")} disabled={popped} onClick={toggleDeviceView} />
        <span className="popover-anchor">
          <IconButton icon="key" title="Import sign-ins from your browsers" onClick={() => setLoginsOpen(!loginsOpen)} />
          {loginsOpen && (
            <LoginsPopover
              host={/^https?:/i.test(cur) ? new URL(cur).hostname : null}
              onDone={() => !blank && navAll("reload")}
              onClose={() => setLoginsOpen(false)}
            />
          )}
        </span>
        <IconButton icon="build" title="Developer tools" disabled={blank} onClick={devtools} />
        <IconButton
          icon="picture_in_picture_alt"
          title="Pop out into its own window"
          disabled={blank || popped}
          onClick={() => popOutBrowser(id, cur, multi ? devZoom : zoom, multi ? selected : [], !!tab.sync)}
        />
        <IconButton icon="open_in_new" title="Open in system browser" onClick={() => addr && openUrl(toUrl(addr)).catch(() => {})} />
      </NavBar>
      <div className="browser-loadbar" aria-hidden={!loading} data-on={loading} />
      {/* Native webviews float over the panes (kept mounted so navigation reaches them); the new-tab
          page sits on top while blank, with the webviews hidden. */}
      <div className="browser-body">
        {popped ? (
          <div className="browser-popped">
            <Icon name="picture_in_picture_alt" size={28} className="dim" />
            <p className="dim">This page is open in its own window.</p>
            <button className="btn" onClick={() => api.browserDock(id).catch(notify)}>
              Bring Back
            </button>
          </div>
        ) : multi ? (
          <div className="device-view">
            <DeviceBar tab={tab} selected={selected} />
            <DeviceRow tabId={id} devices={devices} start={cur} go={go} hidden={hidden} scale={scale} zoom={devZoom} />
          </div>
        ) : (
          <BrowserPane wid={id} start={cur} go={go} zoom={zoom} hidden={hidden} className="browser-pane" />
        )}
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
  const hidden = new Set(space?.hiddenServers ?? []);
  // Running only: ports listening now that belong to this project.
  const servers = ports
    .filter((p) => !activeProjectId || projectOfPort(p) === activeProjectId)
    .map((p) => {
      const scriptId = termOfPort(p)?.scriptId;
      const def = (scriptId && scripts[scriptId]?.name) || p.name || `localhost:${p.port}`;
      return { url: `http://localhost:${p.port}`, name: space?.serverNames?.[String(p.port)] || def, port: p.port, hidden: hidden.has(p.port) };
    })
    .filter((v, i, a) => a.findIndex((x) => x.port === v.port) === i);
  const pins: BrowserPin[] = space?.pins ?? [];
  return { space, servers, pins };
}

type MenuItem = { text: string; action: () => void } | "-";

/** One quick-open tile: open on click; rename by double-click, the hover pencil or right-click. */
function LinkTile({
  url,
  name,
  sub,
  live,
  onOpen,
  onRename,
  onRemove,
  removeLabel = "Remove",
  removeIcon = "close",
  dim = false,
  extraMenu = [],
}: {
  url: string;
  name: string;
  sub: string;
  live?: boolean;
  onOpen: (url: string) => void;
  onRename?: (name: string) => void;
  onRemove?: () => void;
  removeLabel?: string;
  removeIcon?: string;
  dim?: boolean;
  extraMenu?: MenuItem[];
}) {
  const [editing, setEditing] = useState(false);
  const subline = (
    <span className="start-sub dim small ellipsis">
      {live !== undefined && <span className={live ? "dot live" : "dot idle"} />}
      {sub}
    </span>
  );
  if (editing && onRename) {
    return (
      <div className="start-tile pin">
        <div className="start-open">
          <Favicon url={url} />
          <input
            className="inline-input"
            autoFocus
            defaultValue={name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              onRename(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          {subline}
        </div>
      </div>
    );
  }
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    popupMenu([
      { text: "Open", action: () => onOpen(url) },
      { text: "Open in System Browser", action: () => void openUrl(url).catch(() => {}) },
      ...(onRename ? ["-" as const, { text: "Rename…", action: () => setEditing(true) }] : []),
      ...extraMenu,
      ...(onRemove ? ["-" as const, { text: removeLabel, action: onRemove }] : []),
    ]);
  };
  return (
    <div className={dim ? "start-tile pin dimmed" : "start-tile pin"} title={url} onContextMenu={menu}>
      <button className="start-open" onClick={() => onOpen(url)} onDoubleClick={() => onRename && setEditing(true)}>
        <Favicon url={url} />
        <span className="start-title ellipsis">{name}</span>
        {subline}
      </button>
      <span className="tile-actions">
        {onRename && <IconButton icon="edit" title="Rename" size={14} onClick={() => setEditing(true)} />}
        {onRemove && <IconButton icon={removeIcon} title={removeLabel} size={14} onClick={onRemove} />}
      </span>
    </div>
  );
}

/** "This workspace": detected dev servers (named after their script, renamable) and per-workspace
 * pinned links. Shared by the browser new-tab page and the launcher tab. */
export function WorkspaceLinks({ onOpen, editable = false }: { onOpen: (url: string) => void; editable?: boolean }) {
  const { space, servers, pins } = useWorkspaceSites();
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = servers.filter((s) => s.hidden).length;
  const shown = servers.filter((s) => !s.hidden || showHidden);
  if (!editable && shown.length === 0 && pins.length === 0) return null;
  return (
    <section className="start-section">
      <div className="start-head">
        This workspace{space ? ` · ${space.name}` : ""}
        {editable && hiddenCount > 0 && (
          <button className="link-btn start-head-link" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? "Done" : `${hiddenCount} hidden`}
          </button>
        )}
      </div>
      {shown.length === 0 && pins.length === 0 && <p className="dim small">No running dev servers. Pin a quick link below.</p>}
      <div className="start-grid">
        {shown.map((s) => (
          <LinkTile
            key={s.url}
            url={s.url}
            name={s.name}
            sub={`localhost:${s.port}`}
            live
            dim={s.hidden}
            onOpen={onOpen}
            onRename={editable && space ? (n) => renameServer(space.id, s.port, n) : undefined}
            onRemove={editable && space ? () => setServerHidden(space.id, s.port, !s.hidden) : undefined}
            removeLabel={s.hidden ? "Unhide" : "Hide"}
            removeIcon={s.hidden ? "visibility" : "visibility_off"}
          />
        ))}
        {pins.map((p) => (
          <LinkTile
            key={p.url}
            url={p.url}
            name={p.title || hostOf(p.url)}
            sub={labelOf(p.url)}
            onOpen={onOpen}
            onRename={editable && space ? (n) => renamePin(space.id, p.url, n) : undefined}
            onRemove={editable && space ? () => removePin(space.id, p.url) : undefined}
            removeLabel="Unpin"
          />
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
  const { space, servers, pins } = useWorkspaceSites();
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
          <LinkTile
            key={h.url}
            url={h.url}
            name={h.title || hostOf(h.url)}
            sub={labelOf(h.url)}
            onOpen={onOpen}
            onRename={(n) => renameHistory(h.url, n)}
            onRemove={() => removeHistory(h.url)}
            removeLabel="Remove from Recent"
            extraMenu={space ? ["-", { text: "Pin to This Workspace", action: () => addPin(space.id, h.url, h.title) }] : []}
          />
        ))}
      </div>
    </section>
  );
}
