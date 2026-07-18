// packages/tui/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(projectRoot, "src");
const repoRoot = resolve(projectRoot, "../..");

export default defineConfig({
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
		alias: [
			// `@/foo/bar` → srcRoot/foo/bar.ts
			{
				find: /^@\/(.*)$/,
				replacement: `${srcRoot}/$1`,
			},
			// Explicit aliases for workspace deps that vitest's strict
			// pnpm symlink resolution sometimes misses when the importing
			// file lives in `packages/<x>/src/...`.
			{ find: /^fuse\.js$/, replacement: `${repoRoot}/node_modules/.pnpm/fuse.js@7.5.0/node_modules/fuse.js/dist/fuse.mjs` },
			{
				find: /^ink-testing-library$/,
				replacement: `${repoRoot}/node_modules/.pnpm/ink-testing-library@4.0.0_@types+react@19.2.17/node_modules/ink-testing-library/build/index.js`,
			},
			// Strip trailing `.js` from any relative import so vite can
			// resolve `.ts` instead.
			{
				find: /^([^@].*)\.js$/,
				replacement: "$1",
			},
		],
	},
	optimizeDeps: {
		exclude: ["fuse.js", "react", "react-dom"],
	},
	test: {
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		environment: "node",
		globals: false,
		testTimeout: 10_000,
	},
});