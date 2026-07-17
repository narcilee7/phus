// apps/gui/electron.vite.config.ts
// Three-entry build: main (Node), preload (Electron), renderer (DOM + React 19).
// Main process aliases `@root/*` → ../../src so it can import the existing
// Phus runtime (PhusAgent, loadConfig, logger, safety, …) without copying.
//
// Renderer uses Tailwind v4 (CSS-first config — see src/renderer/src/styles.css).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootSrc = resolve(__dirname, "../../src");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/main"),
        "@shared": resolve(__dirname, "src/shared"),
        // The Phus runtime lives in ../../src at the repo root. Main-process
        // modules import it through this alias.
        "@root/*": rootSrc + "/*",
      },
    },
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});