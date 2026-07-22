/**
 * @phus/shared — public surface.
 *
 * Common types and utilities. Pure library, no business logic. Used by
 * @phus/core, @phus/runtime, @phus/tui, and any plugin/extension.
 */

// Types
export * from "./types/index.js";

// Protocol shapes (wire format between channels and the agent)
export * from "./protocol/index.js";

// Utilities
export * from "./utils/index.js";