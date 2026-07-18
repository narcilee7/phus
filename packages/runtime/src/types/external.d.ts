// packages/runtime/src/types/external.d.ts
// Module shims for cross-workspace dynamic imports that aren't statically
// resolved. The runtime loads @phus/tui dynamically (via
// `await import("@phus/tui")`) so that CLI commands like `phus tui` can
// defer the TUI's heavy imports. We don't need its types at compile time.

declare module "@phus/tui" {
	const startTui: () => Promise<void>;
	export { startTui };
}