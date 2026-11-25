// Records docs/media/<name>.mp4 + <name>.webp: short demos of the real UI with demo data (mock.js), made the way
// screen-recording tools like Screen Studio make them, in two passes:
//   1. take:   drive the app and grab frames at 2× with no cursor, logging every mouse move and click, plus the
//              region each step is about (a camera cue);
//   2. render: composite each 30fps output frame in a blank page: the newest app frame seen through a camera that
//              springs in on each cue and back out, and a cursor drawn from the log, with a ripple on every click.
// The camera and cursor never depend on how fast frames could be grabbed, so both move smoothly.
// Needs the dev server (`bun run dev`), Playwright's Chromium (see shots.mjs), ffmpeg with libx264 and cwebp.
// Run: bun run clips [name ...]   (TRACE=1 logs each step)
// ponytail: fixed waits tuned for an idle Mac, like shots.mjs; record one clip at a time.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byTitle, card, CLAUDE_EVENTS, geminiInCheckout, launchClaude, open, openPricing, project, pushHooks, scriptRow, settle, startScripts } from "./scene.mjs";

const OUT = new URL("../../docs/media/", import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), "ide-clips-"));
mkdirSync(OUT, { recursive: true });
const FPS = 30;
const CURSOR = 1.3; // arrow size relative to the UI, a little larger than life like most demo videos
// Wide cards show the whole window; half-width cards zoom up to 2× so UI text stays readable where it matters.
const WIDE = { viewport: { width: 1184, height: 740 }, out: { width: 1920, height: 1200 }, maxZoom: 1.6, crf: 30 };
const HALF = { viewport: { width: 1120, height: 700 }, out: { width: 1280, height: 800 }, maxZoom: 2, crf: 28 };
// The intro under the headline: the full 1440×900 window, with gentle zooms only.
const HERO = { viewport: { width: 1440, height: 900 }, out: { width: 1920, height: 1200 }, maxZoom: 1.3, crf: 30, w: 4.5 };

if (!(await fetch("http://localhost:1420/").then((r) => r.ok, () => false))) {
  console.error("Start the dev server first: bun run dev");
  process.exit(1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = (...a) => process.env.TRACE && console.error(new Date().toISOString().slice(17, 23), ...a);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// A locator's box, or a box given as {x, y, width, height} (CSS px).
const rect = async (x) => {
  if (x.width !== undefined) return x;
  const b = await x.boundingBox();
  if (!b) throw new Error(`not visible: ${x}`);
  return b;
};

// ---------- pass 1: the take ----------
class Take {
  constructor(p, at) {
    this.p = p;
    this.pos = at;
    this.track = [{ t: Date.now(), ...at }]; // cursor samples
    this.clicks = [];
    this.cues = []; // { t, end, box, zoom }
  }
  // Ease-in-out glide made of real mouse moves (so hover states show up in the frames), timed by the clock:
  // longer trips take a little longer, like a hand would.
  async move(to, ms) {
    const from = this.pos, t0 = Date.now();
    ms ??= Math.min(850, 380 + 0.55 * Math.hypot(to.x - from.x, to.y - from.y));
    this.track.push({ t: t0, ...from });
    for (let k = 0; k < 1; ) {
      k = Math.min(1, (Date.now() - t0) / ms);
      const e = k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2;
      const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
      await this.p.mouse.move(x, y);
      this.track.push({ t: t0 + k * ms, x, y });
      if (k < 1) await wait(12);
    }
    this.pos = to;
  }
  // The camera eases to `box` (a locator or a box) and stays for `hold` ms unless a later cue takes over.
  async look(box, { zoom, hold = 1500 } = {}) {
    const t = Date.now();
    this.cues.push({ t, end: t + hold, box: await rect(box), zoom });
  }
  // Glide to `loc` and click it. The camera travels with the cursor to `look` (default: the target itself).
  async click(loc, { look, zoom, hold = 1500 } = {}) {
    trace("click", String(loc));
    const b = await rect(loc);
    const cue = { t: Date.now(), end: Infinity, box: look ? await rect(look) : b, zoom };
    this.cues.push(cue);
    await this.move({ x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 14) });
    await wait(110);
    this.clicks.push({ t: Date.now(), ...this.pos });
    await this.p.mouse.down();
    await wait(70);
    await this.p.mouse.up();
    cue.end = Date.now() + hold;
  }
  // The frame shown before the video plays (and instead of it under reduced motion).
  poster() {
    this.still = Date.now();
  }
}

// Grabs 2× frames of the whole window while `act` runs (~15–30fps; only UI changes depend on it).
async function shoot(p, act) {
  const cdp = await p.context().newCDPSession(p);
  const vp = p.viewportSize();
  const clip = { x: 0, y: 0, ...vp, scale: 2 };
  const frames = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      const t = Date.now();
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true, clip });
      frames.push({ t, data });
    }
  })();
  await wait(250);
  const t0 = Date.now();
  await act();
  await wait(500);
  const t1 = Date.now();
  stop = true;
  await loop;
  await cdp.detach();
  return { frames, t0, t1, vp };
}

// ---------- pass 2: render ----------
function cursorAt(track, t) {
  let i = 0;
  while (i + 1 < track.length && track[i + 1].t <= t) i++;
  const a = track[i], b = track[i + 1];
  if (!b || t <= a.t) return a;
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// Critically damped springs (zoom in log space) toward the active cue: smooth starts and stops, no overshoot.
// Long pans zoom out a little on the way, and the view slides along when the cursor nears its edge.
function cameraPath(take, { t0, t1, vp }, maxZoom, w = 8.5) {
  const { width: W, height: H } = vp;
  const target = (t) => {
    const c = take.cues.findLast((q) => q.t <= t);
    if (!c || t > c.end) return { x: W / 2, y: H / 2, z: 1 };
    const b = c.box;
    const z = clamp(c.zoom ?? Math.min(W / (b.width * 1.15), H / (b.height * 1.15)), 1, maxZoom);
    const vw = W / z, vh = H / z, cur = cursorAt(take.track, t);
    const x = clamp(b.x + b.width / 2, cur.x - vw * 0.38, cur.x + vw * 0.38);
    const y = clamp(b.y + b.height / 2, cur.y - vh * 0.38, cur.y + vh * 0.38);
    return { x: clamp(x, vw / 2, W - vw / 2), y: clamp(y, vh / 2, H - vh / 2), z };
  };
  // w in rad/s: 8.5 settles in about 0.65s; the intro uses 4.5 (~1.2s) so its moves read as a slow glide.
  const s = { x: W / 2, y: H / 2, l: 0, vx: 0, vy: 0, vl: 0 };
  const path = [];
  for (let t = t0; t <= t1; t += 1000 / FPS) {
    const g = target(t);
    const far = Math.hypot(g.x - s.x, g.y - s.y) / W;
    const goal = { x: g.x, y: g.y, l: Math.log(Math.max(1, g.z / (1 + 0.9 * far))) };
    for (const a of ["x", "y", "l"]) {
      for (let k = 0; k < 4; k++) {
        s[`v${a}`] += (w * w * (goal[a] - s[a]) - 2 * w * s[`v${a}`]) / FPS / 4;
        s[a] += s[`v${a}`] / FPS / 4;
      }
      // Snap once settled: held shots become identical frames, which cost almost nothing to encode.
      const eps = a === "l" ? 0.001 : 0.2;
      if (Math.abs(goal[a] - s[a]) < eps && Math.abs(s[`v${a}`]) < eps * 4) [s[a], s[`v${a}`]] = [goal[a], 0];
    }
    const z = Math.max(1, Math.exp(s.l)), vw = W / z, vh = H / z;
    path.push({ t, rx: clamp(s.x - vw / 2, 0, W - vw), ry: clamp(s.y - vh / 2, 0, H - vh), vw, vh });
  }
  return path;
}

async function render(browser, name, take, shot, cfg) {
  const { out } = cfg;
  const comp = await browser.newPage();
  await comp.evaluate(({ width: w, height: h }) => {
    const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    const arrow = new Path2D("M0 0V17.2L4.1 13.3L6.9 19.8L9.9 18.6L7.2 12.3H12.9Z"); // tip at 0,0
    let bm;
    window.setFrame = async (b64) => {
      bm?.close();
      bm = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    };
    window.draw = ({ rx, ry, vw, vh, cssWidth, cur, ripples }) => {
      const k = bm.width / cssWidth; // frame px per CSS px
      g.drawImage(bm, rx * k, ry * k, vw * k, vh * k, 0, 0, w, h);
      for (const r of ripples) {
        g.beginPath();
        g.arc(r.x, r.y, r.r, 0, 2 * Math.PI);
        g.fillStyle = `rgba(106,168,255,${r.a * 0.25})`;
        g.fill();
        g.lineWidth = r.lw;
        g.strokeStyle = `rgba(106,168,255,${r.a})`;
        g.stroke();
      }
      g.save();
      g.translate(cur.x, cur.y);
      g.scale(cur.s, cur.s);
      g.shadowColor = "rgba(0,0,0,0.4)";
      g.shadowBlur = 3 * cur.s;
      g.shadowOffsetY = 1.2 * cur.s;
      g.fillStyle = "#fff";
      g.fill(arrow);
      g.shadowColor = "transparent";
      g.lineJoin = "round";
      g.lineWidth = 1.1;
      g.strokeStyle = "#000";
      g.stroke(arrow);
      g.restore();
      return cv.toDataURL("image/jpeg", 0.92).slice(23);
    };
  }, out);

  const path = cameraPath(take, shot, cfg.maxZoom, cfg.w);
  const seconds = path.length / FPS;
  const fade = `fade=t=in:st=0:d=0.25,fade=t=out:st=${(seconds - 0.3).toFixed(2)}:d=0.3`;
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-vf", `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${fade},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
    "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-crf", String(cfg.crf), "-profile:v", "high",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", join(OUT, `${name}.mp4`)], { stdio: ["pipe", "inherit", "inherit"] });
  let j = -1, frame = "", still = "";
  for (const c of path) {
    let k = Math.max(j, 0);
    while (k + 1 < shot.frames.length && shot.frames[k + 1].t <= c.t) k++;
    if (k !== j) await comp.evaluate((b64) => window.setFrame(b64), shot.frames[(j = k)].data);
    const scale = out.width / c.vw; // output px per CSS px
    const at = (q) => ({ x: (q.x - c.rx) * scale, y: (q.y - c.ry) * scale });
    const since = take.clicks.map((q) => c.t - q.t).filter((d) => d >= 0);
    const dip = since.some((d) => d < 220) ? 1 - 0.16 * Math.sin((Math.PI * Math.min(...since)) / 220) : 1;
    const ripples = take.clicks
      .filter((q) => c.t >= q.t && c.t - q.t < 480)
      .map((q) => {
        const k = (c.t - q.t) / 480;
        return { ...at(q), r: (5 + 21 * (1 - (1 - k) ** 3)) * scale, a: 0.75 * (1 - k), lw: 2 * scale };
      });
    frame = await comp.evaluate((d) => window.draw(d), {
      rx: c.rx, ry: c.ry, vw: c.vw, vh: c.vh, cssWidth: shot.vp.width,
      cur: { ...at(cursorAt(take.track, c.t)), s: CURSOR * dip * scale },
      ripples,
    });
    if (!still && take.still && c.t >= take.still) still = frame;
    if (!ff.stdin.write(Buffer.from(frame, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await comp.close();
  writeFileSync(join(TMP, `${name}.jpg`), Buffer.from(still || frame, "base64"));
  execFileSync("cwebp", ["-quiet", "-q", "84", "-m", "6", join(TMP, `${name}.jpg`), "-o", join(OUT, `${name}.webp`)]);
  const kb = (f) => Math.round(statSync(join(OUT, f)).size / 1024);
  const fps = shot.frames.length / ((shot.frames.at(-1).t - shot.frames[0].t) / 1000);
  console.log(`${name}: ${seconds.toFixed(1)}s ${out.width}×${out.height} · app frames ${fps.toFixed(0)}fps · ${kb(`${name}.mp4`)} KB mp4 · ${kb(`${name}.webp`)} KB still`);
}

async function clip(name, cfg, setup, act) {
  // A step that never settles would otherwise hang the run silently.
  const dog = setTimeout(() => (console.error(`${name}: stuck for 3 minutes (TRACE=1 shows the last step)`), process.exit(1)), 180_000);
  const { browser, p } = await open("dark", { viewport: cfg.viewport, demo: true });
  trace(name, "setup");
  await setup(p);
  trace(name, "act");
  // Rest on the editor's line numbers: no hover cards there.
  const at = { x: 304, y: cfg.viewport.height * 0.62 };
  await p.mouse.move(at.x, at.y);
  const take = new Take(p, at);
  const shot = await shoot(p, () => act(p, take));
  trace(name, "render");
  await render(browser, name, take, shot, cfg);
  await browser.close();
  clearTimeout(dog);
}

// Prints to the newest terminal as if its program wrote it (the mock has no input echo); `perChar` types it out.
const term = (p, text, perChar = 0) =>
  p.evaluate(async ({ text, perChar }) => {
    const pt = Object.values(window.__ptys).at(-1);
    for (const c of perChar ? [...text] : [text]) {
      pt.send(new TextEncoder().encode(c).buffer);
      if (perChar) await new Promise((r) => setTimeout(r, perChar * (0.6 + Math.random() * 0.8)));
    }
  }, { text, perChar });
// What the Claude Code session shows, one line per subagent as it starts (in step with CLAUDE_EVENTS).
const SESSION = {
  head: "\x1b[38;5;173m✻\x1b[0m \x1b[1mClaude Code\x1b[0m \x1b[2m~/code/storefront\x1b[0m\r\n\r\n\x1b[2m>\x1b[0m ",
  prompt: "Fix the coupon rounding in pricing.ts and add tests",
  plan: "\r\n\r\n\x1b[1m⏺\x1b[0m I'll find every place a coupon is applied first.\r\n",
  steps: [
    "\r\n\x1b[35m⏺\x1b[0m \x1b[1mExplore\x1b[0m(Find coupon call sites)\r\n  \x1b[2m⎿  Searching src/ for applyCoupon…\x1b[0m\r\n",
    "\r\n\x1b[35m⏺\x1b[0m \x1b[1mgeneral-purpose\x1b[0m(Read checkout flow)\r\n  \x1b[2m⎿  Reading src/app/checkout/…\x1b[0m\r\n",
    "\r\n\x1b[35m⏺\x1b[0m \x1b[1mtest-writer\x1b[0m(Write pricing tests)\r\n  \x1b[2m⎿  Running…\x1b[0m\r\n",
  ],
  ask: "\r\n\x1b[1m⏺\x1b[0m Fixed coupons below minSpend: ignore the coupon, or reject the order?\r\n\r\n  \x1b[36m❯ 1. Ignore it (current tests expect this)\x1b[0m\r\n    2. Reject the order\r\n\r\n",
  done: "\r\n\x1b[1m⏺\x1b[0m Done: pricing.ts rounds once and 8 tests pass.\r\n",
};

// The whole demo scene, with storefront in front (Start leaves its scripts window there).
async function fullScene(p) {
  await startScripts(p);
  await geminiInCheckout(p);
  await openPricing(p);
  await launchClaude(p);
  await settle(p);
}

const CLIPS = {
  // Lead card: start Claude Code from the tab bar, give it a task, and watch its subagents appear in the sidebar
  // while it works; Gemini sits done in the next space.
  agents: () =>
    clip("agents", WIDE, async (p) => {
      await startScripts(p);
      await geminiInCheckout(p);
      await openPricing(p);
      await settle(p);
    }, async (p, take) => {
      await wait(400);
      const add = await rect(p.locator(".tab-add-btn"));
      const menu = { x: add.x - 120, y: add.y - 10, width: 380, height: 430 };
      // Hovering the + opens its quick menu (a click would open the launcher tab).
      await take.move({ x: add.x + add.width / 2, y: add.y + add.height / 2 });
      await take.look(menu, { hold: 900 });
      await wait(450);
      await take.click(p.locator(".agent-menu .menu-item", { hasText: "Claude Code" }), { look: menu, hold: 300 });
      // The space card and the session side by side.
      await take.look({ x: 0, y: 40, width: 640, height: 400 }, { hold: 9000 });
      await take.move({ x: 560, y: 400 }, 600); // rest in the terminal, below the text
      await term(p, SESSION.head);
      await wait(350);
      await term(p, SESSION.prompt, 34);
      await term(p, SESSION.plan);
      await pushHooks(p, CLAUDE_EVENTS[0]); // the prompt goes in: Working
      for (const [i, step] of CLAUDE_EVENTS.slice(1).entries()) {
        await wait(1000);
        await term(p, SESSION.steps[i]);
        await pushHooks(p, step);
      }
      await wait(1200);
      // Look away (back to the editor); Claude asks a question: the card reads Needs input and the bell lights up.
      await take.click(p.locator(".tab-title", { hasText: "pricing.ts" }), { look: { x: 0, y: 40, width: 640, height: 400 }, hold: 4500 });
      await wait(700);
      await term(p, SESSION.ask);
      await pushHooks(p, [{ hook_event_name: "Notification", notification_type: "agent_needs_input" }]);
      await wait(1400);
      take.poster();
      await take.look(card(p, "storefront"), { zoom: 1.6, hold: 1500 });
      await wait(1500);
      const bell = byTitle(p, "Agent notifications: finished, needs input, exited");
      const bb = await rect(bell);
      await take.click(bell, { look: { x: bb.x - 300, y: bb.y - 120, width: 420, height: 150 }, zoom: 1.6, hold: 300 });
      await wait(400);
      const notices = await rect(p.locator(".popover", { hasText: "Notifications" }));
      await take.look({ x: notices.x - 24, y: notices.y - 24, width: notices.width + 48, height: bb.y + bb.height - notices.y + 36 }, { hold: 2000 });
      await wait(1600);
      // The notice opens the session; answering flips the card back to Working, and the finish to Done.
      await take.click(p.locator(".notice-row").first(), { look: { x: 0, y: 40, width: 640, height: 400 }, hold: 6000 });
      await wait(500);
      await p.locator(".terminal-view:visible .xterm-helper-textarea").focus();
      await take.move({ x: 560, y: 420 }, 500);
      await wait(400);
      await p.keyboard.press("Enter"); // takes the highlighted answer
      await term(p, SESSION.done);
      await wait(1200);
      await pushHooks(p, [{ hook_event_name: "Stop" }]);
      await wait(1500);
      await take.look(card(p, "storefront"), { zoom: 1.5, hold: 1500 });
      await wait(2000);
    }),

  // The intro under the headline: every project at once. Hop to another space and back, look at git across the
  // project's repos and at the ports every project holds, then settle on the whole board again.
  hero: () =>
    clip("hero", HERO, fullScene, async (p, take) => {
      await wait(1000);
      const left = { x: 0, y: 30, width: 900, height: 560 };
      await take.click(card(p, "checkout-v2"), { look: left, hold: 3200 }); // holds chain into the next cue: no zoom-out between beats
      await wait(1300);
      await take.click(card(p, "storefront"), { look: left, hold: 1800 });
      await wait(600);
      const r = await rect(p.locator(".right-panel"));
      await take.click(p.locator(".right-panel .segmented button", { hasText: "Git" }), { look: { x: r.x - 220, y: r.y, width: r.width + 220, height: 520 }, hold: 3000 });
      await wait(1500);
      const btn = p.locator(".status-btn", { hasText: /port/ });
      await take.click(btn, { zoom: 1.3, hold: 1200 });
      await wait(300);
      const pop = await rect(p.locator(".ports-popover"));
      const b = await rect(btn);
      await take.look({ x: pop.x - 40, y: pop.y - 20, width: pop.width + 80, height: b.y + b.height - pop.y + 30 }, { hold: 2200 });
      await wait(2200);
      // Clicking outside closes the ports list; Files comes back, as at the start.
      await take.click(p.locator(".right-panel .segmented button", { hasText: "Files" }), { hold: 200 });
      await wait(1600);
    }),

  // Each space keeps its own tabs; sleeping one stops its agents and keeps the tabs; starring adds it to the Spaces tab.
  spaces: () =>
    clip("spaces", HALF, fullScene, async (p, take) => {
      await wait(500);
      const side = { x: 0, y: 36, width: 600, height: 400 };
      await take.click(card(p, "checkout-v2"), { look: side, hold: 1700 });
      await wait(1300);
      await take.click(card(p, "checkout-v2").locator('[title^="Sleep"], [data-tip^="Sleep"]'), { zoom: 2, hold: 1500 }); // shows on hover; the glide there hovers the card
      await wait(1400);
      await take.click(card(p, "ui-kit"), { look: side, hold: 1300 });
      await wait(1000);
      await take.click(card(p, "ui-kit").locator('[title^="Star"], [data-tip^="Star"]'), { zoom: 2, hold: 900 });
      await wait(600);
      await take.click(p.locator('.left-head [role="tab"]', { hasText: "Spaces" }), { look: { x: 0, y: 36, width: 320, height: 380 }, hold: 2600 });
      await wait(1400);
      take.poster();
      await wait(1600);
    }),

  // Click Start in the sidebar: the pinned scripts open in the project's scripts window; a failing test turns red.
  scripts: () => {
    let run; // where the test row's Run button shows up on hover
    return clip("scripts", HALF, async (p) => {
      const sf = project(p, "storefront");
      const head = sf.locator(".scripts .sub-head").first();
      await head.click(); // opens the scripts window (and folds the list)…
      await head.locator('[title="Expand scripts"], [data-tip="Expand scripts"]').click(); // …unfold it again
      await scriptRow(p, sf, "test").hover();
      run = await rect(scriptRow(p, sf, "test").locator('[title="Run"], [data-tip="Run"]'));
      await p.mouse.move(304, 434);
      await p.waitForTimeout(700);
    }, async (p, take) => {
      const sf = project(p, "storefront");
      const head = sf.locator(".scripts .sub-head").first();
      const h = await rect(head);
      const list = { x: 0, y: h.y - 30, width: 300, height: 230 };
      await wait(300);
      await take.click(head.locator('[title^="Start"], [data-tip^="Start"]'), { look: list, hold: 1200 });
      await wait(900);
      const work = await rect(p.locator(".work"));
      const win = { x: work.x, y: work.y, width: 560, height: 350 };
      await take.look(win, { hold: 2200 });
      await take.move({ x: work.x + 420, y: work.y + 300 }, 700);
      await wait(1400);
      await take.look(list, { hold: 2000 });
      await take.move({ x: run.x + run.width / 2, y: run.y + run.height / 2 }, 800); // passing over the row shows Run
      await take.click(scriptRow(p, sf, "test").locator('[title="Run"], [data-tip="Run"]'), { look: list, hold: 700 });
      await take.look(win, { hold: 2600 });
      await take.move({ x: work.x + 420, y: work.y + 300 }, 600);
      await wait(1500);
      take.poster();
      await wait(1300);
    });
  },

  // Check files, read the diff, generate the message, commit: one repository at a time.
  git: () =>
    clip("git", HALF, async (p) => {
      await startScripts(p);
      await card(p, "storefront").click(); // Start left the scripts window in front
      await openPricing(p);
      await launchClaude(p);
      await settle(p);
    }, async (p, take) => {
      await wait(500);
      const r = await rect(p.locator(".right-panel"));
      const top = { x: r.x - 20, y: r.y, width: r.width + 20, height: 360 };
      await take.click(p.locator(".right-panel .segmented button", { hasText: "Git" }), { look: top, hold: 1000 });
      await wait(500);
      await take.click(p.locator('.right-body:not([hidden]) .tree-node.file[title="src/lib/pricing.ts"]').first(), { look: top, hold: 400 });
      await wait(300);
      const m = await rect(p.locator(".main"));
      await take.look({ x: m.x, y: m.y + 40, width: m.width * 0.8, height: 440 }, { hold: 2000 });
      await take.move({ x: m.x + 16, y: m.y + 330 }, 700); // the diff's line numbers: no hover cards
      await wait(1000);
      const area = await rect(p.locator(".right-body:not([hidden]) .commit-area"));
      const commit = { x: area.x - 30, y: area.y - 90, width: area.width + 30, height: area.height + 100 };
      await take.click(p.locator(".right-body:not([hidden]) button", { hasText: "Generate" }), { look: commit, hold: 2000 });
      await wait(1500);
      take.poster();
      await wait(300);
      await take.click(p.locator(".right-body:not([hidden]) .commit-area .btn.primary").first(), { look: commit, hold: 500 });
      await take.look(top, { hold: 1600 });
      await take.move({ x: r.x + r.width * 0.5, y: r.y + 330 }, 600);
      await wait(1300);
    }),

  // Find what holds a port and free it.
  ports: () =>
    clip("ports", HALF, async (p) => {
      await startScripts(p);
      await card(p, "storefront").click();
      await openPricing(p);
      await p.waitForTimeout(800);
    }, async (p, take) => {
      await wait(500);
      const btn = p.locator(".status-btn", { hasText: /port/ });
      await take.click(btn, { zoom: 1.6, hold: 700 });
      await wait(350);
      const pop = await rect(p.locator(".ports-popover"));
      const b = await rect(btn);
      const around = { x: pop.x - 12, y: pop.y - 12, width: pop.width + 24, height: b.y + b.height - pop.y + 24 };
      await take.look(around, { hold: 6500 });
      await wait(500);
      await take.click(p.locator(".ports-popover input"), { look: around, hold: 5600 });
      await p.keyboard.type("9090", { delay: 150 });
      await wait(900);
      take.poster();
      await take.click(p.locator(".ports-popover .port-row .icon-btn.red").first(), { look: around, hold: 2600 });
      await wait(3000);
    }),

  // Settings: its sections, then flip the whole UI to light (the loop fades back to dark).
  editor: () =>
    clip("editor", HALF, async (p) => {
      await startScripts(p);
      await card(p, "storefront").click();
      await openPricing(p);
      await launchClaude(p);
      await settle(p);
    }, async (p, take) => {
      await wait(500);
      await take.click(byTitle(p, "Settings (⌘,)"), { zoom: 1.6, hold: 500 });
      await wait(450);
      const modal = await rect(p.locator(".modal"));
      await take.look(modal, { hold: 1200 });
      await wait(600);
      const nav = (t) => p.locator(".settings-nav button", { hasText: t });
      const navBox = await rect(p.locator(".settings-nav"));
      const navCue = { x: navBox.x - 10, y: navBox.y - 10, width: Math.min(modal.width, 480), height: 300 };
      await take.click(nav("Notifications"), { look: navCue, hold: 1500 });
      await wait(1300);
      await take.click(nav("Appearance"), { look: navCue, hold: 600 });
      await wait(500);
      const light = p.locator(".modal .segmented button", { hasText: "Light" });
      const lb = await rect(light);
      const row = { x: modal.x, y: lb.y - 70, width: modal.width, height: 180 };
      await take.look(row, { hold: 1200 });
      await wait(400);
      await take.click(light, { look: row, hold: 1600 });
      await wait(1500);
      await p.keyboard.press("Escape");
      await take.look({ x: 0, y: 0, width: 760, height: 470 }, { hold: 2400 });
      await take.move({ x: 304, y: 380 }, 600);
      await wait(1200);
      take.poster();
      await wait(2000);
    }),

  // Browser: open the storefront dev server from a new tab, see it on a phone, a tablet and a laptop at once,
  // scroll them together, then pick a product card and hand it to Claude Code. (mock.js stands in iframes
  // of demo-site.html for the native webviews, and draws the native menus.)
  browser: () =>
    clip("browser", WIDE, async (p) => {
      await startScripts(p);
      await card(p, "storefront").click(); // Start left the scripts window in front
      await p.waitForTimeout(300);
      await launchClaude(p);
      await pushHooks(p, [{ hook_event_name: "Stop" }]); // Claude Code waiting for its next task
      await term(p, SESSION.head);
      await p.evaluate(() => window.__emit("menu", "toggle-right")); // room for three devices
      await p.waitForTimeout(600);
    }, async (p, take) => {
      await wait(400);
      const add = await rect(p.locator(".tab-add-btn"));
      const menu = { x: add.x - 120, y: add.y - 10, width: 380, height: 430 };
      await take.move({ x: add.x + add.width / 2, y: add.y + add.height / 2 }); // hover opens the quick menu
      await take.look(menu, { hold: 700 });
      await wait(500);
      await take.click(p.locator(".agent-menu .menu-item", { hasText: "New browser tab" }), { look: menu, hold: 300 });
      await wait(500);
      const main = await rect(p.locator(".main"));
      const top = { x: main.x, y: main.y, width: main.width * 0.75, height: 380 };
      await take.look(top, { hold: 1300 });
      await p.locator(".start-tile", { hasText: "dev" }).first().waitFor(); // the port scan lists running servers
      await take.click(p.locator(".start-tile", { hasText: "dev" }).first(), { look: main, hold: 1700 });
      await wait(1300);
      // Device view, then swap Desktop for Laptop and turn on Sync.
      await take.click(byTitle(p, "Device view"), { look: main, hold: 500 });
      await wait(700);
      const bar = await rect(p.locator(".device-bar"));
      const barCue = { x: bar.x, y: bar.y - 40, width: bar.width, height: 240 };
      await take.click(p.locator(".device-chip", { hasText: "Laptop" }), { look: barCue, hold: 300 });
      await wait(500);
      await take.click(p.locator(".device-chip", { hasText: "Desktop" }), { look: barCue, hold: 300 });
      await wait(500);
      await take.click(p.locator(".device-sync input"), { look: barCue, hold: 300 });
      await wait(400);
      // Zoom out until the laptop fits beside the others (a frame cut off by the edge stays hidden).
      for (let i = 0; i < 2; i++) {
        await take.click(byTitle(p, "Smaller devices"), { look: barCue, hold: 200 });
        await wait(300);
      }
      await wait(400);
      await take.look(main, { hold: 2600 });
      // Scroll the phone; the tablet and laptop follow.
      const phone = await rect(p.locator(".device-screen").first());
      await take.move({ x: phone.x + phone.width / 2, y: phone.y + phone.height * 0.6 }, 700);
      for (let i = 0; i < 9; i++) {
        await p.mouse.wheel(0, 110);
        await wait(110);
      }
      await wait(1600);
      take.poster();
      // Pick a product card on the tablet and send it to Claude Code.
      await take.click(byTitle(p, "Capture: element, region or full page"), { look: main, hold: 400 });
      await wait(350);
      await take.click(p.locator(".mock-menu-item", { hasText: "Select Element" }), { look: main, hold: 300 });
      await wait(400);
      const tablet = await rect(p.locator(".device-screen").nth(1));
      const target = { x: tablet.x + tablet.width * 0.28, y: tablet.y + tablet.height * 0.42 };
      const zoomIn = { x: tablet.x - 20, y: tablet.y, width: tablet.width + 40, height: tablet.height * 0.75 };
      await take.move(target, 800);
      await take.look(zoomIn, { hold: 1200 });
      await wait(900);
      await take.click({ x: target.x - 1, y: target.y - 1, width: 2, height: 2 }, { look: zoomIn, hold: 1100 });
      await wait(900);
      await take.click(p.locator(".mock-menu-item", { hasText: "Send to" }), { look: zoomIn, hold: 400 });
      await wait(600);
      await take.look({ x: main.x, y: main.y, width: main.width, height: 360 }, { hold: 2600 });
      await take.move({ x: main.x + 300, y: main.y + 300 }, 700);
      await wait(2200);
    }),
};

const pick = process.argv.slice(2);
for (const name of pick.length ? pick : Object.keys(CLIPS)) await CLIPS[name]();
