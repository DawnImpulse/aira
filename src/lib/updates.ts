import { check, type Update } from "@tauri-apps/plugin-updater";
import { notify, restartApp, useStore } from "../store";

/** The bottom-right update card. `hidden`: dismissed with "Later"; the status-bar pill brings it back. */
export type UpdateState = {
  version: string;
  stage: "available" | "downloading" | "installed" | "upToDate" | "error";
  notes?: string;
  progress?: number; // 0..1 while downloading (unknown when the server sends no Content-Length)
  downloaded?: number; // bytes so far
  total?: number; // bytes, when known
  error?: string;
  hidden?: boolean;
};

let checking = false;
let pending: Update | null = null; // found, not installed yet
let installed: string | undefined; // already swapped into the bundle this session; runs on the next launch
const EVERY = 12 * 60 * 60 * 1000;
const LAST = "updates:lastCheck";
/** When the last check ran (any kind), for the Settings Updates tab. */
export const lastChecked = () => Number(localStorage.getItem(LAST) || 0) || undefined;
const setUpdate = (update: UpdateState | null) => useStore.setState({ update });
const patch = (p: Partial<UpdateState>) => useStore.setState((s) => (s.update ? { update: { ...s.update, ...p } } : {}));

/** Automatic checks: at most one per 12 hours, counted across launches; a manual check counts as one. */
export function scheduleUpdateChecks() {
  const tick = () => {
    const last = Number(localStorage.getItem(LAST) ?? 0);
    if (Date.now() - last < EVERY) return;
    localStorage.setItem(LAST, String(Date.now()));
    checkForUpdates();
  };
  setTimeout(tick, 15_000); // after the window has settled
  setInterval(tick, 60 * 60 * 1000); // hourly poll keeps long-running sessions on the 12h cadence
}

/**
 * Looks for a newer release (release.yml publishes latest.json next to each DMG) and shows the card.
 * A manual check also reports "up to date" and failures; the automatic one stays quiet about those.
 */
export async function checkForUpdates(manual = false) {
  if (checking) return;
  if (import.meta.env.DEV) {
    if (manual) notify("Updates only apply to a built Aira.app, not a dev run.");
    return;
  }
  checking = true;
  if (manual) localStorage.setItem(LAST, String(Date.now()));
  try {
    // The running process still reports the old version, so `check()` would offer the same update again.
    if (installed) {
      if (manual) patch({ hidden: false });
      return;
    }
    const u = await check();
    if (!u) {
      if (manual) {
        setUpdate({ version: "", stage: "upToDate" });
        setTimeout(() => useStore.getState().update?.stage === "upToDate" && setUpdate(null), 4000);
      }
      return;
    }
    pending = u;
    setUpdate({ version: u.version, stage: "available", notes: u.body?.trim() });
  } catch (e) {
    if (manual) setUpdate({ version: "", stage: "error", error: String(e) });
  } finally {
    checking = false;
  }
}

/** "Update" on the card: downloads and swaps the bundle on disk. The running app is left alone until "Restart now". */
export async function installUpdate() {
  const u = pending;
  if (!u) return;
  pending = null;
  let total = 0;
  let got = 0;
  setUpdate({ version: u.version, stage: "downloading", progress: 0, downloaded: 0 });
  try {
    await u.downloadAndInstall((e) => {
      if (e.event === "Started") {
        total = e.data.contentLength ?? 0;
        patch({ total: total || undefined });
      } else if (e.event === "Progress") {
        got += e.data.chunkLength;
        patch({ downloaded: got, progress: total ? got / total : undefined });
      }
    });
    installed = u.version;
    setUpdate({ version: u.version, stage: "installed" });
  } catch (e) {
    setUpdate({ version: u.version, stage: "error", error: String(e) });
  }
}

/** "Restart now": the relaunch hands every terminal to the new version (plan 015). */
export const restartForUpdate = () => restartApp();

/** "Later" / close: an update that is available or installed stays reachable from the status bar. */
export function dismissUpdate() {
  const s = useStore.getState().update;
  if (!s) return;
  if (s.stage === "available" || s.stage === "installed") patch({ hidden: true });
  else setUpdate(null);
}
