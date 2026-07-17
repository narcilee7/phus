import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EvolutionEngine } from "@/core/runtime/evolution/engine";
import { Learner } from "@/core/runtime/learner.js";
import { SkillValidator } from "@/core/runtime/skill/validator";
import { SkillRegistry } from "@/infra/skills/registry.js";
import { PlanStore } from "@/core/session/plan-store.js";
import { asSessionId } from "@/types/brand.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import type { PlanRunner } from "@/core/runtime/plan-runner.js";
import type { TapeLike } from "@/types/hooks/index.js";

function makeTape(): TapeLike {
  return {
    append: () => {},
    replay: function* () {},
    summary: () => "",
    stats: () => ({ totalEntries: 0, sessions: {} }),
    loadAnchor: () => undefined,
  };
}

function makeRunner(): PlanRunner {
  return {
    createAndRun: async () =>
      ({
        id: "validation-plan",
        sessionId: asSessionId("session-1"),
        goal: "validate skill",
        status: "completed",
        steps: [
          { id: "s1", index: 0, description: "step 1", status: "completed", retryCount: 0 } as Step,
        ],
        createdAt: 1,
        updatedAt: 2,
      }) as Plan,
  } as unknown as PlanRunner;
}

describe("EvolutionEngine", () => {
  it("onPlanCompleted creates a draft when reflection suggests a skill", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const tape = makeTape();
    const modelResponse = JSON.stringify({
      outcome: "success",
      whatWorked: ["identified a reusable workflow"],
      whatFailed: [],
      suggestedSkill: {
        name: "summarize-tape",
        description: "Summarize recent tape entries",
        body: "## Summarize\nRead recent turns and produce a concise summary.",
        trigger: "when the user asks for a summary",
      },
    });
    const learner = new Learner({ tape, skills, model: { prompt: async () => modelResponse } });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({ learner, skillValidator: validator, skills, tape });

    const plan: Plan = {
      id: "plan-1",
      sessionId: asSessionId("session-1"),
      goal: "Summarize recent tape entries",
      status: "completed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.reflection.suggestedSkill).toBeDefined();
    expect(result.draft?.name).toBe("summarize-tape");
    expect(skills.getDraft("summarize-tape")).toBeDefined();
  });

  it("onPlanCompleted does not create a draft without a suggested skill", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const tape = makeTape();
    const learner = new Learner({
      tape,
      skills,
      model: {
        prompt: async () =>
          JSON.stringify({
            outcome: "failure",
            whatWorked: [],
            whatFailed: ["no clear reusable pattern"],
          }),
      },
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({ learner, skillValidator: validator, skills, tape });

    const plan: Plan = {
      id: "plan-2",
      sessionId: asSessionId("session-1"),
      goal: "Do something one-off",
      status: "failed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.draft).toBeUndefined();
    expect(result.validated).toBeUndefined();
    expect(skills.getAllDrafts()).toHaveLength(0);
  });
});
