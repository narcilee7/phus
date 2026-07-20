// packages/runtime/src/types/external.d.ts
// Module shims for cross-workspace dynamic imports that aren't statically
// resolved. `@phus/tui` is loaded dynamically (via `await import("@phus/tui")`)
// so the TUI's heavy modules only load when actually invoked. We don't need
// its types at compile time.

declare module "@phus/tui" {
	const startTui: () => Promise<void>;
	export { startTui };
}