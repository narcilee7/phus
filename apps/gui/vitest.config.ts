// apps/gui/vitest.config.ts
// Renderer-friendly test runner. Phase 0 only has the IPC channel-name
// contract test — later phases will add reducer + schema tests.

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
  },
});