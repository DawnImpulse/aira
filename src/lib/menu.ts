import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify, openBrowserTab } from "../store";

/** Strings are native items: a separator, or an edit action sent to the focused field (`copy:` etc.). */
export type MenuEntry = { text: string; action: () => void; enabled?: boolean } | "-" | "Cut" | "Copy" | "Paste" | "SelectAll";

let current: Menu | null = null;

/**
 * Native macOS context menu at the cursor. Ids are prefixed `ctx:` so the Rust app-menu
 * handler ignores them (actions run here, in the closures). The previous menu is closed
 * first so native resources don't pile up.
 */
export async function popupMenu(entries: MenuEntry[]) {
  try {
    await current?.close().catch(() => {});
    const items = await Promise.all(
      entries.map((e, i) =>
        typeof e === "string"
          ? PredefinedMenuItem.new({ item: e === "-" ? "Separator" : e })
          : MenuItem.new({ id: `ctx:${i}`, text: e.text, enabled: e.enabled ?? true, action: e.action }),
      ),
    );
    current = await Menu.new({ items });
    await current.popup();
  } catch (e) {
    notify(`Menu failed: ${e}`);
  }
}

/** A link clicked inside the app (terminal, markdown preview): the user picks the embedded or the system browser. */
export function openLink(url: string) {
  return popupMenu([
    { text: "Open in Aira Browser", action: () => openBrowserTab(url) },
    { text: "Open in System Browser", action: () => void openUrl(url).catch(() => {}) },
  ]);
}
