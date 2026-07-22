/**
 * @phus/phus-design — public surface.
 *
 * shadcn-style component library on top of Radix UI + Tailwind.
 * Business-agnostic — usable across apps/web, apps/mobile, apps/desktop.
 *
 * Setup (consumer side):
 *   1. Install Tailwind v3 + add this package as a workspace dep.
 *   2. Copy tailwind.config.mjs (or extend it) and globals.css.
 *   3. Import components from "@/components/ui/..." (matches the
 *      components.json aliases) or "@phus/phus-design" directly.
 *
 * Theme toggle is exposed via `useTheme()` from @/hooks.
 */

// UI primitives (shadcn-style)
export * from "./components/ui/index.js";

// Theme controller hook
export * from "./hooks/index.js";

// Utility helpers (cn, etc.)
export * from "./lib/utils.js";