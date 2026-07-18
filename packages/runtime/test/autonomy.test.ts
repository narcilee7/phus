// test/memory/autonomy.test.ts
// Unit tests for the memory_write autonomy gate.

import { describe, expect, it } from "vitest";

import { AutonomyGate, actionTag, decide } from "@/infra/memory/autonomy";
import type { MemoryAction } from "@/infra/memory/store";
import type { MemoryConfig } from "@/infra/config/schema";

const cfg = (over: Partial<MemoryConfig> = {}): MemoryConfig => ({
  mode: "propose",
  autoApprove: [],
  requireApproval: [],
  logToTape: true,
  ...over,
});

const append = (section = "Style"): MemoryAction => ({ kind: "append", section, body: "x" });
const replace = (section = "Style"): MemoryAction => ({ kind: "replace", section, body: "x" });
const del = (section = "Style"): MemoryAction => ({ kind: "delete", section });

describe("actionTag", () => {
  it("maps each kind to memory.<kind>", () => {
    expect(actionTag("append")).toBe("memory.append");
    expect(actionTag("replace")).toBe("memory.replace");
    expect(actionTag("delete")).toBe("memory.delete");
  });
});

describe("decide (pure)", () => {
  it("propose: every action approves", () => {
    const c = cfg({ mode: "propose" });
    expect(decide(append(), c)).toBe("approve");
    expect(decide(replace(), c)).toBe("approve");
    expect(decide(del(), c)).toBe("approve");
  });

  it("yolo: every action auto", () => {
    const c = cfg({ mode: "yolo" });
    expect(decide(append(), c)).toBe("auto");
    expect(decide(replace(), c)).toBe("auto");
    expect(decide(del(), c)).toBe("auto");
  });

  it("approval-list: autoApprove match → auto, else approve", () => {
    const c = cfg({ mode: "approval-list", autoApprove: ["memory.append"] });
    expect(decide(append(), c)).toBe("auto");
    expect(decide(replace(), c)).toBe("approve");
    expect(decide(del(), c)).toBe("approve");
  });

  it("approval-list: requireApproval match always overrides autoApprove", () => {
    const c = cfg({
      mode: "approval-list",
      autoApprove: ["memory.delete"], // try to allow delete
      requireApproval: ["memory.delete"], // but require it
    });
    expect(decide(del(), c)).toBe("approve");
  });

  it("requireApproval also overrides in yolo mode (defence in depth)", () => {
    const c = cfg({ mode: "yolo", requireApproval: ["memory.delete"] });
    expect(decide(del(), c)).toBe("approve");
    expect(decide(append(), c)).toBe("auto");
  });
});

describe("AutonomyGate class", () => {
  it("fromConfig returns a gate that agrees with decide()", () => {
    const gate = AutonomyGate.fromConfig(cfg({ mode: "yolo" }));
    expect(gate.decide(append())).toBe("auto");
    expect(gate.isYolo).toBe(true);
    expect(gate.config.mode).toBe("yolo");
  });

  it("isYolo is false in non-yolo modes", () => {
    expect(AutonomyGate.fromConfig(cfg({ mode: "propose" })).isYolo).toBe(false);
    expect(AutonomyGate.fromConfig(cfg({ mode: "approval-list" })).isYolo).toBe(false);
  });
});
