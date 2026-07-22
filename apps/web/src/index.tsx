// apps/web/src/index.tsx
//
// Browser host entry point (placeholder). Phase 7 only ships the
// skeleton — future work will wire:
//   1. React 19 root via createRoot
//   2. ThemeProvider + useTheme() from @phus/phus-design
//   3. PhusAgent facade from @phus/runtime (browser-bound via fetch
//      to a backend, or running fully client-side via WebLLM)
//
// For now this is a buildable stub so `pnpm tsc -b` succeeds and
// downstream tools can rely on the package existing.

import * as React from "react";

/**
 * Placeholder React 19 component. Replace with the real app shell
 * (router + theme provider + agent panel) once the web host is
 * properly designed.
 */
export const App: React.FC = () => {
	return React.createElement(
		"main",
		{ className: "phus-web-placeholder" },
		React.createElement(
			"h1",
			null,
			"⛵️  Phus web — placeholder",
		),
		React.createElement(
			"p",
			null,
			"apps/web ships a buildable shell. Real UI lands in Phase 8+.",
		),
	);
};

export default App;