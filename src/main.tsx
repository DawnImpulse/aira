import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "material-symbols/outlined.css";
import "./styles.css";
import App from "./App";
import { boot, notify } from "./store";
import { installTooltips } from "./lib/tooltips";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// localhost:1420 opened in a browser is only the dev server: no filesystem, PTY or git backend.
if (!isTauri()) {
  root.render(
    <div className="welcome">
      <h2>This is the IDE's dev server, not the app</h2>
      <p className="dim">
        Folders, terminals and git only work in the desktop window that <code>bun tauri dev</code> opens (look for "ide" in the Dock).
      </p>
    </div>,
  );
} else {
  // No WebKit "Reload / Inspect Element" menu. Text fields, editor, terminal and selected text keep theirs.
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as Element | null;
    if (t?.closest("input, textarea, .monaco-editor, .xterm")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
  installTooltips();
  boot().catch((e) => notify(`Startup failed: ${e}`));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
