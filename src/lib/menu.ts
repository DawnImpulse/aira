import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { notify } from "../store";

export type MenuEntry = { text: string; action: () => void; enabled?: boolean } | "-";

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
        e === "-"
          ? PredefinedMenuItem.new({ item: "Separator" })
          : MenuItem.new({ id: `ctx:${i}`, text: e.text, enabled: e.enabled ?? true, action: e.action }),
      ),
    );
    current = await Menu.new({ items });
    await current.popup();
  } catch (e) {
    notify(`Menu failed: ${e}`);
  }
}
