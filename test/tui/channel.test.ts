// test/tui/channel.test.ts
// Verify the TUI channel adapter dispatches the right action sequence.

import { describe, expect, it, vi } from "vitest";
import { tuiChannel } from "../../src/tui/channel.js";
import type { AppAction } from "../../src/tui/state.js";

describe("tuiChannel", () => {
  it("has name 'tui'", () => {
    const ch = tuiChannel(() => {});
    expect(ch.name).toBe("tui");
  });

  it("listen() is a no-op (no event subscription via channel)", () => {
    const ch = tuiChannel(() => {});
    expect(() => ch.listen()).not.toThrow();
  });

  it("send(text, content) → finalize_streaming + append_delta + finalize_streaming", async () => {
    const dispatched: AppAction[] = [];
    const ch = tuiChannel((a) => dispatched.push(a));
    await ch.send([{ type: "text", content: "hello", to: "u", channel: "tui" } as any]);

    expect(dispatched).toEqual([
      { type: "finalize_streaming" },
      { type: "append_delta", delta: "hello" },
      { type: "finalize_streaming" },
    ]);
  });

  it("skips non-text outbounds", async () => {
    const dispatched: AppAction[] = [];
    const ch = tuiChannel((a) => dispatched.push(a));
    await ch.send([
      { type: "image", to: "u", channel: "tui" } as any,
      { type: "reaction", to: "u", channel: "tui" } as any,
    ]);
    expect(dispatched).toEqual([]);
  });

  it("handles mixed text and non-text outbounds", async () => {
    const dispatched: AppAction[] = [];
    const ch = tuiChannel((a) => dispatched.push(a));
    await ch.send([
      { type: "text", content: "A", to: "u", channel: "tui" } as any,
      { type: "image", data: "...", mimeType: "image/png" } as any,
      { type: "text", content: "B", to: "u", channel: "tui" } as any,
    ]);

    expect(dispatched).toEqual([
      { type: "finalize_streaming" }, { type: "append_delta", delta: "A" }, { type: "finalize_streaming" },
      { type: "finalize_streaming" }, { type: "append_delta", delta: "B" }, { type: "finalize_streaming" },
    ]);
  });

  it("skips text outbounds with empty content", async () => {
    const dispatched: AppAction[] = [];
    const ch = tuiChannel((a) => dispatched.push(a));
    await ch.send([{ type: "text", content: "", to: "u", channel: "tui" } as any]);
    // Empty content fails the `o.content` truthiness check — no actions dispatched.
    expect(dispatched).toEqual([]);
  });

  it("calls dispatch exactly 3N times for N text outbounds", async () => {
    const spy = vi.fn();
    const ch = tuiChannel(spy);
    await ch.send([
      { type: "text", content: "x", to: "u", channel: "tui" } as any,
      { type: "text", content: "y", to: "u", channel: "tui" } as any,
      { type: "text", content: "z", to: "u", channel: "tui" } as any,
    ]);
    expect(spy).toHaveBeenCalledTimes(9);
  });
});