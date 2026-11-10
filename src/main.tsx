import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "material-symbols/outlined.css";
import "./styles.css";
import App from "./App";
import { boot, notify } from "./store";
import { installTooltips } from "./lib/tooltips";
import { popupMenu } from "./lib/menu";
import { BrowserPopout } from "./components/BrowserView";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// localhost:1420 opened in a browser is only the dev server: no filesystem, PTY or git backend.
if (!isTauri()) {
  root.render(
    <div className="welcome">
      <h2>This is Aira's dev server, not the app</h2>
      <p className="dim">
        Folders, terminals and git only work in the desktop window that <code>bun tauri dev</code> opens (look for "ide" in the Dock).
      </p>
    </div>,
  );
} else {
  // Never WebKit's "Reload / Inspect Element" menu. Monaco and xterm pop their own; text fields get
  // native edit items; anywhere else offers Copy for whatever is selected.
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as Element | null;
    if (t?.closest(".monaco-editor, .xterm")) return;
    e.preventDefault();
    popupMenu(t?.closest("input, textarea") ? ["Cut", "Copy", "Paste", "-", "SelectAll"] : ["Copy"]);
  });
  installTooltips();
  const q = new URLSearchParams(location.search);
  const popout = q.get("popout");
  if (popout) {
    // A browser tab's pop-out window: just its toolbar over the moved webview, no app state.
    document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
    root.render(
      <BrowserPopout
        id={popout}
        url={q.get("url") ?? "about:blank"}
        zoom={Number(q.get("zoom")) || 1}
        devices={(q.get("devices") ?? "").split(",").filter(Boolean)}
        sync={q.get("sync") === "1"}
      />,
    );
  } else {
    boot().catch((e) => notify(`Startup failed: ${e}`));
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}
