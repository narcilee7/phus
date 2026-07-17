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

/** Vite/Rollup's `alias` option does not understand the `prefix/*` glob form
 *  that tsconfig `paths` uses. We register the same prefixes as regex matchers
 *  so `@root/foo` resolves to `<repo>/src/foo`. */
function makeRootAlias(): { find: RegExp; replacement: string } {
  return { find: /^@root\/(.*)$/, replacement: `${rootSrc}/$1` };
}
function makeAtAlias(abs: string): { find: RegExp; replacement: string } {
  return { find: /^@\/(.*)$/, replacement: `${abs}/$1` };
}
function makeSharedAlias(): { find: RegExp; replacement: string } {
  return { find: /^@shared\/(.*)$/, replacement: `${resolve(__dirname, "src/shared")}/$1` };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: [
        // Note: GUI main/preload code uses `@root/*` for the Phus runtime
        // and relative paths for its own files, so no `@/` alias is needed
        // for the GUI tree. But the Phus runtime itself (../../src/**)
        // uses `@/...` per its tsconfig, so we register that here pointing
        // at the repo root's src/ to keep the alias chain working.
        makeAtAlias(rootSrc),
        makeSharedAlias(),
        makeRootAlias(),
      ],
    },
    build: {
      outDir: "out/main",
      // Main runs under Node, so all node_modules deps should be required
      // at runtime — never bundled. This also dodges rollup chasing
      // transitive optional peer deps (e.g. @opentelemetry/api pulled in
      // by @mistralai/mistralai even when the user is on Anthropic).
      rollupOptions: {
        external: [/node_modules/],
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: [makeSharedAlias()],
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
      alias: [
        makeAtAlias(resolve(__dirname, "src/renderer/src")),
        makeSharedAlias(),
      ],
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