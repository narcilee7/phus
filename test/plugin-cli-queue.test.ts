// test/plugin-cli-queue.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { Command } from "commander";
import {
  enqueuePendingCliCommand,
  drainPendingCliCommands,
  _resetPendingCliCommands,
  _pendingCliCommandCount,
} from "../src/core/plugin/cli-queue.js";

describe("plugin-cli-queue", () => {
  beforeEach(() => {
    _resetPendingCliCommands();
  });

  it("queues and drains callbacks in FIFO order", () => {
    const calls: string[] = [];
    enqueuePendingCliCommand(() => calls.push("a"));
    enqueuePendingCliCommand(() => calls.push("b"));
    enqueuePendingCliCommand(() => calls.push("c"));

    expect(_pendingCliCommandCount()).toBe(3);

    const program = new Command();
    drainPendingCliCommands(program);

    expect(calls).toEqual(["a", "b", "c"]);
    expect(_pendingCliCommandCount()).toBe(0);
  });

  it("a throwing registrar does not block subsequent ones", () => {
    const calls: string[] = [];
    enqueuePendingCliCommand(() => {
      throw new Error("boom");
    });
    enqueuePendingCliCommand(() => calls.push("survived"));

    const program = new Command();
    expect(() => drainPendingCliCommands(program)).toThrow("boom");
    // Queue is drained even on throw — the surviving registrar never ran
    // because we short-circuited, but the queue must be empty afterward.
    expect(_pendingCliCommandCount()).toBe(0);
  });

  it("drain on an empty queue is a no-op", () => {
    const program = new Command();
    expect(() => drainPendingCliCommands(program)).not.toThrow();
    expect(_pendingCliCommandCount()).toBe(0);
  });
});