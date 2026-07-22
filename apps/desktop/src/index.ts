// apps/desktop/src/index.ts
//
// Electron / Tauri main process entry (placeholder). When wired up,
// this becomes the Electron main() / Tauri builder hook that
// creates a BrowserWindow loading the web bundle from apps/web.
//
// For now this is a buildable stub so pnpm tsc -b succeeds.

export const DESKTOP_PLACEHOLDER = "phus-desktop-placeholder";

if (import.meta.url === `file://${process.argv[1]}`) {
	// eslint-disable-next-line no-console
	console.log(DESKTOP_PLACEHOLDER);
}