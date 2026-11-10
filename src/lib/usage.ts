import type { UsageRow } from "../ipc";

/**
 * USD per million tokens: [input, output, cache read, cache write]; first matching prefix wins.
 * Anthropic API list prices (2026-06). Subscription users don't pay these, so the UI calls it
 * "API-equivalent". Unknown model → tokens only, no cost.
 */
const PRICES: [string, [number, number, number, number]][] = [
  ["claude-opus-5-5", [4, 20, 0.2, 5]],
  ["claude-opus-", [5, 25, 0.5, 6.25]],
  ["claude-fable-5-1", [10, 50, 0.25, 12.5]],
  ["claude-fable-", [10, 50, 1, 12.5]],
  ["claude-mythos-", [10, 50, 0.25, 12.5]],
  ["claude-sonnet-5", [2, 10, 0.2, 2.5]],
  ["claude-sonnet-", [3, 15, 0.3, 3.75]],
  ["claude-haiku-", [1, 5, 0.1, 1.25]],
];

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const formatTokens = (n: number) => compact.format(n);

const sum = (r: UsageRow) => r.input + r.output + r.cache_read + r.cache_create;
const total = (rows: UsageRow[]) => rows.reduce((a, r) => a + sum(r), 0);

/** API-equivalent USD, or null when a model with tokens has no price. */
export function costOf(rows: UsageRow[]): number | null {
  let usd = 0;
  for (const r of rows) {
    if (!sum(r)) continue; // e.g. "<synthetic>" entries
    const p = PRICES.find(([k]) => r.model.startsWith(k))?.[1];
    if (!p) return null;
    usd += (r.input * p[0] + r.output * p[1] + r.cache_read * p[2] + r.cache_create * p[3]) / 1e6;
  }
  return usd;
}

/** `48K tok · $0.42` */
export function usageLabel(rows: UsageRow[]) {
  const c = costOf(rows);
  return `${formatTokens(total(rows))} tok${c === null ? "" : ` · $${c.toFixed(2)}`}`;
}

/** Tooltip: per-model breakdown. */
export function usageTitle(rows: UsageRow[]) {
  const lines = rows
    .filter(sum)
    .map((r) => `${r.model}: ${formatTokens(r.input)} in · ${formatTokens(r.output)} out · ${formatTokens(r.cache_read)} cache read · ${formatTokens(r.cache_create)} cache write`);
  return [...lines, "API-equivalent cost at list prices; subagent transcripts not included."].join("\n");
}
