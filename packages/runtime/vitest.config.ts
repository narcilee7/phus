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
			// Strip trailing `.js` from any relative import so vite can
			// resolve `.ts` instead. Cross-package imports of the form
			// `@phus/runtime/...` are handled by vitest's normal module
			// resolution through the workspace symlink.
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