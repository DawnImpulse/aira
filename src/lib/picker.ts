// Scripts injected into the embedded browser's pages (via `api.browserQuery`). Those webviews have no
// IPC, so each script returns a string and the app polls for results. Never return DOM objects: wry
// JSON-encodes the value.

export type PickMode = "element" | "region";
/** A finished pick: rect is CSS px in the page's viewport, already clipped to it. */
export type Pick = { selector?: string; rect: [number, number, number, number] };

/** Starts picking: element = outline follows the hovered element, click picks it; region = drag a box.
 * Esc cancels. The overlay is removed before the result lands in `window.__airaPick`. */
export const pickScript = (mode: PickMode) => `(() => {
  window.__airaPickStop?.();
  window.__airaPick = null;
  const mode = ${JSON.stringify(mode)};
  const root = document.documentElement;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;display:none;box-sizing:border-box;border:2px solid #4c8dff;background:rgba(76,141,255,.14);border-radius:2px";
  root.appendChild(box);
  const cursor = root.style.cursor;
  root.style.cursor = "crosshair";
  const place = (x, y, w, h) => Object.assign(box.style, { display: "block", left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  const clip = (x, y, w, h) => {
    const l = Math.max(0, x), t = Math.max(0, y);
    return [l, t, Math.max(0, Math.min(innerWidth, x + w) - l), Math.max(0, Math.min(innerHeight, y + h) - t)];
  };
  const esc = (s) => CSS.escape(s);
  const selector = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== root; e = e.parentElement) {
      if (e.id && document.querySelectorAll("#" + esc(e.id)).length === 1) { parts.unshift("#" + esc(e.id)); break; }
      let s = e.localName;
      const cls = [...e.classList].slice(0, 2);
      if (cls.length) s += "." + cls.map(esc).join(".");
      const sibs = e.parentElement ? [...e.parentElement.children].filter((x) => x.localName === e.localName) : [];
      if (sibs.length > 1) s += ":nth-of-type(" + (sibs.indexOf(e) + 1) + ")";
      parts.unshift(s);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
    }
    return parts.join(" > ");
  };
  let start = null;
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  const move = (e) => {
    if (mode === "element") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) { const r = el.getBoundingClientRect(); place(r.left, r.top, r.width, r.height); }
    } else if (start) {
      place(Math.min(start[0], e.clientX), Math.min(start[1], e.clientY), Math.abs(e.clientX - start[0]), Math.abs(e.clientY - start[1]));
    }
  };
  const down = (e) => { block(e); if (mode === "region") start = [e.clientX, e.clientY]; };
  const up = (e) => {
    block(e);
    let res;
    if (mode === "element") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const r = el.getBoundingClientRect();
      res = { selector: selector(el), rect: clip(r.left, r.top, r.width, r.height) };
    } else {
      if (!start) return;
      const [x, y] = start;
      const w = Math.abs(e.clientX - x), h = Math.abs(e.clientY - y);
      start = null;
      if (w < 4 || h < 4) { box.style.display = "none"; return; } // a click, not a drag
      res = { rect: clip(Math.min(x, e.clientX), Math.min(y, e.clientY), w, h) };
    }
    stop();
    window.__airaPick = "wait";
    // One frame later, so the snapshot never catches the overlay.
    requestAnimationFrame(() => requestAnimationFrame(() => (window.__airaPick = JSON.stringify(res))));
  };
  const key = (e) => { if (e.key === "Escape") { block(e); stop(); window.__airaPick = "cancel"; } };
  const opts = { capture: true };
  const stop = () => {
    removeEventListener("mousemove", move, opts);
    removeEventListener("mousedown", down, opts);
    removeEventListener("mouseup", up, opts);
    removeEventListener("click", block, opts);
    removeEventListener("keydown", key, opts);
    box.remove();
    root.style.cursor = cursor;
    window.__airaPickStop = null;
  };
  addEventListener("mousemove", move, opts);
  addEventListener("mousedown", down, opts);
  addEventListener("mouseup", up, opts);
  addEventListener("click", block, opts);
  addEventListener("keydown", key, opts);
  window.__airaPickStop = stop;
  return "ok";
})()`;

/** Takes the pending pick: "" while still picking, "cancel", or a `Pick` as JSON. */
export const PICK_POLL = `(() => {
  const r = window.__airaPick;
  if (r === "wait") return "";
  if (r == null) return window.__airaPickStop ? "" : "cancel"; // no picker = the page navigated away
  window.__airaPick = null;
  return r;
})()`;

/** Stops a pick in progress (another pane got the click, or the user cancelled from the toolbar). */
export const PICK_STOP = `(() => { window.__airaPickStop?.(); window.__airaPick = null; return "ok"; })()`;

/** Installs (once per page) a tracker of the last user scroll and returns it as `{r: ratio, t: ms}`.
 * Scrolls within 150ms of a synced `scrollTo` are ignored so mirrored panes don't echo back. */
export const SCROLL_READ = `(() => {
  if (!window.__airaScroll) {
    window.__airaScroll = { r: 0, t: 0 };
    addEventListener("scroll", () => {
      if (Date.now() - (window.__airaSet || 0) < 150) return;
      const m = document.documentElement.scrollHeight - innerHeight;
      window.__airaScroll = { r: m > 0 ? scrollY / m : 0, t: Date.now() };
    }, { passive: true });
  }
  return JSON.stringify(window.__airaScroll);
})()`;

export const scrollToRatio = (ratio: number) =>
  `(() => { window.__airaSet = Date.now(); scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ${ratio}); return "ok"; })()`;
