// test/tui/events.test.ts
// Verify the Pi Agent event → AppAction mapping.

import { describe, expect, it } from "vitest";
import { eventToAction } from "../src/transform/events.js";

describe("eventToAction", () => {
  it("maps message_update + text_delta → append_delta", () => {
    const a = eventToAction({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    });
    expect(a).toEqual({ type: "append_delta", delta: "hi" });
  });

  it("maps message_update + thinking_delta → append_thinking", () => {
    const a = eventToAction({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });
    expect(a).toEqual({ type: "append_thinking", delta: "hmm" });
  });

  it("ignores message_update with no assistantMessageEvent", () => {
    expect(eventToAction({ type: "message_update" })).toBeNull();
  });

  it("maps tool_execution_start → upsert_tool_call", () => {
    const a = eventToAction({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "tc-1",
      args: { cmd: "ls" },
    });
    expect(a).toEqual({
      type: "upsert_tool_call",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    });
  });

  it("maps tool_execution_end → complete_tool_call", () => {
    const a = eventToAction({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      result: { stdout: "..." },
      isError: false,
    });
    expect(a).toEqual({
      type: "complete_tool_call",
      toolCallId: "tc-1",
      result: { stdout: "..." },
      isError: false,
    });
  });

  it("maps agent_end → finalize_streaming", () => {
    expect(eventToAction({ type: "agent_end" })).toEqual({ type: "finalize_streaming" });
  });

  it("maps turn_end with errorMessage → add_system 'error: …'", () => {
    const a = eventToAction({
      type: "turn_end",
      message: { errorMessage: "boom" },
    });
    expect(a).toEqual({ type: "add_system", text: "error: boom", level: "error" });
  });

  it("suppresses turn_end abort errors (handleAbort already reports them)", () => {
    expect(
      eventToAction({ type: "turn_end", message: { errorMessage: "Request was aborted" } }),
    ).toBeNull();
    expect(
      eventToAction({ type: "turn_end", message: { errorMessage: "The operation was aborted" } }),
    ).toBeNull();
  });

  it("maps turn_end usage → set_assistant_metadata", () => {
    const a = eventToAction({
      type: "turn_end",
      message: {
        model: "claude-sonnet-4",
        usage: {
          input: 10,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
          cost: { input: 0.0003, output: 0.0009, cacheRead: 0, cacheWrite: 0, total: 0.0012 },
        },
      },
    });
    expect(a).toEqual({
      type: "set_assistant_metadata",
      model: "claude-sonnet-4",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.0012 },
    });
  });

  it("ignores turn_end without errorMessage or usage", () => {
    expect(eventToAction({ type: "turn_end", message: {} })).toBeNull();
  });

  it("returns null for unknown event types", () => {
    expect(eventToAction({ type: "weird_event" })).toBeNull();
  });
});