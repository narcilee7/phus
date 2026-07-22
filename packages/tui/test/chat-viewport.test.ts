import { describe, it, expect } from "vitest";
import { ChatViewport } from "../src/components/chat/ChatViewport.js";
import { TodoPill } from "../src/components/todo/TodoPill.js";
import { SisyphusAnimator, STONE_FRAMES } from "../src/runtime/sisyphus.js";
import type { ChatItem } from "../src/state/state.js";

const deps = (items: ChatItem[]) => ({
  items,
  scrollOffset: 0,
  hasNew: false,
  fileSnapshots: new Map(),
});

describe("ChatViewport", () => {
  it("renders one item padded to full height (no busy row — busy lives in TodoPill)", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "1", text: "hi", ts: Date.now() },
    ];
    const viewport = new ChatViewport(deps(items));
    viewport.setHeight(18);
    const start = Date.now();
    const lines = viewport.render(80);
    expect(Date.now() - start).toBeLessThan(100);
    expect(lines.length).toBe(18);
    expect(lines[0]).toContain("hi");
    expect(lines[lines.length - 1].trim()).toBe("");
  });

  it("renders empty state with the Sisyphus vignette", () => {
    const viewport = new ChatViewport(deps([]));
    viewport.setHeight(10);
    const lines = viewport.render(40);
    expect(lines.length).toBe(10);
    expect(lines.some((l) => l.includes("type to start"))).toBe(true);
    expect(lines.some((l) => l.includes("Push the stone"))).toBe(true);
    expect(lines.some((l) => l.includes("●"))).toBe(true);
  });
});

describe("TodoPill (RollingLine)", () => {
  const user = (text: string): ChatItem => ({ kind: "user", id: "1", text, ts: Date.now() });

  it("idle renders zero rows (frame budget stays exact)", () => {
    const pill = new TodoPill([user("hi")], false, new SisyphusAnimator());
    expect(pill.render(80)).toEqual([]);
  });

  it("busy shows the stone frame plus a push verb", () => {
    const pill = new TodoPill([user("hi")], true, new SisyphusAnimator());
    const lines = pill.render(80);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(STONE_FRAMES[0]!.trim());
    expect(lines[0]).toContain("the stone");
  });

  it("busy with a running tool shows the stone frame plus the tool pill", () => {
    const tool: ChatItem = {
      kind: "tool_call",
      id: "t1",
      toolName: "bash",
      ts: Date.now(),
    } as ChatItem;
    const pill = new TodoPill([tool], true, new SisyphusAnimator());
    const lines = pill.render(80);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("bash");
  });
});
