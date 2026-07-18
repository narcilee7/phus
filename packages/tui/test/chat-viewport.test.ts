import { describe, it, expect } from "vitest";
import { ChatViewport } from "@/components/chat/ChatViewport.js";
import type { ChatItem } from "@/state/state.js";

describe("ChatViewport", () => {
  it("renders busy state without hanging when there is one item", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "1", text: "hi", ts: Date.now() },
    ];
    const viewport = new ChatViewport({
      items,
      busy: true,
      scrollOffset: 0,
      hasNew: false,
      lastOp: "thinking…",
      fileSnapshots: new Map(),
    });
    viewport.setHeight(18);
    const start = Date.now();
    const lines = viewport.render(80);
    expect(Date.now() - start).toBeLessThan(100);
    expect(lines.length).toBe(18);
    expect(lines[lines.length - 1]).toContain("thinking…");
  });

  it("renders empty state", () => {
    const viewport = new ChatViewport({
      items: [],
      busy: false,
      scrollOffset: 0,
      hasNew: false,
      lastOp: "idle",
      fileSnapshots: new Map(),
    });
    viewport.setHeight(10);
    const lines = viewport.render(40);
    expect(lines.length).toBe(10);
    expect(lines.some((l) => l.includes("type to start"))).toBe(true);
  });
});
