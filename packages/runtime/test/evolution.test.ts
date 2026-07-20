import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EvolutionEngine } from "@/core/runtime/evolution/engine";
import { Learner } from "@/core/runtime/evolution/learner";
import { MemoryStore } from "@/infra/memory/store";
import { SkillValidator } from "@/core/runtime/skill/validator";
import { SkillRegistry } from "@/infra/skills/registry";
import { PlanStore } from "@/core/session/plan-store";
import { asSessionId } from "@/types/brand";
import type { Plan, Step } from "@/core/runtime/plan/types";
import type { PlanRunner } from "@/core/runtime/plan/plan-runner";
import type { TapeLike } from "@/types/hooks/index";
import type { TapeEntry } from "@/types/tape/index";

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

/** Build a CorePort double whose `complete` returns the given JSON-string response. */
function portWith(text: string) {
  return { complete: async () => ({ text }) };
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
      procedureConfidence: 0.9,
      suggestedSkill: {
        name: "summarize-tape",
        description: "Summarize recent tape entries",
        body: "## Summarize\nRead recent turns and produce a concise summary.",
        trigger: "when the user asks for a summary",
      },
    });
    const learner = new Learner({ tape, skills, port: portWith(modelResponse) });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

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
    expect(result.validationOutcome).toBe("baseline");
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
      port: portWith(JSON.stringify({
        outcome: "failure",
        whatWorked: [],
        whatFailed: ["no clear reusable pattern"],
        procedureConfidence: 0,
      })),
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

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
    expect(result.validationOutcome).toBeUndefined();
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
      port: portWith(JSON.stringify({
        outcome: "success",
        whatWorked: ["reused the deploy checklist"],
        whatFailed: [],
        procedureConfidence: 0.8,
        reusableProcedure: "1. run the tests\n2. deploy only after green",
      })),
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
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

  it("synthesizes a procedure from whatWorked when the model omits one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const memoryStore = new MemoryStore(path.join(dir, "phus.md"));
    const tape = makeTape();

    const learner = new Learner({
      tape,
      skills,
      port: portWith(JSON.stringify({
        outcome: "success",
        whatWorked: ["read the file before editing", "ran tests after"],
        whatFailed: [],
        procedureConfidence: 0.5,
      })),
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

    const plan: Plan = {
      id: "plan-synth",
      sessionId: asSessionId("session-1"),
      goal: "Edit safely",
      status: "completed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.reflection.reusableProcedure).toBeDefined();
    expect(result.reflection.reusableProcedure).toContain("read the file before editing");
    expect(result.reflection.reusableProcedure).toContain("Preconditions");
    expect(result.reflection.procedureConfidence).toBeGreaterThan(0);
  });

  it("archives draft and marks failed when plan metrics regress", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const memoryStore = new MemoryStore(path.join(dir, "phus.md"));
    const tape = makeTape();

    const learner = new Learner({
      tape,
      skills,
      port: portWith(JSON.stringify({
        outcome: "success",
        whatWorked: ["step a", "step b"],
        whatFailed: [],
        procedureConfidence: 0.9,
        suggestedSkill: {
          name: "regression-test",
          description: "Re-runs tests",
          body: "Run tests",
          trigger: "after edits",
        },
      })),
    });
    const store = new PlanStore(":memory:");

    // Seed a baseline that's better than the new plan will deliver.
    store.recordValidationBaseline("regression-test", {
      stepCount: 2,
      failures: 0,
      durationMs: 1,
      status: "completed",
      recordedAt: 1,
    });

    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

    const plan: Plan = {
      id: "plan-regress",
      sessionId: asSessionId("session-1"),
      goal: "Test regression",
      status: "completed",
      steps: [
        { id: "s1", index: 0, description: "x", status: "completed", retryCount: 0 } as Step,
        { id: "s2", index: 1, description: "y", status: "completed", retryCount: 0 } as Step,
        { id: "s3", index: 2, description: "z", status: "failed", retryCount: 0 } as Step,
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.validationOutcome).toBe("failed");
    expect(skills.getDraft("regression-test")).toBeUndefined();
    const history = store.getValidationHistory("regression-test");
    expect(history[0]?.outcome).toBe("failed");
    expect(store.getValidationStats("regression-test").failed).toBe(1);
  });

  it("archives any suggested skill when plan did not complete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const memoryStore = new MemoryStore(path.join(dir, "phus.md"));
    const tape = makeTape();

    const learner = new Learner({
      tape,
      skills,
      port: portWith(JSON.stringify({
        outcome: "failure",
        whatWorked: ["partial progress"],
        whatFailed: ["got stuck on the last step"],
        procedureConfidence: 0.9,
        suggestedSkill: {
          name: "unfinished",
          description: "Won't be useful",
          body: "Do something",
          trigger: "rare",
        },
      })),
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

    const plan: Plan = {
      id: "plan-fail",
      sessionId: asSessionId("session-1"),
      goal: "Stuck",
      status: "failed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await engine.onPlanCompleted(plan);

    expect(result.draft).toBeUndefined();
    expect(skills.getDraft("unfinished")).toBeUndefined();
  });

  it("skips procedure persistence when confidence is below threshold", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-evolution-"));
    const skills = new SkillRegistry(dir);
    const memoryPath = path.join(dir, "phus.md");
    const memoryStore = new MemoryStore(memoryPath);
    const tape = makeTape();

    const learner = new Learner({
      tape,
      skills,
      port: portWith(JSON.stringify({
        outcome: "success",
        whatWorked: ["small win"],
        whatFailed: [],
        procedureConfidence: 0.1,
        reusableProcedure: "short proc",
      })),
    });
    const store = new PlanStore(":memory:");
    const validator = new SkillValidator({ planRunner: makeRunner(), planStore: store, skills });
    const engine = new EvolutionEngine({
      learner,
      skillValidator: validator,
      skills,
      memoryStore,
      tape,
      planStore: store,
    });

    const plan: Plan = {
      id: "plan-low",
      sessionId: asSessionId("session-1"),
      goal: "low confidence",
      status: "completed",
      steps: [],
      createdAt: 1,
      updatedAt: 2,
    };

    await engine.onPlanCompleted(plan);

    // Procedure was too short and confidence too low -> nothing written.
    const md = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, "utf-8") : "";
    expect(md.includes("## Procedures")).toBe(false);
  });
});
