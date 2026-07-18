// packages/runtime/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(projectRoot, "src");

export default defineConfig({
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
		alias: [
			// `@/foo/bar` (no ext) — vite will append `.ts` via extensions.
			{
				find: /^@\/(.*)$/,
				replacement: `${srcRoot}/$1`,
			},
			// Strip trailing `.js` from any relative import so vite can
			// resolve `.ts` instead.
			{
				find: /^([^@].*)\.js$/,
				replacement: "$1",
			},
		],
	},
	test: {
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		environment: "node",
		globals: false,
		testTimeout: 10_000,
	},
});