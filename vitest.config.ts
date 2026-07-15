import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Project root for resolving the `@/` alias at test-time.
// Vitest does not honor `tsconfig.json#paths` automatically; we mirror
// the mapping here so source imports like `@/core/foo.js` resolve to
// `src/core/foo.ts` during test execution.
const projectRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(projectRoot, "src");

export default defineConfig({
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10_000,
    // Keep coverage off by default; enable with `pnpm test:cov`.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/__tests__/**",
        "src/types/**",
      ],
    },
  },
});