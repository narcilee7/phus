// apps/gui/src/renderer/src/App.tsx
// Phase 0 placeholder. Verifies the IPC bridge, Tailwind v4 styling, and the
// React mount. Phase 1 replaces this with the full chat layout.

import { useEffect, useState } from "react";
import type { JSX } from "react";

declare global {
  interface Window {
    /** Surface exposed by apps/gui/src/preload/index.ts via contextBridge. */
    phus: {
      ping: () => Promise<string>;
      on: (channel: string, cb: (payload: unknown) => void) => () => void;
    };
  }
}

export function App(): JSX.Element {
  const [pong, setPong] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.phus
      .ping()
      .then(setPong)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-bg-elevated px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-success" />
          <span className="font-semibold tracking-tight">Phus</span>
          <span className="text-fg-muted text-xs">v0.1.0 · Electron GUI</span>
        </div>
        <span className="text-fg-muted text-xs">Phase 0 scaffold</span>
      </header>

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-border bg-bg-elevated p-6 shadow-lg">
          <h1 className="text-xl font-semibold">Electron scaffold OK</h1>
          <p className="text-fg-muted mt-2 text-sm">
            Renderer mounts, Tailwind v4 compiles, IPC bridge responds.
          </p>
          <div className="mt-4 rounded border border-border bg-bg p-3 font-mono text-xs">
            <div>
              <span className="text-fg-muted">bridge:</span>{" "}
              <span className="text-accent">{pong}</span>
            </div>
            {error ? (
              <div className="text-danger mt-1">error: {error}</div>
            ) : null}
          </div>
          <p className="text-fg-muted mt-4 text-xs">
            Next phases will wire up the agent host, permission modal,
            markdown rendering, and the full chat layout.
          </p>
        </div>
      </main>
    </div>
  );
}
