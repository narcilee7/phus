import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EvolutionEngine } from "@/core/runtime/evolution/engine.js";
import { Learner } from "@/core/runtime/evolution/learner.js";
import { MemoryStore } from "@/infra/memory/store.js";
import { SkillValidator } from "@/core/runtime/skill/validator.js";
import { SkillRegistry } from "@/infra/skills/registry.js";
import { PlanStore } from "@/core/session/plan-store.js";
import { asSessionId } from "@/types/brand.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import type { PlanRunner } from "@/core/runtime/plan/plan-runner.js";
import type { TapeLike } from "@/types/hooks/index.js";
import type { TapeEntry } from "@/types/tape/index.js";

function makeTape(): TapeLike {
  return {
    append: () => {},
    replay: function* () {},
    summary: () => "",
    stats: () => ({ totalEntries: 0, sessions: {} }),
    loadAnchor: () => undefined,
  };
}

function makeCaptureTape(): { tape: TapeLike; entries: TapeEntry[] } {
  const entries: TapeEntry[] = [];
  return {
    entries,
    tape: {
      append: (entry: TapeEntry) => {
        entries.push(entry);
      },
      replay: function* () {},
      summary: () => "",
      stats: () => ({ totalEntries: entries.length, sessions: {} }),
      loadAnchor: () => undefined,
    } as unknown as TapeLike,
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
    const memoryStore = new MemoryStore(path.join(dir, "phus.md"));
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
    const engine = new EvolutionEngine({ learner, skillValidator: validator, skills, memoryStore, tape });

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
    const memoryStore = new MemoryStore(path.join(dir, "phus.md"));
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
    const engine = new EvolutionEngine({ learner, skillValidator: validator, skills, memoryStore, tape });

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

  it("writes reusable procedures back into project memory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const memoryPath = path.join(dir, "phus.md");
    const memoryStore = new MemoryStore(memoryPath);
    const { tape, entries } = makeCaptureTape();

    const learner = new Learner({
      tape,
      skills,
      model: {
        prompt: async () =>
          JSON.stringify({
            outcome: "success",
            whatWorked: ["reused the deploy checklist"],
            whatFailed: [],
            reusableProcedure: "1. run the tests\n2. deploy only after green",
          }),
      },
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
    });

    const plan: Plan = {
      id: "plan-3",
      sessionId: asSessionId("session-1"),
      goal: "Deploy safely",
      status: "completed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.reflection.reusableProcedure).toContain("deploy only after green");
    expect(fs.readFileSync(memoryPath, "utf-8")).toContain("## Procedures");
    expect(fs.readFileSync(memoryPath, "utf-8")).toContain("deploy only after green");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("memory_write");
    if (entries[0]?.kind === "memory_write") {
      expect(entries[0].action.section).toBe("Procedures");
      expect(entries[0].reason).toContain("completed plan");
    }
  });
});
