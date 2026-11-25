import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { notify } from "../store";

let checking = false;
const EVERY = 12 * 60 * 60 * 1000;
const LAST = "updates:lastCheck";

/** Automatic checks: at most one per 12 hours, counted across launches; a manual check doesn't reset the clock. */
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
 * Looks for a newer release (release.yml publishes latest.json next to each DMG) and offers to install
 * it. A manual check also reports "up to date" and failures; the automatic one at launch stays quiet.
 */
export async function checkForUpdates(manual = false) {
  if (checking) return;
  if (import.meta.env.DEV) {
    if (manual) notify("Updates only apply to a built Aira.app, not a dev run.");
    return;
  }
  checking = true;
  try {
    const u = await check();
    if (!u) {
      if (manual) await message("You're on the latest version.", { title: "Aira is up to date" });
      return;
    }
    const notes = u.body?.trim();
    const ok = await ask(`Aira ${u.version} is available (you have ${u.currentVersion}).${notes ? `\n\n${notes}` : ""}\n\nDownload and install it now? Aira restarts when it's done; running terminals stop.`, {
      title: "Update available",
      okLabel: "Update",
      cancelLabel: "Later",
    });
    if (!ok) return;
    await u.downloadAndInstall();
    await relaunch();
  } catch (e) {
    if (manual) notify(`Update check failed: ${e}`);
  } finally {
    checking = false;
  }
}
