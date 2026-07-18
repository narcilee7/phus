// packages/runtime/tsdown.config.ts
// Reserved for future bundling. The runtime emits JS via plain `tsc`
// (see the `build` script in package.json) because @phus/tui imports
// specific subpaths (`@phus/runtime/infra/config/index.js`) and we need
// dist/ to preserve the source tree shape. tsdown's default code-split
// mode renames modules with content hashes, breaking those subpath
// imports.
//
// The `phus` CLI binary that ships to end users is built separately via
// the same `tsc` step; the shebang is prepended via a tiny post-build
// step in scripts/build-cli-shebang.ts if needed.

import { defineConfig } from "tsdown";

export default defineConfig({});