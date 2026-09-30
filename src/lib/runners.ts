import { api } from "../ipc";

export interface Runner {
  id: string;
  label: string;
  /** vscode-material-icons name (colored). */
  icon: string;
  /** Executable checked on PATH; null = always available. */
  bin: string | null;
  targetLabel: string;
  command: (target: string) => string;
}

export const RUNNERS: Runner[] = [
  { id: "bun", icon: "bun", label: "bun", bin: "bun", targetLabel: "Script", command: (t) => `bun run ${t}` },
  { id: "npm", icon: "npm", label: "npm", bin: "npm", targetLabel: "Script", command: (t) => `npm run ${t}` },
  { id: "pnpm", icon: "pnpm", label: "pnpm", bin: "pnpm", targetLabel: "Script", command: (t) => `pnpm run ${t}` },
  { id: "yarn", icon: "yarn", label: "yarn", bin: "yarn", targetLabel: "Script", command: (t) => `yarn ${t}` },
  { id: "python", icon: "python", label: "python", bin: "python3", targetLabel: "File / args", command: (t) => `python3 ${t}` },
  { id: "uv", icon: "python", label: "uv", bin: "uv", targetLabel: "Command", command: (t) => `uv run ${t}` },
  { id: "java", icon: "java", label: "java", bin: "java", targetLabel: "File / -jar app.jar", command: (t) => `java ${t}` },
  { id: "maven", icon: "maven", label: "maven", bin: "mvn", targetLabel: "Goals", command: (t) => `mvn ${t}` },
  { id: "gradle", icon: "gradle", label: "gradle (wrapper)", bin: null, targetLabel: "Tasks", command: (t) => `./gradlew ${t}` },
  { id: "cargo", icon: "rust", label: "cargo", bin: "cargo", targetLabel: "Command", command: (t) => `cargo ${t}` },
  { id: "go", icon: "go", label: "go", bin: "go", targetLabel: "Command", command: (t) => `go ${t}` },
  { id: "make", icon: "makefile", label: "make", bin: "make", targetLabel: "Target", command: (t) => `make ${t}` },
  { id: "custom", icon: "console", label: "Custom command", bin: null, targetLabel: "Command", command: (t) => t },
];

export const runnerById = (id: string) => RUNNERS.find((r) => r.id === id) ?? RUNNERS[RUNNERS.length - 1];

let available: Promise<Set<string>> | null = null;
/** Runner ids whose executable exists on the login-shell PATH (cached). */
export function availableRunners(): Promise<Set<string>> {
  available ??= api.which(RUNNERS.flatMap((r) => (r.bin ? [r.bin] : []))).then((bins) => {
    const found = new Set(bins);
    return new Set(RUNNERS.filter((r) => !r.bin || found.has(r.bin)).map((r) => r.id));
  });
  return available;
}

/** JS package manager for a folder, from its lockfile. */
export function jsRunner(fileNames: string[]): string {
  const has = (f: string) => fileNames.includes(f);
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

export interface Detected {
  name: string;
  runner: string;
  target: string;
  source: string;
}

/** Runnable entries found in a folder: package.json scripts and Makefile targets. */
export async function detectScripts(dir: string): Promise<Detected[]> {
  const names = (await api.readDir(dir).catch(() => [])).map((e) => e.name);
  const out: Detected[] = [];
  if (names.includes("package.json")) {
    try {
      const pkg = JSON.parse(await api.readFile(`${dir}/package.json`));
      const runner = jsRunner(names);
      for (const name of Object.keys(pkg.scripts ?? {})) out.push({ name, runner, target: name, source: "package.json" });
    } catch {
      /* unreadable package.json: nothing detected */
    }
  }
  const makefile = names.find((n) => n === "Makefile" || n === "makefile");
  if (makefile) {
    const text = await api.readFile(`${dir}/${makefile}`).catch(() => "");
    for (const m of text.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(?!=)/gm)) {
      out.push({ name: m[1], runner: "make", target: m[1], source: "Makefile" });
    }
  }
  return out;
}
