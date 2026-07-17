// apps/gui/src/renderer/src/ipc/types.ts
// Re-export the preload API shape + global window typing. Renderer code
// imports `phus` from here so we never sprinkle `declare global` across
// feature components.

import type { PhusPreloadApi } from "../../../preload/index.js";

declare global {
  interface Window {
    phus: PhusPreloadApi;
  }
}

export type Phus = PhusPreloadApi;

/** The single typed entry point. Use this instead of touching window.phus
 *  directly so test code can stub it. */
export const phus: Phus = window.phus;