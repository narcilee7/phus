// packages/tui/tsdown.config.ts
// Bundle @phus/tui's entry point into a single ESM file consumers can
// import without resolving workspace paths at runtime.
//
// Externalized: workspace deps (@phus/runtime) + heavy node built-ins.
// Everything else (ink, react, fuse.js, vendored pi-tui) is bundled.

import { defineConfig } from "tsdown";
import pkg from "./package.json" with { type: "json" };

const externals = [
	...Object.keys(pkg.dependencies ?? {}),
	/^node:/,
];

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node20",
	clean: true,
	// rolldown-plugin-dts does not yet support TS 7's host API; types are
	// emitted separately by `tsc --emitDeclarationOnly` via `build:types`.
	dts: false,
	external: externals,
	sourcemap: true,
});