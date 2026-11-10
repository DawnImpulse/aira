// Regenerates docs/screenshots/*.webp (README + docs/index.html): the real UI with demo data, mock.js standing in
// for the Tauri backend. Needs the dev server (`bun run dev`), Playwright's Chromium
// (`bunx playwright install --only-shell chromium`, once) and cwebp (`brew install webp`).
// Run: bun run screenshots
// ponytail: waits are fixed timeouts tuned for an idle Mac; run one capture at a time (parallel runs starve them).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byTitle, open, project, scene } from "./scene.mjs";

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

await capture("dark");
await capture("light");
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
