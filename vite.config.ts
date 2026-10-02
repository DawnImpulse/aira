import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// Dev serves the icons straight from node_modules; builds copy them next to the bundle.
const materialIcons = {
  name: "material-icons",
  apply: "build" as const,
  closeBundle() {
    cpSync("node_modules/vscode-material-icons/generated/icons", "dist/material-icons", { recursive: true });
  },
};

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), materialIcons],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and the website in `docs` (its .html edits would full-reload the app)
      ignored: ["**/src-tauri/**", "**/docs/**"],
    },
  },
  build: { target: "safari16", chunkSizeWarningLimit: 8000 },
}));
