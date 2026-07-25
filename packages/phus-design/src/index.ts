/**
 * @phus/phus-design — public surface.
 *
 * shadcn-style component library on top of Radix UI + Tailwind.
 * Business-agnostic primitives plus AI-specific components for Phus.
 */

// UI primitives (shadcn-style)
export * from "./components/ui/index.js";

// AI-specific components (Markdown, streaming, tool cards, chat, …)
export * from "./components/ai/index.js";

// Theme controller hook
export * from "./hooks/index.js";

// Utility helpers (cn, etc.)
export * from "./lib/utils.js";
