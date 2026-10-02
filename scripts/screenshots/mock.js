// Demo-data IPC mock for marketing screenshots: fake __TAURI_INTERNALS__ with a believable workspace.
(() => {
  const H = "/Users/dev/code";
  const SF = `${H}/storefront`, UI = `${SF}/packages/ui`, WT = `${H}/storefront-checkout`, PAY = `${H}/payments`, DOCS = `${H}/docs-site`;
  const callbacks = new Map();
  let nextId = 1;
  const internals = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb, once) {
      const id = nextId++;
      callbacks.set(id, (p) => {
        if (once) callbacks.delete(id);
        return cb && cb(p);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    runCallback(id, data) {
      callbacks.get(id)?.(data);
    },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => handle(cmd, args || {}),
  };
  window.__TAURI_INTERNALS__ = internals;
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  const events = {};
  window.__emit = (event, payload) => (events[event] || []).forEach((h) => internals.runCallback(h, { event, payload, id: 0 }));
  window.__ptys = {};

  const config = {
    projects: [
      {
        id: "p1", name: "storefront", path: SF, icon: { type: "symbol", value: "storefront" }, color: "hsl(210 72% 60%)",
        scriptIds: ["s1", "s2", "s3", "s4"], startScriptIds: ["s1", "s2", "s4"],
        spaces: [
          { id: "sp1", name: "storefront", dir: SF, starred: true },
          { id: "sp2", name: "checkout-v2", dir: WT, starred: true },
          { id: "sp3", name: "ui-kit", dir: UI },
        ],
      },
      {
        id: "p2", name: "payments", path: PAY, icon: { type: "symbol", value: "payments" }, color: "hsl(135 72% 60%)",
        scriptIds: ["s5", "s6"], startScriptIds: [],
        spaces: [{ id: "sp4", name: "payments", dir: PAY, starred: true }],
      },
      {
        id: "p3", name: "docs-site", path: DOCS, icon: { type: "emoji", value: "📚" }, color: "hsl(285 72% 60%)",
        scriptIds: ["s7"], startScriptIds: [], collapsed: true,
        spaces: [{ id: "sp5", name: "docs-site", dir: DOCS }],
      },
    ],
    scripts: {
      s1: { id: "s1", name: "dev", runner: "bun", target: "dev", command: "bun run dev", cwd: "", ownerProjectId: "p1", ports: [3000] },
      s2: { id: "s2", name: "storybook", runner: "bun", target: "storybook", command: "bun run storybook", cwd: "packages/ui", ownerProjectId: "p1", ports: [6006] },
      s3: { id: "s3", name: "test", runner: "bun", target: "test", command: "bun run test", cwd: "", ownerProjectId: "p1" },
      s4: { id: "s4", name: "db", runner: "custom", target: "docker compose up postgres", command: "docker compose up postgres", cwd: "", ownerProjectId: "p1", ports: [5432] },
      s5: { id: "s5", name: "api", runner: "go", target: "./cmd/server", command: "go run ./cmd/server", cwd: "", ownerProjectId: "p2", ports: [8080] },
      s6: { id: "s6", name: "worker", runner: "go", target: "./cmd/worker", command: "go run ./cmd/worker", cwd: "", ownerProjectId: "p2", ports: [9090] },
      s7: { id: "s7", name: "dev", runner: "npm", target: "dev", command: "npm run dev", cwd: "", ownerProjectId: "p3", ports: [4321] },
    },
    settings: {
      theme: window.__theme ?? "dark", uiFont: "System", monoFont: "SF Mono", fontSize: 13, terminalWebgl: false, notifyAgents: true,
      ai: { provider: "anthropic", models: { anthropic: "claude-haiku-4-5" }, baseUrls: {}, keySaved: { anthropic: true }, acknowledged: {} },
    },
    layout: { tabs: [], activeTab: null, activeProjectId: "p1", activeSpaceId: "sp1", terms: [], runningAtQuit: [], rightView: "files", leftView: "projects", views: {} },
  };

  const f = (path, x, y) => ({ path, orig: null, x, y, conflict: false });
  const statuses = {
    [SF]: { branch: "main", oid: "a1b2c3d", upstream: "origin/main", ahead: 2, behind: 0,
      files: [f("src/lib/pricing.ts", ".", "M"), f("src/components/CartDrawer.tsx", ".", "M"), f("src/app/checkout/page.tsx", ".", "M"), f("src/lib/pricing.test.ts", "?", "?"), f("README.md", ".", "M"), f("src/lib/legacy-tax.ts", ".", "D")] },
    [UI]: { branch: "main", oid: "b2c3d4e", upstream: "origin/main", ahead: 0, behind: 0, files: [f("src/Button.tsx", ".", "M"), f("src/tokens.css", ".", "M")] },
    [WT]: { branch: "feat/checkout-v2", oid: "c3d4e5f", upstream: "origin/feat/checkout-v2", ahead: 4, behind: 1, files: [f("src/app/checkout/steps.tsx", ".", "M"), f("src/app/checkout/Summary.tsx", "?", "?")] },
    [PAY]: { branch: "main", oid: "d4e5f6a", upstream: "origin/main", ahead: 0, behind: 1, files: [] },
    [DOCS]: { branch: "main", oid: "e5f6a7b", upstream: "origin/main", ahead: 0, behind: 0, files: [] },
  };
  const e = (base, name, dir = false) => ({ name, path: `${base}/${name}`, dir });
  const dirs = {
    [SF]: [e(SF, ".github", true), e(SF, "packages", true), e(SF, "public", true), e(SF, "src", true), e(SF, ".gitignore"), e(SF, "bun.lock"), e(SF, "docker-compose.yml"), e(SF, "next.config.ts"), e(SF, "package.json"), e(SF, "README.md"), e(SF, "tsconfig.json")],
    [`${SF}/src`]: [e(`${SF}/src`, "app", true), e(`${SF}/src`, "components", true), e(`${SF}/src`, "lib", true), e(`${SF}/src`, "middleware.ts")],
    [`${SF}/src/lib`]: [e(`${SF}/src/lib`, "cart.ts"), e(`${SF}/src/lib`, "pricing.test.ts"), e(`${SF}/src/lib`, "pricing.ts"), e(`${SF}/src/lib`, "stripe.ts")],
    [`${SF}/src/components`]: [e(`${SF}/src/components`, "CartDrawer.tsx"), e(`${SF}/src/components`, "ProductCard.tsx"), e(`${SF}/src/components`, "logo.svg")],
    [`${SF}/src/app`]: [e(`${SF}/src/app`, "checkout", true), e(`${SF}/src/app`, "layout.tsx"), e(`${SF}/src/app`, "page.tsx")],
    [`${SF}/packages`]: [e(`${SF}/packages`, "ui", true)],
    [WT]: [e(WT, "src", true), e(WT, "package.json"), e(WT, "README.md")],
    [PAY]: [e(PAY, "cmd", true), e(PAY, "internal", true), e(PAY, "go.mod"), e(PAY, "README.md")],
  };
  const pricing = `import { TAX_RATES, type Region } from "./tax";
import type { CartItem } from "./cart";

export interface Quote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Prices are integer cents; rounding happens once, at the end. */
export function quote(items: CartItem[], region: Region, coupon?: Coupon): Quote {
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const discount = coupon ? applyCoupon(subtotal, coupon) : 0;
  const taxable = Math.max(0, subtotal - discount);
  const tax = Math.round(taxable * TAX_RATES[region]);
  return { subtotal, discount, tax, total: taxable + tax };
}

export type Coupon =
  | { kind: "percent"; value: number }
  | { kind: "fixed"; value: number; minSpend?: number };

function applyCoupon(subtotal: number, c: Coupon): number {
  if (c.kind === "percent") return Math.round((subtotal * c.value) / 100);
  if (c.minSpend && subtotal < c.minSpend) return 0;
  return Math.min(c.value, subtotal);
}

export const formatPrice = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
`;
  const pricingOld = pricing
    .replace("export function quote(items: CartItem[], region: Region, coupon?: Coupon): Quote {", "export function quote(items: CartItem[], region: Region, coupon?: Coupon): Quote {")
    .replace("  const taxable = Math.max(0, subtotal - discount);\n  const tax = Math.round(taxable * TAX_RATES[region]);\n  return { subtotal, discount, tax, total: taxable + tax };", "  const tax = subtotal * TAX_RATES[region];\n  return { subtotal, discount, tax, total: subtotal - discount + tax };")
    .replace('  if (c.minSpend && subtotal < c.minSpend) return 0;\n', "")
    .replace("/** Prices are integer cents; rounding happens once, at the end. */\n", "");
  const files = {
    [`${SF}/src/lib/pricing.ts`]: pricing,
    [`${SF}/package.json`]: JSON.stringify({ name: "storefront", private: true, scripts: { dev: "next dev --turbopack", build: "next build", test: "vitest run", storybook: "storybook dev -p 6006", lint: "eslint ." } }, null, 2) + "\n",
    [`${SF}/README.md`]: "# Storefront\n\nNext.js shop front. Run `bun run dev`.\n",
  };
  window.__diff = { [`${SF}/src/lib/pricing.ts`]: { original: pricingOld, modified: pricing } };

  const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[34m", c: "\x1b[36m", d: "\x1b[2m", B: "\x1b[1m", m: "\x1b[35m", x: "\x1b[0m" };
  const out = {
    "bun run dev": `${C.d}$ next dev --turbopack${C.x}\r\n   ${C.B}▲ Next.js 15.5.4${C.x} (Turbopack)\r\n   - Local:        http://localhost:3000\r\n   - Network:      http://192.168.1.24:3000\r\n\r\n ${C.g}✓${C.x} Starting...\r\n ${C.g}✓${C.x} Ready in 812ms\r\n ${C.d}○${C.x} Compiling /checkout ...\r\n ${C.g}✓${C.x} Compiled /checkout in 1.4s\r\n ${C.B}GET${C.x} /checkout ${C.g}200${C.x} in 1612ms\r\n ${C.B}GET${C.x} /api/cart ${C.g}200${C.x} in 38ms\r\n ${C.B}POST${C.x} /api/quote ${C.g}200${C.x} in 21ms\r\n ${C.B}GET${C.x} /products/linen-shirt ${C.g}200${C.x} in 144ms\r\n`,
    "bun run storybook": `${C.d}$ storybook dev -p 6006${C.x}\r\n${C.m}storybook v9.1.3${C.x}\r\n\r\n${C.g}info${C.x} => Starting manager..\r\n${C.g}info${C.x} => Starting preview..\r\n\r\n  ╭────────────────────────────────────────────╮\r\n  │  Storybook ready!                          │\r\n  │  Local:   http://localhost:6006/           │\r\n  ╰────────────────────────────────────────────╯\r\n`,
    "bun run test": `${C.d}$ vitest run${C.x}\r\n\r\n ${C.c}RUN${C.x}  v3.2.4 ${C.d}/Users/dev/code/storefront${C.x}\r\n\r\n ${C.g}✓${C.x} src/lib/cart.test.ts ${C.d}(12 tests)${C.x} 9ms\r\n ${C.r}❯${C.x} src/lib/pricing.test.ts ${C.d}(8 tests | 1 failed)${C.x} 14ms\r\n   ${C.r}×${C.x} quote > fixed coupon respects minSpend\r\n\r\n${C.r}AssertionError: expected 1500 to be +0${C.x}\r\n\r\n ${C.d}Test Files${C.x}  ${C.r}1 failed${C.x} | ${C.g}1 passed${C.x} (2)\r\n ${C.d}     Tests${C.x}  ${C.r}1 failed${C.x} | ${C.g}19 passed${C.x} (20)\r\n${C.r}error:${C.x} script "test" exited with code 1\r\n`,
    "docker compose up postgres": `${C.c}[+] Running 1/1${C.x}\r\n ${C.g}✔${C.x} Container storefront-postgres-1  ${C.g}Created${C.x}\r\n${C.b}postgres-1  |${C.x} PostgreSQL init process complete; ready for start up.\r\n${C.b}postgres-1  |${C.x} LOG:  listening on IPv4 address "0.0.0.0", port 5432\r\n${C.b}postgres-1  |${C.x} LOG:  database system is ready to accept connections\r\n`,
    "go run ./cmd/server": `${C.d}time=10:42:07${C.x} level=${C.g}INFO${C.x} msg="connected to postgres" pool=10\r\n${C.d}time=10:42:07${C.x} level=${C.g}INFO${C.x} msg="listening" addr=:8080\r\n${C.d}time=10:42:11${C.x} level=${C.g}INFO${C.x} msg="POST /v1/intents" status=201 dur=18ms\r\n`,
    "go run ./cmd/worker": `${C.d}time=10:42:08${C.x} level=${C.g}INFO${C.x} msg="worker started" queues=webhooks,payouts\r\n`,
  };
  const failing = { "bun run test": 1 };

  async function handle(cmd, a) {
    switch (cmd) {
      case "plugin:event|listen":
        (events[a.event] ||= []).push(a.handler);
        return a.handler;
      case "plugin:dialog|message": {
        const btns = a.buttons?.OkCancelCustom ?? a.buttons?.YesNoCancelCustom ?? [a.buttons?.OkCustom ?? "Ok"];
        return btns[0];
      }
      case "ports_list":
{
        const sess = (c) => Object.entries(window.__ptys).find(([, v]) => v.args.command === c)?.[0] ?? null;
        const L = (port, pid, name, cmd, cwd, s) => ({ port, pid, name, cmd, cwd, session: s === undefined ? sess(cmd) : s });
        return [
          L(3000, 51200, "node", "bun run dev", SF),
          L(6006, 51244, "node", "bun run storybook", UI),
          L(5432, 51302, "com.docker.backend", "docker compose up postgres", SF),
          L(8080, 51391, "server", "go run ./cmd/server", PAY),
          L(4321, 48810, "node", "astro dev", DOCS, null),
          L(9090, 47120, "python3", "python3 -m http.server 9090", "/Users/dev/Downloads", null),
          L(9229, 47001, "node", "node --inspect", "/Users/dev", null),
        ].filter((x) => (x.session !== null || [4321, 9090, 9229].includes(x.port)) && !(window.__killedPids ?? []).includes(x.pid));
      }
      case "kill_pid":
        (window.__killedPids ??= []).push(a.pid);
        return null;
      case "git_commit": {
        // Committed paths leave the working tree, like the real refresh after a commit.
        const done = new Set([...(a.paths ?? []), ...(a.untracked ?? [])]);
        const st = statuses[a.repo];
        if (st) statuses[a.repo] = { ...st, ahead: st.ahead + 1, files: st.files.filter((f) => !done.has(f.path)) };
        return null;
      }
      case "pty_busy":
        return [];
      case "plugin:dialog|open":
        return null;
      case "agent_setup":
        if (a.agent === "claude") window.__claudeKey = a.key;
        return { args: a.agent === "claude" ? ["--settings", "~/Library/Application Support/com.codevry.ide/claude-hooks.json"] : [], env: { IDE_AGENT_EVENTS: `/tmp/agent-events/${a.key}` } };
      case "agent_repo_hooks":
        return a.enable ? "on" : "off";
      case "agent_events":
        return a.key === window.__claudeKey ? (window.__hookQueue ?? []).splice(0) : [];
      case "list_fonts":
        return { all: ["Helvetica Neue", "Inter", "SF Pro", "Menlo", "JetBrains Mono", "SF Mono"], mono: ["Menlo", "JetBrains Mono", "SF Mono"] };
      case "read_file_bytes":
        return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#4c8dff"/></svg>').buffer;
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return true;
      case "load_config":
        return structuredClone(config);
      case "save_config":
        return null;
      case "which":
        return a.names.filter((n) => ["bun", "npm", "go", "python3", "make", "docker", "claude", "codex", "gemini", "opencode", "aider", "cursor-agent", "copilot", "amp", "goose", "qwen", "crush", "droid"].includes(n));
      case "plugin:menu|new": {
        const rid = 1000 + (window.__menuRid = (window.__menuRid ?? 0) + 1);
        return [rid, a.options?.id ?? `m${rid}`];
      }
      case "ai_list_models":
        return ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5-5"];
      case "git_last_message":
        return "feat(cart): free shipping over $50";
      case "git_discover":
        return a.root === SF
          ? [{ path: SF, kind: "primary", parent: null }, { path: UI, kind: "nested", parent: null }, { path: WT, kind: "worktree", parent: SF }]
          : a.root === WT
            ? [{ path: WT, kind: "worktree", parent: SF }]
            : statuses[a.root] ? [{ path: a.root, kind: "primary", parent: null }] : [];
      case "git_status":
        return statuses[a.repo] ?? { branch: "main", oid: "x", upstream: null, ahead: 0, behind: 0, files: [] };
      case "read_dir":
        return dirs[a.path] ?? [];
      case "read_file":
        if (files[a.path] == null) return `// ${a.path.split("/").pop()}\n`;
        return files[a.path];
      case "pty_spawn": {
        let i = 0;
        const send = (m) => internals.runCallback(a.onData.id, { message: m, index: i++ });
        const enc = new TextEncoder();
        const text = a.command ? out[a.command] : `${C.g}dev@mbp${C.x} ${C.c}${a.cwd.replace("/Users/dev", "~")}${C.x} ${C.d}(main)${C.x} $ `;
        // Demo clips (window.__demo) stream output a line at a time; screenshots get it in one chunk.
        const lines = text == null ? [] : window.__demo ? text.split(/(?<=\r\n)/) : [text];
        lines.forEach((l, n) => setTimeout(() => send(enc.encode(l).buffer), 30 + n * (window.__demo ? 90 : 0)));
        if (failing[a.command] != null) setTimeout(() => send({ exit: failing[a.command] }), 300 + lines.length * (window.__demo ? 90 : 0));
        window.__ptys[a.id] = { send, args: a };
        return 4242;
      }
      case "pty_kill":
        setTimeout(() => window.__ptys[a.id]?.send({ exit: 130 }), 30);
        return null;
      case "git_branches":
        return { local: [{ name: "main", upstream: "origin/main", track: "", current: true }, { name: "feat/checkout-v2", upstream: "origin/feat/checkout-v2", track: "", current: false }], remote: ["origin/main", "origin/feat/checkout-v2"] };
      case "git_file_versions": {
        const d = window.__diff[`${a.repo}/${a.path}`];
        return d ? { ...d, binary: false } : { original: "", modified: files[`${a.repo}/${a.path}`] ?? "", binary: false };
      }
      case "ai_commit_message":
        await new Promise((r) => setTimeout(r, window.__demo ? 900 : 300));
        return "fix(pricing): tax the discounted subtotal\n\nRound once at the end; fixed coupons respect minSpend.";
      default:
        return null;
    }
  }
})();

window.Notification = class {
  static permission = "granted";
  static requestPermission = async () => "granted";
  constructor() {}
};
