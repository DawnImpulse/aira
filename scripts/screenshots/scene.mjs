// Opens the app in headless Chromium with mock.js standing in for the Tauri backend, then stages the demo scene:
// scripts running, pricing.ts open, Claude Code working with subagents, Gemini CLI done in another space.
// The steps are exported separately so clips.mjs can record each one from the state just before it.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const mock = readFileSync(new URL("./mock.js", import.meta.url), "utf8");

// `demo` streams terminal output and slows a few replies so clips show the work happening (see mock.js).
export async function open(theme, { viewport = { width: 1440, height: 900 }, demo = false } = {}) {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: theme });
  p.on("pageerror", (e) => console.error("pageerror:", e.message));
  await p.addInitScript(({ t, d }) => Object.assign(window, { __theme: t, __demo: d }), { t: theme, d: demo });
  // Keep the sidebar at its 1440px width (~288px) in smaller clip windows; narrower, its tab strip clips.
  await p.addInitScript((left) => localStorage.setItem("react-resizable-panels:outer-layout", JSON.stringify({ left, work: 100 - left })), (288 / viewport.width) * 100);
  await p.addInitScript({ content: mock });
  await p.goto("http://localhost:1420/");
  await p.waitForSelector(".space-card");
  await p.waitForTimeout(600);
  await lights(p);
  return { browser, p };
}

// Titles move to data-tip once hovered (src/lib/tooltips.ts), so match either.
export const byTitle = (p, t) => p.locator(`[title="${t}"], [data-tip="${t}"]`);
export const project = (p, name) => p.locator("section.project", { has: p.locator(".project-name", { hasText: name }) });
export const card = (p, name) => p.locator(".space-card", { has: p.locator(".card-title", { hasText: new RegExp(`^${name}$`) }) });
const treeRow = (p, name) => p.locator(".right-body:not([hidden]) .tree-row").filter({ has: p.getByText(name, { exact: true }) }).first();
export const scriptRow = (p, proj, name) =>
  proj.locator(".scripts .script-row").filter({ has: p.locator(".script-name", { hasText: new RegExp(`^${name}$`) }) }).first();

// macOS traffic lights in the overlay title bar (the real window draws them; headless Chromium doesn't).
const lights = (p) =>
  p.evaluate(() => {
    const bar = document.querySelector(".titlebar");
    const w = document.createElement("div");
    w.style.cssText = "position:absolute;left:14px;top:13px;display:flex;gap:8px;z-index:9999;pointer-events:none";
    for (const c of ["#ff5f57", "#febc2e", "#28c840"]) {
      const d = document.createElement("span");
      d.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.25)`;
      w.append(d);
    }
    bar.style.position = "relative";
    bar.append(w);
  });

// Start set (dev, storybook, db), then the failing test run, then payments' api.
export async function startScripts(p) {
  const sf = project(p, "storefront");
  await sf.locator(".scripts .sub-head").locator('[title^="Start"], [data-tip^="Start"]').click();
  await p.waitForTimeout(300);
  await scriptRow(p, sf, "test").hover();
  await scriptRow(p, sf, "test").locator('[title="Run"], [data-tip="Run"]').click();
  await p.waitForTimeout(500);
  const pay = project(p, "payments");
  await scriptRow(p, pay, "api").hover();
  await scriptRow(p, pay, "api").locator('[title="Run"], [data-tip="Run"]').click();
  await p.waitForTimeout(300);
}

// Gemini in checkout-v2: works while we watch, finishes after we leave (so its card breathes). Ends back on storefront.
export async function geminiInCheckout(p) {
  await card(p, "checkout-v2").click();
  await p.waitForTimeout(200);
  await p.locator(".tab-add-btn").click();
  await p.locator(".agent-menu .menu-item", { hasText: "Gemini CLI" }).click();
  await p.waitForTimeout(300);
  await p.locator(".terminal-view:visible .xterm-helper-textarea").focus();
  await p.keyboard.type("add step validation");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const pt = Object.values(window.__ptys).at(-1);
    window.__spin = setInterval(() => pt.send(new TextEncoder().encode("⠋ thinking\r").buffer), 100);
  });
  await p.waitForTimeout(5000);
  await card(p, "storefront").click();
  await p.waitForTimeout(300);
  await p.evaluate(() => clearInterval(window.__spin));
}

export async function openPricing(p) {
  for (const n of ["src", "lib"]) {
    await treeRow(p, n).click();
    await p.waitForTimeout(200);
  }
  await treeRow(p, "pricing.ts").dblclick();
  await p.waitForTimeout(800);
}

// Claude Code's hook events; the app polls them once a second (src/lib/terminals.ts), so clips space them out.
export const CLAUDE_EVENTS = [
  [{ hook_event_name: "UserPromptSubmit" }],
  [
    { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "Find coupon call sites", subagent_type: "Explore" } },
    { hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" },
  ],
  [
    { hook_event_name: "PreToolUse", tool_name: "Agent", agent_id: "a1", tool_input: { description: "Read checkout flow", subagent_type: "general-purpose" } },
    { hook_event_name: "SubagentStart", agent_id: "a2", agent_type: "general-purpose" },
  ],
  [
    { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "Write pricing tests", subagent_type: "test-writer" } },
    { hook_event_name: "SubagentStart", agent_id: "a3", agent_type: "test-writer" },
  ],
];
export const pushHooks = (p, events) => p.evaluate((e) => (window.__hookQueue ??= []).push(...e), events);

export async function launchClaude(p) {
  await p.locator(".tab-add-btn").click();
  await p.locator(".agent-menu .menu-item", { hasText: "Claude Code" }).click();
  await p.waitForTimeout(400);
  await pushHooks(p, CLAUDE_EVENTS.flat());
  await p.waitForTimeout(1500);
}

// Editor tab in front, per-terminal memory in the status bar, cursor parked on the empty last line.
export async function settle(p) {
  await p.locator(".tab-title", { hasText: "pricing.ts" }).click();
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const ids = Object.keys(window.__ptys);
    const sizes = [412, 268, 96, 34, 188, 23, 301, 145];
    window.__emit("mem-stats", { sessions: Object.fromEntries(ids.map((id, i) => [id, sizes[i % sizes.length] * 1048576])), app: 182 * 1048576 });
  });
  await p.locator(".monaco-editor .view-line").last().click();
  await p.mouse.move(1300, 1000);
  await p.waitForTimeout(800);
}

export async function scene(p) {
  await startScripts(p);
  await geminiInCheckout(p);
  await openPricing(p);
  await launchClaude(p);
  await settle(p);
}
