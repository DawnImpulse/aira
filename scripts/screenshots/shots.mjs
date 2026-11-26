// Regenerates docs/screenshots/*.webp (README + docs/index.html): the real UI with demo data, mock.js standing in
// for the Tauri backend. Needs the dev server (`bun run dev`), Playwright's Chromium
// (`bunx playwright install --only-shell chromium`, once) and cwebp (`brew install webp`).
// Run: bun run screenshots
// ponytail: waits are fixed timeouts tuned for an idle Mac; run one capture at a time (parallel runs starve them).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_EVENTS, byTitle, card, geminiInCheckout, open, openPricing, project, pushHooks, scene, settle, startScripts } from "./scene.mjs";

const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), "ide-screenshots-"));
const VW = 1440, VH = 900, LEFT = 287; // viewport and sidebar width (CSS px)

if (!(await fetch("http://localhost:1420/").then((r) => r.ok, () => false))) {
  console.error("Start the dev server first: bun run dev");
  process.exit(1);
}

async function capture(theme) {
  const { browser, p } = await open(theme);
  const shot = (name, opts = {}) => p.screenshot({ path: join(TMP, `${name}.png`), ...opts });
  const box = (loc) => loc.boundingBox();

  // One element on a transparent background: only it and its own shadow end up in the image.
  async function solo(name, sel, pad = 20) {
    const tag = await p.addStyleTag({
      content: `body * { visibility: hidden !important } ${sel}, ${sel} * { visibility: visible !important }
        html, body, #root, .app, .modal-backdrop { background: transparent !important }`,
    });
    const bb = await box(p.locator(sel).first());
    const x = Math.max(0, bb.x - pad), y = Math.max(0, bb.y - pad);
    await shot(name, { omitBackground: true, clip: { x, y, width: Math.min(VW - x, bb.width + pad * 2), height: Math.min(VH - y, bb.height + pad * 2) } });
    await tag.evaluate((n) => n.remove());
  }
  // The sidebar from `top` down to the bottom of `last`.
  async function sidebar(name, top, last, padBottom = 14) {
    const bl = await box(last);
    await shot(name, { clip: { x: 0, y: top, width: LEFT, height: bl.y + bl.height - top + padBottom } });
  }

  await scene(p);
  if (theme === "light") {
    await shot("light");
    return browser.close();
  }
  await shot("hero");


  // Space cards: Claude Code's subagent tree, Gemini CLI done.
  const sf = project(p, "storefront");
  const head = await box(sf.locator(".project-head"));
  await sidebar("agents-sidebar", head.y - 10, sf.locator(".space-card").nth(1));

  // Agent launcher.
  await p.locator(".tab-add-btn").hover(); // hover opens the quick menu
  await p.waitForTimeout(600);
  // Park the mouse on the menu's own padding: solo() hides the +, which would count as leaving it.
  const menuBox = await box(p.locator(".agent-menu"));
  await p.mouse.move(menuBox.x + 3, menuBox.y + 3);
  await p.waitForTimeout(150);
  await solo("agent-launcher", ".agent-menu");
  await p.keyboard.press("Escape");
  await p.mouse.click(1000, 600);
  await p.waitForTimeout(200);

  // Terminals popover (memory per terminal).
  const termsBtn = p.locator(".status-btn", { hasText: "running" });
  await termsBtn.click();
  await p.waitForTimeout(300);
  await solo("terminals", ".statusbar .popover.up:not(.ports-popover)");
  await termsBtn.click();
  await p.waitForTimeout(200);

  // Ports popover.
  const portsBtn = p.locator(".status-btn", { hasText: /port/ });
  await portsBtn.click();
  await p.waitForTimeout(600);
  await p.locator(".ports-popover input").blur();
  await solo("ports", ".ports-popover");
  await portsBtn.click();
  await p.waitForTimeout(200);

  // Git: commit panel, diff of pricing.ts, generated message.
  await p.locator(".right-panel .segmented button", { hasText: "Git" }).click();
  await p.waitForTimeout(500);
  await p.locator('.right-body:not([hidden]) .tree-node.file[title="src/lib/pricing.ts"]').first().click();
  await p.waitForTimeout(900);
  await p.locator(".right-body:not([hidden]) button", { hasText: "Generate" }).click();
  await p.waitForTimeout(900);
  await p.mouse.move(1000, 880);
  await p.waitForTimeout(300);
  await shot("git");
  await shot("pane-git", { clip: await box(p.locator(".right-panel").first()) }); // floats over the landing hero
  await shot("git-work", { clip: await box(p.locator(".work").first()) }); // the landing's Git tile: no sidebar

  // storefront's scripts window: the header opens it (and folds the list), the chevron unfolds it, dev in front.
  const sfScripts = sf.locator(".scripts .sub-head").first();
  await sfScripts.click();
  await p.waitForTimeout(400);
  await sfScripts.locator('[title="Expand scripts"], [data-tip="Expand scripts"]').click();
  await p.waitForTimeout(300);
  await p.locator(".tab-title", { hasText: "storefront · dev" }).click();
  await p.waitForTimeout(600);
  await p.mouse.move(1000, 880);
  await p.waitForTimeout(300);
  await shot("scripts");

  // Spaces tab, then the Scripts tab with Inactive unfolded.
  const tab = (name) => p.locator(".left-head .segmented button", { hasText: name });
  await tab("Spaces").click();
  await p.waitForTimeout(400);
  await sidebar("spaces-sidebar", 38, p.locator(".left-panel .space-card").last(), 16);
  await tab("Scripts").click();
  await p.waitForTimeout(300);
  await p.locator(".left-panel .clean-toggle", { hasText: "Inactive" }).click();
  await p.waitForTimeout(300);
  await p.mouse.move(1000, 880);
  await sidebar("scripts-sidebar", 38, p.locator(".left-panel .script-row").last(), 16);
  await tab("Projects").click();
  await p.waitForTimeout(300);

  // Project settings dialog.
  await sf.locator(".project-head").hover();
  await sf.locator(".project-head").locator('[title^="Project settings"], [data-tip^="Project settings"]').click();
  await p.waitForTimeout(500);
  await solo("project-dialog", ".modal", 24);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  // Settings, on its Commit messages section (the features page shows it under AI commit messages).
  await byTitle(p, "Settings (⌘,)").click();
  await p.waitForTimeout(600);
  await p.locator(".settings-nav button", { hasText: "Commit messages" }).click();
  await p.waitForTimeout(400);
  await solo("settings", ".modal", 24);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  // Browser tab (mock.js stands in iframes of demo-site.html for the native webviews): the storefront dev
  // server on a phone, a tablet and a laptop, with the right panel folded away for room.
  await p.evaluate(() => window.__emit("menu", "toggle-right"));
  await p.evaluate(() => window.__emit("menu", "new-browser"));
  await p.locator(".start-tile", { hasText: "dev" }).first().waitFor(); // the port scan lists running servers
  await p.locator(".start-tile", { hasText: "dev" }).first().click();
  await p.waitForTimeout(1200);
  await byTitle(p, "Device view").click();
  await p.waitForTimeout(800);
  await p.locator(".device-chip", { hasText: "Laptop" }).click();
  await p.locator(".device-chip", { hasText: "Desktop" }).click();
  await p.locator(".device-sync input").check();
  for (let i = 0; i < 2; i++) await byTitle(p, "Smaller devices").click(); // the laptop fits beside the others
  await p.waitForTimeout(1500);

  // Capture: pick a product card on the tablet; the menu offers Save or Send to the space's agent.
  await byTitle(p, "Capture: element, region or full page").click();
  await p.locator(".mock-menu-item", { hasText: "Select Element" }).click();
  await p.waitForTimeout(400);
  const tablet = await box(p.locator(".device-screen").nth(1));
  await p.mouse.move(tablet.x + tablet.width * 0.28, tablet.y + tablet.height * 0.42, { steps: 6 });
  await p.waitForTimeout(400);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(900);
  await p.mouse.move(tablet.x + tablet.width * 0.28 + 40, tablet.y + tablet.height * 0.42 + 70, { steps: 4 }); // over "Send to"
  await p.waitForTimeout(300);
  await shot("browser-capture");
  await shot("browser-work", { clip: await box(p.locator(".main").first()) }); // the landing's browser tile: the tab alone
  await p.mouse.click(1100, 880); // close the menu
  await p.waitForTimeout(300);

  // More devices…, and importing sign-ins.
  await p.locator(".device-chip.more").click();
  await p.waitForTimeout(500);
  await solo("devices-dialog", ".modal", 24);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await byTitle(p, "Import sign-ins from your browsers").click();
  await p.waitForTimeout(500);
  await solo("sign-ins", ".logins-pop", 20);
  await browser.close();
}


// Landing hero: the space's main pane with four tabs in its strip (pricing.ts, the Claude Code session, the
// browser tab in device view, a shell). Each tab is recorded for about three seconds of work (the editor typing,
// Claude streaming, the devices scrolling, the shell running a command) as a small muted MP4 in docs/media, with
// its first frame as the poster in docs/screenshots. Frames are grabbed at 1x; the page shows the pane at ~0.8x.
const MEDIA = new URL("../../docs/media/", import.meta.url).pathname;
// Grabs frames of `box` as fast as the screenshot call allows (about 8 to 25 a second) while `action` runs, then
// encodes them at the measured rate as docs/media/NAME.mp4. The first frame is the poster (docs/screenshots/NAME.webp).
// Small crops are grabbed at 2x so text stays crisp on Retina screens (the page shows them at their CSS size);
// wide ones stay at 1x, where a 2x grab drops the frame rate under 10 fps.
async function clip(p, name, box, action, { scale = box.width > 800 ? "css" : "device", omitBackground = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `ide-clip-${name}-`));
  let n = 0, done = false;
  const t0 = Date.now();
  const grab = (async () => {
    while (!done) await p.screenshot({ path: join(dir, `${String(n++).padStart(3, "0")}.png`), clip: box, scale, omitBackground });
  })();
  await action();
  await p.waitForTimeout(500);
  done = true;
  await grab;
  const fps = n / ((Date.now() - t0) / 1000);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps.toFixed(2), "-i", join(dir, "%03d.png"),
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "24", "-preset", "medium", "-movflags", "+faststart", "-an",
    join(MEDIA, `${name}.mp4`)]);
  copyFileSync(join(dir, "000.png"), join(TMP, `${name}.png`));
  console.log(`${name}: ${n} frames, ${fps.toFixed(1)} fps`);
}
const pad = (b, n = 12) => ({ x: Math.max(0, b.x - n), y: Math.max(0, b.y - n), width: b.width + 2 * n, height: b.height + 2 * n });

// Features page: one clip per section, cropped to the part of the app that feature lives in. Demo mode streams
// script output and slows Generate so the work shows.
async function featureClips() {
  const { browser, p } = await open("dark", { demo: true });
  const box = (loc) => loc.boundingBox();
  const sf = project(p, "storefront");
  const left = () => p.locator(".left-panel").first();

  // Scripts: Start next to storefront's pinned scripts; dev, storybook and db turn green, then test fails.
  await clip(p, "feat-scripts", pad(await box(sf)), async () => {
    await startScripts(p);
    await p.waitForTimeout(2200);
  });
  await geminiInCheckout(p);
  await openPricing(p);

  // Agents: pick Claude Code from the +, the card turns Working, subagents nest one by one.
  const agentsBox = pad(await box(sf.locator(".space-card").first()), 16);
  await clip(p, "feat-agents", { ...agentsBox, height: agentsBox.height + 110 }, async () => {
    await p.locator(".tab-add-btn").hover(); // the + opens its quick menu on hover
    await p.waitForTimeout(500);
    await p.locator(".agent-menu .menu-item", { hasText: "Claude Code" }).click();
    await p.waitForTimeout(400);
    for (const group of CLAUDE_EVENTS) {
      await pushHooks(p, group);
      await p.waitForTimeout(1250); // the app polls hook events once a second
    }
    await p.waitForTimeout(600);
  });
  await settle(p);

  // Projects and spaces: hop to checkout-v2, then ui-kit, star it, open the Spaces tab.
  const leftBox = await box(left());
  await clip(p, "feat-spaces", { ...leftBox, height: 470 }, async () => { // down to ui-kit; the Spaces tab lists four cards in the same room
    await card(p, "checkout-v2").click();
    await p.waitForTimeout(900);
    await card(p, "ui-kit").click();
    await p.waitForTimeout(900);
    await card(p, "ui-kit").hover();
    await byTitle(p, "Star (show in Spaces view)").first().click();
    await p.waitForTimeout(700);
    await p.locator(".left-head .segmented button", { hasText: "Spaces" }).click();
    await p.waitForTimeout(1400);
  });
  await p.locator(".left-head .segmented button", { hasText: "Projects" }).click();
  await card(p, "storefront").click();
  await p.waitForTimeout(400);

  // Git and AI commit messages: the Git tab, a file's diff, Generate (spinner, then the message), Commit.
  const right = pad(await box(p.locator(".right-panel").first()), 0);
  await p.locator(".right-panel .segmented button", { hasText: "Git" }).click();
  await p.waitForTimeout(500);
  const genBtn = p.locator(".right-body:not([hidden]) button", { hasText: "Generate" });
  const gb = await box(genBtn);
  const commitBox = { x: right.x, y: gb.y - 16, width: right.width, height: right.y + right.height - gb.y + 16 };
  await clip(p, "feat-ai", commitBox, async () => {
    await genBtn.click();
    await p.waitForTimeout(2200);
  });
  await clip(p, "feat-git", { ...right, height: 350 }, async () => { // the tree; the commit box lives in the Generate clip
    await p.locator('.right-body:not([hidden]) .tree-node.file[title="src/lib/pricing.ts"]').first().click();
    await p.waitForTimeout(1200);
    await p.locator(".right-body:not([hidden]) .btn.primary", { hasText: "Commit" }).first().click();
    await p.waitForTimeout(1600);
  });

  // Ports: open the list, search 6006, free it (a script's port stops without asking; outside processes ask first,
  // and that dialog would close the popover under us).
  const portsBtn = p.locator(".status-btn", { hasText: /port/ });
  await portsBtn.click();
  await p.waitForTimeout(600);
  // The list is anchored to the status bar and shrinks upward as the search narrows, so crop its bottom.
  const popBox = await box(p.locator(".ports-popover"));
  const pop = pad({ x: popBox.x, y: popBox.y + popBox.height - 150, width: popBox.width, height: 150 }, 16);
  const solo = await p.addStyleTag({ content: `body * { visibility: hidden !important } .ports-popover, .ports-popover * { visibility: visible !important }
    html, body, #root, .app { background: transparent !important }` });
  await clip(p, "feat-ports", pop, async () => {
    await p.locator(".ports-popover input").focus();
    await p.keyboard.type("6006", { delay: 160 }); // storybook's port: a script, so it stops on the spot (no dialog)
    await p.waitForTimeout(900);
    await p.locator(".ports-popover .icon-btn.red").first().click({ force: true });
    await p.waitForTimeout(2000);
  }, { omitBackground: true });
  await solo.evaluate((n) => n.remove());
  await p.keyboard.press("Escape"); // the list may already have closed itself after the free
  await p.mouse.click(1000, 600);
  await p.waitForTimeout(300);

  // Editor and themes: Settings, Light, then Dark again, on the whole window.
  await byTitle(p, "Settings (⌘,)").click();
  await p.waitForTimeout(600);
  const theme = (name) => p.locator(".modal .segmented button", { hasText: name });
  await clip(p, "feat-theme", { x: 0, y: 0, width: 1440, height: 900 }, async () => {
    await theme("Light").click();
    await p.waitForTimeout(1800);
    await theme("Dark").click();
    await p.waitForTimeout(1200);
  });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);

  // Browser: pick an element on the tablet and send it to the agent.
  await p.evaluate(() => window.__emit("menu", "toggle-right"));
  await p.evaluate(() => window.__emit("menu", "new-browser"));
  await p.locator(".start-tile", { hasText: "dev" }).first().waitFor();
  await p.locator(".start-tile", { hasText: "dev" }).first().click();
  await p.waitForTimeout(1200);
  await byTitle(p, "Device view").click();
  await p.waitForTimeout(800);
  await p.locator(".device-chip", { hasText: "Laptop" }).click();
  await p.locator(".device-chip", { hasText: "Desktop" }).click();
  await p.locator(".device-sync input").check();
  for (let i = 0; i < 2; i++) await byTitle(p, "Smaller devices").click();
  await p.waitForTimeout(1500);
  const main = await box(p.locator(".main").first());
  await clip(p, "feat-capture", main, async () => {
    await byTitle(p, "Capture: element, region or full page").click();
    await p.waitForTimeout(500);
    await p.locator(".mock-menu-item", { hasText: "Select Element" }).click();
    await p.waitForTimeout(500);
    const tablet = await box(p.locator(".device-screen").nth(1));
    await p.mouse.move(tablet.x + tablet.width * 0.28, tablet.y + tablet.height * 0.42, { steps: 12 });
    await p.waitForTimeout(500);
    await p.mouse.down();
    await p.mouse.up();
    await p.waitForTimeout(900);
    await p.mouse.move(tablet.x + tablet.width * 0.28 + 40, tablet.y + tablet.height * 0.42 + 70, { steps: 8 });
    await p.waitForTimeout(1200);
  });
  await browser.close();
}

async function heroPanes() {
  const { browser, p } = await open("dark"); // the default 1440 window, with the right panel folded below
  await scene(p);
  await p.evaluate(() => window.__emit("menu", "toggle-right")); // the Git panel floats on the page instead
  await p.waitForTimeout(500);
  const pane = await p.locator(".main").first().boundingBox();
  const mainTab = (text) => p.locator(".tabbar [data-tab-id]", { hasText: text }).first();
  // Bytes into a mock pty: the Claude session (by its command) or the shell opened below (no command, newest).
  const pty = (which, text) =>
    p.evaluate(([which, txt]) => {
      const all = Object.values(window.__ptys);
      const t = which === "claude" ? all.find((x) => /claude/.test(JSON.stringify(x.args))) : all.filter((x) => !x.args.command).at(-1);
      t?.send(new TextEncoder().encode(txt).buffer);
    }, [which, text]);
  await pty("claude", CLAUDE_HEAD);
  await p.evaluate(() => window.__emit("menu", "new-terminal"));
  await p.waitForTimeout(600);
  await mainTab("Claude Code").click(); // the launcher's port scan only lists servers from a non-terminal tab
  await p.waitForTimeout(300);
  // The launcher lists running servers after a port scan; if it misses, open another tab and try again.
  for (let tries = 0; ; tries++) {
    await p.evaluate(() => window.__emit("menu", "new-browser"));
    const tile = p.locator(".start-tile", { hasText: "dev" }).first();
    if (await tile.waitFor({ timeout: 10000 }).then(() => true, () => false)) break;
    if (tries === 3) throw new Error("hero: the browser launcher never listed the dev server");
  }
  await p.locator(".start-tile", { hasText: "dev" }).first().click();
  await p.waitForTimeout(1200);
  // Device view: the shop on a phone, a tablet and a laptop, scrolled together. Recorded straight away: a device
  // that was out of view before the zoom is hidden again once the tab is left and returned to.
  await byTitle(p, "Device view").click();
  await p.waitForTimeout(800);
  await p.locator(".device-chip", { hasText: "Laptop" }).click();
  await p.locator(".device-chip", { hasText: "Desktop" }).click(); // off, so the laptop is the widest and gets drawn
  await p.locator(".device-sync input").check();
  for (let i = 0; i < 2; i++) await byTitle(p, "Smaller devices").click(); // the laptop fits beside the others
  await p.mouse.move(1000, 14); // park on the title bar: the status bar's buttons show tooltips
  await p.waitForTimeout(2500);

  const record = (name, action) => clip(p, `pane-${name}`, pane, action);
  const typeOut = async (which, text, delay) => {
    for (const ch of text) {
      await pty(which, ch);
      await p.waitForTimeout(delay);
    }
  };
  // Browser: the three devices scroll together through the shop, each to the same fraction of its own range,
  // so the phone, the tablet and the laptop all visibly move.
  await record("browser", () =>
    p.evaluate(async () => {
      const frames = [...document.querySelectorAll("iframe")].filter((f) => f.style.display !== "none" && f.srcdoc);
      const range = (f) => f.contentDocument.documentElement.scrollHeight - f.contentWindow.innerHeight;
      for (let t = 0; t <= 1; t += 1 / 34) {
        const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
        for (const f of frames) f.contentWindow.scrollTo(0, Math.round(k * 0.7 * range(f)));
        await new Promise((r) => setTimeout(r, 70));
      }
    }));
  // Editor: a two-line helper typed into the middle of pricing.ts, then saved.
  await mainTab("pricing.ts").click();
  await p.waitForTimeout(600);
  await p.locator(".monaco-editor .view-line").nth(9).click(); // the blank line after the Quote interface
  await p.keyboard.press("End");
  await record("editor", async () => {
    await p.keyboard.press("Enter");
    await p.keyboard.type('export const TAX_FREE: Region[] = ["NH", "OR", "MT"];', { delay: 38 });
    await p.keyboard.press("Enter");
    await p.keyboard.type("export const isTaxFree = (r: Region) => TAX_FREE.includes(r);", { delay: 38 });
    await p.waitForTimeout(400);
    await p.keyboard.press("Meta+S");
    await p.waitForTimeout(500);
  });
  // Claude Code: the transcript streams in under the prompt while the tab's spinner turns.
  await mainTab("Claude Code").click();
  await p.waitForTimeout(600);
  await record("claude", async () => {
    for (const line of CLAUDE_LINES) {
      await pty("claude", line + "\r\n");
      await p.waitForTimeout(190);
    }
  });
  // Shell: a command typed at the prompt, then its output.
  await mainTab("shell").click();
  await p.waitForTimeout(600);
  await record("terminal", async () => {
    await typeOut("shell", "bun run build", 75);
    await p.waitForTimeout(350);
    for (const line of SHELL_OUTPUT) {
      await pty("shell", line + "\r\n");
      await p.waitForTimeout(140);
    }
  });
  await browser.close();
}

const E = "\x1b[", X = "\x1b[0m";
const CLAUDE_HEAD = [
  `${E}38;5;209m✻${X} ${E}1mWelcome to Claude Code${X}  ${E}2mv2.1 · ~/code/storefront${X}`,
  ``,
  `${E}2m>${X} Fix the tax calculation in pricing.ts: tax should apply to the discounted subtotal, and fixed coupons must respect minSpend.`,
  ``,
].join("\r\n") + "\r\n";
const CLAUDE_LINES = [
  `${E}38;5;209m●${X} ${E}1mExplore${X}${E}2m(Find coupon call sites)${X}`,
  `  ${E}2m⎿  Read 3 files · src/lib/pricing.ts, src/lib/cart.ts, src/components/CartDrawer.tsx${X}`,
  `${E}38;5;209m●${X} ${E}1mgeneral-purpose${X}${E}2m(Read checkout flow)${X}`,
  `  ${E}2m⎿  Done · the discount is applied after tax in quote()${X}`,
  `${E}38;5;209m●${X} ${E}1mUpdate${X}${E}2m(src/lib/pricing.ts)${X}`,
  `  ${E}2m⎿  Updated src/lib/pricing.ts with 4 additions and 2 removals${X}`,
  `     ${E}32m+  const taxable = Math.max(0, subtotal - discount);${X}`,
  `     ${E}32m+  const tax = Math.round(taxable * TAX_RATES[region]);${X}`,
  `${E}38;5;209m●${X} ${E}1mtest-writer${X}${E}2m(Write pricing tests)${X}`,
  `  ${E}2m⎿  Writing src/lib/pricing.test.ts…${X}`,
  ``,
  `${E}38;5;209m✶${X} ${E}1mWorking…${X} ${E}2m(14s · ↑ 1.8k tokens · esc to interrupt)${X}`,
];
const SHELL_OUTPUT = [
  ``,
  `${E}2m$ bun build ./src/index.ts --outdir dist --target browser${X}`,
  ``,
  `  ${E}32m✓${X} Bundled 42 modules in 212ms`,
  `  dist/index.js   ${E}2m48.2 KB${X}`,
  `  dist/index.css  ${E}2m 3.1 KB${X}`,
  ``,
  `${E}32mdev@mbp${X} ${E}36m~/code/storefront${X} ${E}2m(main)${X} $ `,
];

// ONLY=shots|hero|feat runs one pass while iterating on it; everything runs by default.
const only = process.env.ONLY;
if (!only || only === "shots") await capture("dark");
if (!only || only === "hero") await heroPanes();
if (!only || only === "feat") await featureClips();
if (!only || only === "shots") await capture("light");
const pngs = readdirSync(TMP);
const webp = (src, out, ...args) => execFileSync("cwebp", ["-quiet", "-q", "88", "-m", "6", ...args, src, "-o", join(OUT, out)]);
for (const f of pngs) {
  const name = f.replace(/\.png$/, "");
  webp(join(TMP, f), `${name}.webp`);
  // Full-window shots also get a 1x variant for the page's srcset (phones and 1x screens).
  if (["hero", "git", "scripts", "light", "browser-capture"].includes(name)) webp(join(TMP, f), `${name}-1440.webp`, "-resize", "1440", "0");
}
console.log(`Wrote ${pngs.length} screenshots to docs/screenshots/`);
await import("./og.mjs"); // the social card is built from the new hero shot
