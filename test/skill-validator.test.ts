import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillValidator } from "@/core/runtime/skill-validator.js";
import { PlanStore } from "@/core/session/plan-store.js";
import { SkillRegistry } from "@/infra/skills/registry.js";
import { asSessionId } from "@/types/brand.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import type { PlanRunner } from "@/core/runtime/plan-runner.js";

function makePlan(status: "completed" | "failed", steps: Step[]): Plan {
  return {
    id: "plan-1",
    sessionId: asSessionId("session-1"),
    goal: "validate skill",
    status,
    steps,
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeStep(index: number, status: Step["status"]): Step {
  return {
    id: `s${index}`,
    index,
    description: `step ${index}`,
    status,
    retryCount: 0,
  };
}

function makeRunner(plan: Plan): PlanRunner {
  return {
    createAndRun: async () => plan,
  } as unknown as PlanRunner;
}

describe("SkillValidator", () => {
  it("records baseline on first validation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skill-validator-"));
    const skills = new SkillRegistry(dir);
    skills.writeDraft({
      name: "draft-1",
      description: "test",
      body: "body",
      trigger: "t",
      sourceSessionId: "session-1",
      verified: false,
      version: "0.1.0-draft",
    });

    const store = new PlanStore(":memory:");
    const plan = makePlan("completed", [makeStep(0, "completed"), makeStep(1, "completed")]);
    const validator = new SkillValidator({
      planRunner: makeRunner(plan),
      planStore: store,
      skills,
    });

    const result = await validator.validate("draft-1", "validate skill", asSessionId("session-1"));

    expect(result.improved).toBe(false);
    expect(result.reason).toContain("pending_validation");

    const baseline = store.getValidationBaseline("draft-1");
    expect(baseline).toBeDefined();
    expect(baseline?.status).toBe("completed");
    expect(baseline?.stepCount).toBe(2);
  });

  it("detects improvement when failures decrease", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skill-validator-"));
    const skills = new SkillRegistry(dir);
    skills.writeDraft({
      name: "draft-2",
      description: "test",
      body: "body",
      trigger: "t",
      sourceSessionId: "session-1",
      verified: false,
      version: "0.1.0-draft",
    });

    const store = new PlanStore(":memory:");
    store.recordValidationBaseline("draft-2", {
      stepCount: 2,
      failures: 1,
      durationMs: 100,
      status: "completed",
      recordedAt: 1,
    });

    const plan = makePlan("completed", [makeStep(0, "completed"), makeStep(1, "completed")]);
    const validator = new SkillValidator({
      planRunner: makeRunner(plan),
      planStore: store,
      skills,
    });

    const result = await validator.validate("draft-2", "validate skill", asSessionId("session-1"));

    expect(result.improved).toBe(true);
    expect(result.reason).toContain("improved over baseline");
  });

  it("leaves the skill promoted when improved", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skill-validator-"));
    const skills = new SkillRegistry(dir);
    skills.writeDraft({
      name: "draft-3",
      description: "test",
      body: "body",
      trigger: "t",
      sourceSessionId: "session-1",
      verified: false,
      version: "0.1.0-draft",
    });

    const store = new PlanStore(":memory:");
    store.recordValidationBaseline("draft-3", {
      stepCount: 2,
      failures: 1,
      durationMs: 100,
      status: "completed",
      recordedAt: 1,
    });

    const plan = makePlan("completed", [makeStep(0, "completed"), makeStep(1, "completed")]);
    const validator = new SkillValidator({
      planRunner: makeRunner(plan),
      planStore: store,
      skills,
    });

    await validator.validate("draft-3", "validate skill", asSessionId("session-1"));

    expect(skills.get("draft-3")).toBeDefined();
    expect(skills.getDraft("draft-3")).toBeUndefined();
  });

  it("returns not found when draft does not exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skill-validator-"));
    const skills = new SkillRegistry(dir);
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({
      planRunner: makeRunner(makePlan("completed", [])),
      planStore: store,
      skills,
    });

    const result = await validator.validate("missing", "task", asSessionId("session-1"));
    expect(result.improved).toBe(false);
    expect(result.reason).toContain("draft not found");
  });
});
