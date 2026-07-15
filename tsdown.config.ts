// tsdown.config.ts
// Bundle src/phus.ts into a single ESM file using Rolldown.
// Output:
//   dist/phus.js        - executable entry (has shebang)
//   dist/phus.d.ts      - public type declarations
//
// Externalized: every runtime dependency + node:* built-ins.
// This keeps the bundle small and respects "type": "module".

import { defineConfig } from "tsdown";

// Dependencies that must NOT be bundled (resolved at runtime via node_modules).
// `dependencies` from package.json + node built-ins.
import pkg from "./package.json" with { type: "json" };

const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  /^node:/,
];

export default defineConfig({
  entry: ["src/phus.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  // rolldown-plugin-dts (bundled with tsdown 0.19) does not yet support
  // TypeScript 7's host API (useCaseSensitiveFileNames moved). Declarations
  // are emitted separately by `tsc --emitDeclarationOnly` via `build:types`.
  dts: false,
  sourcemap: true,
  shims: false,
  treeshake: true,
  external: externals,
  // Keep shebang on the bin so `pnpm exec phus` works after install.
  banner: (chunk) => {
    if (chunk.fileName === "phus.js") return "#!/usr/bin/env node";
    return "";
  },
});