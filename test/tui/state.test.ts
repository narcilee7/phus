// test/tui/state.test.ts
// Pure-function tests for `appReducer` and `truncate`.

import { describe, expect, it, vi } from "vitest";
import { appReducer, initialState, truncate, type AppAction, type AppState } from "../../src/tui/state.js";

function action(a: AppAction) {
  return appReducer(initialState, a);
}

describe("initialState", () => {
  it("starts empty", () => {
    expect(initialState.items).toEqual([]);
    expect(initialState.busy).toBe(false);
    expect(initialState.showHint).toBe(true);
    expect(initialState.lastOp).toBe("idle");
    expect(initialState.scroll).toEqual({ offset: 0, hasNew: false });
    expect(initialState.permissionQueue).toEqual([]);
    expect(initialState.allowedTools.size).toBe(0);
  });
});

describe("append_delta", () => {
  it("ignores empty delta", () => {
    const state = appReducer(initialState, { type: "append_delta", delta: "" });
    expect(state.items).toEqual([]);
  });

  it("starts a new streaming assistant when no prior assistant exists", () => {
    const state = action({ type: "append_delta", delta: "Hello" });
    expect(state.items).toHaveLength(1);
    const item = state.items[0]!;
    expect(item.kind).toBe("assistant");
    expect(item.text).toBe("Hello");
    expect(item.isStreaming).toBe(true);
  });

  it("appends to an existing streaming assistant", () => {
    const s1 = action({ type: "append_delta", delta: "foo" });
    const s2 = appReducer(s1, { type: "append_delta", delta: "bar" });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0]!.text).toBe("foobar");
    expect(s2.items[0]!.isStreaming).toBe(true);
  });

  it("does not append when the last item is not an assistant", () => {
    const s1 = action({ type: "add_system", text: "warning", level: "warn" });
    const s2 = appReducer(s1, { type: "append_delta", delta: "more" });
    // New streaming assistant appended after the system item
    expect(s2.items).toHaveLength(2);
    expect(s2.items[0]!.kind).toBe("system");
    expect(s2.items[1]!.kind).toBe("assistant");
  });
});

describe("append_thinking", () => {
  it("starts a new streaming assistant with reasoning", () => {
    const state = action({ type: "append_thinking", delta: "hmm" });
    expect(state.items).toHaveLength(1);
    const item = state.items[0]!;
    expect(item.kind).toBe("assistant");
    expect(item.reasoning).toBe("hmm");
    expect(item.isStreaming).toBe(true);
  });

  it("appends reasoning to an existing streaming assistant", () => {
    const s1 = action({ type: "append_thinking", delta: "hmm" });
    const s2 = appReducer(s1, { type: "append_thinking", delta: " ok" });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0]!.reasoning).toBe("hmm ok");
  });
});

describe("upsert_tool_call", () => {
  it("inserts a new tool_call item", () => {
    const state = action({
      type: "upsert_tool_call",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.kind).toBe("tool_call");
    expect(state.items[0]!.toolCallId).toBe("tc-1");
    expect(state.items[0]!.toolName).toBe("bash");
  });

  it("updates an existing tool_call by toolCallId", () => {
    const s1 = action({ type: "upsert_tool_call", toolCallId: "tc-1", toolName: "bash", args: {} });
    const s2 = appReducer(s1, {
      type: "upsert_tool_call",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { extra: "data" },
    });
    // Same id merged, items length unchanged
    expect(s2.items).toHaveLength(1);
    expect((s2.items[0]!.args as any).extra).toBe("data");
  });
});

describe("complete_tool_call", () => {
  it("updates the matching tool_call with result, error and duration", () => {
    const s1 = action({ type: "upsert_tool_call", toolCallId: "tc-1", toolName: "bash", args: {} });
    const s2 = appReducer(s1, { type: "complete_tool_call", toolCallId: "tc-1", result: "ok", isError: false });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0]!.kind).toBe("tool_call");
    expect((s2.items[0]!.result as any)).toBe("ok");
    expect(s2.items[0]!.isError).toBe(false);
    expect(s2.items[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("no-ops when no matching tool_call exists", () => {
    const s1 = action({ type: "add_user", text: "hi" });
    const s2 = appReducer(s1, { type: "complete_tool_call", toolCallId: "missing", result: null, isError: false });
    expect(s2.items).toEqual(s1.items);
  });

  it("marks the original call as errored on failure", () => {
    const s1 = action({ type: "upsert_tool_call", toolCallId: "tc-1", toolName: "bash", args: {} });
    const s2 = appReducer(s1, { type: "complete_tool_call", toolCallId: "tc-1", result: "boom", isError: true });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0]!.isError).toBe(true);
    expect((s2.items[0]!.result as any)).toBe("boom");
  });
});

describe("finalize_streaming", () => {
  it("clears the isStreaming flag on the last assistant", () => {
    const s1 = action({ type: "append_delta", delta: "hello" });
    const s2 = appReducer(s1, { type: "finalize_streaming" });
    expect(s2.items[0]!.isStreaming).toBe(false);
  });

  it("is a no-op when no streaming assistant exists", () => {
    const s1 = action({ type: "add_user", text: "hi" });
    const s2 = appReducer(s1, { type: "finalize_streaming" });
    expect(s2.items).toEqual(s1.items);
  });
});

describe("set_assistant_metadata", () => {
  it("attaches model and usage to the last assistant message", () => {
    const s1 = action({ type: "append_delta", delta: "hello" });
    const s2 = appReducer(s1, {
      type: "set_assistant_metadata",
      model: "claude-sonnet-4",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.0012 },
    });
    const last = s2.items[s2.items.length - 1]!;
    expect(last.kind).toBe("assistant");
    expect(last.model).toBe("claude-sonnet-4");
    expect(last.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.0012 });
  });

  it("is a no-op when there is no assistant message", () => {
    const s1 = action({ type: "add_user", text: "hi" });
    const s2 = appReducer(s1, {
      type: "set_assistant_metadata",
      model: "gpt-4o",
      usage: { totalTokens: 100 },
    });
    expect(s2.items).toEqual(s1.items);
  });
});

describe("add_user / add_system / clear_items", () => {
  it("add_user appends a user item", () => {
    const s1 = action({ type: "add_user", text: "hello" });
    expect(s1.items[0]!.kind).toBe("user");
    expect(s1.items[0]!.text).toBe("hello");
  });

  it("add_system appends a system item with the given level", () => {
    const s1 = action({ type: "add_system", text: "danger", level: "error" });
    expect(s1.items[0]!.level).toBe("error");
    expect(s1.items[0]!.kind).toBe("system");
  });

  it("clear_items empties the array", () => {
    const s1 = appReducer(initialState, { type: "add_user", text: "a" });
    const s2 = appReducer(s1, { type: "add_user", text: "b" });
    expect(s2.items).toHaveLength(2);
    const s3 = appReducer(s2, { type: "clear_items" });
    expect(s3.items).toEqual([]);
  });
});

describe("set_busy / set_last_op / hide_hint", () => {
  it("set_busy toggles busy", () => {
    expect(appReducer(initialState, { type: "set_busy", busy: true }).busy).toBe(true);
    expect(appReducer({ ...initialState, busy: true }, { type: "set_busy", busy: false }).busy).toBe(false);
  });

  it("set_last_op updates the label", () => {
    expect(appReducer(initialState, { type: "set_last_op", op: "tool: bash" }).lastOp).toBe("tool: bash");
  });

  it("hide_hint flips the flag to false", () => {
    expect(initialState.showHint).toBe(true);
    expect(appReducer(initialState, { type: "hide_hint" }).showHint).toBe(false);
  });
});

describe("scroll", () => {
  it("scroll_up increases offset", () => {
    const s = appReducer(initialState, { type: "scroll_up" });
    expect(s.scroll.offset).toBe(1);
  });

  it("scroll_up accepts a line count", () => {
    const s = appReducer(initialState, { type: "scroll_up", lines: 5 });
    expect(s.scroll.offset).toBe(5);
  });

  it("scroll_down decreases offset but not below zero", () => {
    const s1 = appReducer(initialState, { type: "scroll_up", lines: 3 });
    const s2 = appReducer(s1, { type: "scroll_down", lines: 2 });
    expect(s2.scroll.offset).toBe(1);
    const s3 = appReducer(s2, { type: "scroll_down", lines: 5 });
    expect(s3.scroll.offset).toBe(0);
  });

  it("scroll_bottom resets offset and hasNew", () => {
    const s1 = appReducer(initialState, { type: "scroll_up", lines: 3 });
    const s2 = appReducer(s1, { type: "scroll_bottom" });
    expect(s2.scroll).toEqual({ offset: 0, hasNew: false });
  });

  it("marks hasNew when content arrives while scrolled up", () => {
    const s1 = appReducer(initialState, { type: "scroll_up", lines: 3 });
    const s2 = appReducer(s1, { type: "add_user", text: "hello" });
    expect(s2.scroll.hasNew).toBe(true);
    expect(s2.scroll.offset).toBe(3);
  });

  it("does not mark hasNew when content arrives at bottom", () => {
    const s1 = appReducer(initialState, { type: "add_user", text: "hello" });
    expect(s1.scroll.hasNew).toBe(false);
  });

  it("clear_items resets scroll", () => {
    const s1 = appReducer(initialState, { type: "scroll_up", lines: 3 });
    const s2 = appReducer(s1, { type: "clear_items" });
    expect(s2.scroll).toEqual({ offset: 0, hasNew: false });
  });
});

describe("permission queue", () => {
  it("push_permission appends a request", () => {
    const resolve = vi.fn();
    const s = appReducer(initialState, {
      type: "push_permission",
      request: { id: "p1", toolName: "bash", args: { command: "ls" }, toolCallId: "tc-1", resolve },
    });
    expect(s.permissionQueue).toHaveLength(1);
    expect(s.permissionQueue[0]!.toolName).toBe("bash");
  });

  it("resolve_permission resolves the first request and removes it", () => {
    const resolve = vi.fn();
    const s1 = appReducer(initialState, {
      type: "push_permission",
      request: { id: "p1", toolName: "bash", args: {}, toolCallId: "tc-1", resolve },
    });
    const s2 = appReducer(s1, { type: "resolve_permission", allow: true });
    expect(resolve).toHaveBeenCalledWith(true);
    expect(s2.permissionQueue).toHaveLength(0);
  });

  it("resolve_permission with remember='always' adds the tool to allowedTools", () => {
    const resolve = vi.fn();
    const s1 = appReducer(initialState, {
      type: "push_permission",
      request: { id: "p1", toolName: "bash", args: {}, toolCallId: "tc-1", resolve },
    });
    const s2 = appReducer(s1, { type: "resolve_permission", allow: true, remember: "always" });
    expect(s2.allowedTools.has("bash")).toBe(true);
    expect(s2.sessionAllowedTools.has("bash")).toBe(false);
  });

  it("resolve_permission with remember='session' adds the tool to sessionAllowedTools", () => {
    const resolve = vi.fn();
    const s1 = appReducer(initialState, {
      type: "push_permission",
      request: { id: "p1", toolName: "bash", args: {}, toolCallId: "tc-1", resolve },
    });
    const s2 = appReducer(s1, { type: "resolve_permission", allow: true, remember: "session" });
    expect(s2.allowedTools.has("bash")).toBe(false);
    expect(s2.sessionAllowedTools.has("bash")).toBe(true);
  });

  it("resolve_permission with deny does not add to allowedTools", () => {
    const resolve = vi.fn();
    const s1 = appReducer(initialState, {
      type: "push_permission",
      request: { id: "p1", toolName: "bash", args: {}, toolCallId: "tc-1", resolve },
    });
    const s2 = appReducer(s1, { type: "resolve_permission", allow: false });
    expect(resolve).toHaveBeenCalledWith(false);
    expect(s2.allowedTools.has("bash")).toBe(false);
    expect(s2.sessionAllowedTools.has("bash")).toBe(false);
  });

  it("clear_session_allowed_tools only clears session memory", () => {
    const state: AppState = {
      ...initialState,
      allowedTools: new Set(["always-tool"]),
      sessionAllowedTools: new Set(["session-tool"]),
    };
    const s = appReducer(state, { type: "clear_session_allowed_tools" });
    expect(s.allowedTools.has("always-tool")).toBe(true);
    expect(s.sessionAllowedTools.has("session-tool")).toBe(false);
  });
});

describe("plan state", () => {
  it("set_plan stores the active plan", () => {
    const plan = {
      id: "p1",
      goal: "refactor auth",
      status: "running" as const,
      steps: [{ id: "s1", description: "step 1", status: "running" as const }],
      currentStepId: "s1",
      subagents: [],
    };
    const s = appReducer(initialState, { type: "set_plan", plan });
    expect(s.plan).toEqual(plan);
  });

  it("update_plan_step updates step status and currentStepId when running", () => {
    const plan = {
      id: "p1",
      goal: "refactor auth",
      status: "running" as const,
      steps: [
        { id: "s1", description: "step 1", status: "running" as const },
        { id: "s2", description: "step 2", status: "pending" as const },
      ],
      currentStepId: "s1",
      subagents: [],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, { type: "update_plan_step", stepId: "s1", status: "completed" });
    expect(s2.plan?.steps[0]?.status).toBe("completed");
    expect(s2.plan?.steps[1]?.status).toBe("pending");
    const s3 = appReducer(s2, { type: "update_plan_step", stepId: "s2", status: "running" });
    expect(s3.plan?.steps[1]?.status).toBe("running");
    expect(s3.plan?.currentStepId).toBe("s2");
  });

  it("update_plan_step is a no-op when no plan exists", () => {
    const s = appReducer(initialState, { type: "update_plan_step", stepId: "s1", status: "completed" });
    expect(s.plan).toBeUndefined();
  });

  it("clear_plan removes the active plan", () => {
    const plan = {
      id: "p1",
      goal: "refactor auth",
      status: "completed" as const,
      steps: [{ id: "s1", description: "step 1", status: "completed" as const }],
      subagents: [],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, { type: "clear_plan" });
    expect(s2.plan).toBeUndefined();
  });

  it("set_plan_step_output attaches output to a step", () => {
    const plan = {
      id: "p1",
      goal: "g",
      status: "running" as const,
      steps: [{ id: "s1", description: "step 1", status: "running" as const }],
      subagents: [],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, {
      type: "set_plan_step_output",
      stepId: "s1",
      output: "scanning src/",
    });
    expect(s2.plan?.steps[0]?.output).toBe("scanning src/");
  });

  it("set_plan_status flips the plan lifecycle status", () => {
    const plan = {
      id: "p1",
      goal: "g",
      status: "running" as const,
      steps: [],
      subagents: [],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, { type: "set_plan_status", status: "paused" });
    expect(s2.plan?.status).toBe("paused");
  });

  it("upsert_plan_subagent adds and merges a subagent", () => {
    const plan = {
      id: "p1",
      goal: "g",
      status: "running" as const,
      steps: [],
      subagents: [],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, {
      type: "upsert_plan_subagent",
      subagent: { sessionId: "s1", label: "explore", goal: "scan", status: "running" },
    });
    expect(s2.plan?.subagents).toHaveLength(1);
    const s3 = appReducer(s2, {
      type: "upsert_plan_subagent",
      subagent: { sessionId: "s1", label: "explore", goal: "scan", status: "completed" },
    });
    expect(s3.plan?.subagents).toHaveLength(1);
    expect(s3.plan?.subagents[0]?.status).toBe("completed");
  });

  it("remove_plan_subagent drops the matching subagent", () => {
    const plan = {
      id: "p1",
      goal: "g",
      status: "running" as const,
      steps: [],
      subagents: [
        { sessionId: "s1", label: "a", goal: "g", status: "completed" },
        { sessionId: "s2", label: "b", goal: "g", status: "running" },
      ],
    };
    const s1 = appReducer(initialState, { type: "set_plan", plan });
    const s2 = appReducer(s1, { type: "remove_plan_subagent", sessionId: "s1" });
    expect(s2.plan?.subagents).toHaveLength(1);
    expect(s2.plan?.subagents[0]?.sessionId).toBe("s2");
  });
});

describe("sidebar request", () => {
  it("request_sidebar stores the request", () => {
    const s = appReducer(initialState, { type: "request_sidebar", view: "sessions" });
    expect(s.sidebarRequest).toBe("sessions");
  });

  it("consume_sidebar_request clears the stored request", () => {
    const s1 = appReducer(initialState, { type: "request_sidebar", view: "files" });
    const s2 = appReducer(s1, { type: "consume_sidebar_request" });
    expect(s2.sidebarRequest).toBeUndefined();
  });

  it("consume_sidebar_request is a no-op when nothing was requested", () => {
    const s = appReducer(initialState, { type: "consume_sidebar_request" });
    expect(s).toEqual(initialState);
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("appends ellipsis when over the limit", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde…");
  });

  it("handles exact-length strings", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});