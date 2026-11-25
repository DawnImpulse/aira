/**
 * Every shortcut the app defines, for the Welcome screen and Settings. Static on purpose: the
 * handlers live in the Rust menu (src-tauri/src/lib.rs) and a few components; nothing is rebindable.
 */
export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘O", label: "Open folder" },
  { keys: "⌘T", label: "New terminal in the active space" },
  { keys: "⇧⌘B", label: "New browser tab" },
  { keys: "⌘W", label: "Close tab" },
  { keys: "⌘B", label: "Toggle Projects panel" },
  { keys: "⌘,", label: "Settings" },
  { keys: "⌥⌘B", label: "Toggle Files/Git panel" },
  { keys: "⌘S", label: "Save file" },
  { keys: "⌘K", label: "Clear terminal" },
  { keys: "⇧⏎", label: "New line in an agent terminal (without submitting)" },
  { keys: "⌘V", label: "Paste text, or attach a clipboard image to a coding agent" },
  { keys: "⌘⏎", label: "Commit" },
  { keys: "Esc", label: "Close dialog / cancel rename" },
];
