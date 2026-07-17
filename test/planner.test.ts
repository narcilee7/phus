import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Planner } from "@/core/runtime/plan/planner.js";
import { HookRegistry } from "@/core/runtime/hook/registry.js";
import type { SkillRegistryLike } from "@/types/hooks/index.js";

const stubSkills: SkillRegistryLike = {
  discover: () => {},
  getAll: () => [],
  get: () => undefined,
  toPromptContext: () => "- test-skill: a test skill",
};

function makeModel(response: string) {
  return {
    prompt: async (_messages: AgentMessage[]): Promise<string> => response,
  };
}

describe("Planner", () => {
  it("creates a multi-step plan from model JSON", async () => {
    const model = makeModel(JSON.stringify({
      steps: [
        { id: "s1", description: "gather requirements", expectedOutput: "requirements doc" },
        { id: "s2", description: "implement feature", dependsOn: ["s1"] },
      ],
    }));
    const planner = new Planner({ skills: stubSkills, model });
    const plan = await planner.createPlan("build a feature", "session-1", "context");

    expect(plan.goal).toBe("build a feature");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.description).toBe("gather requirements");
    expect(plan.steps[1]?.dependsOn).toEqual(["s1"]);
    expect(plan.status).toBe("pending");
  });

  it("falls back to a single-step plan when JSON is invalid", async () => {
    const model = makeModel("not json");
    const planner = new Planner({ skills: stubSkills, model });
    const plan = await planner.createPlan("do something", "session-1");

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toBe("do something");
  });

  it("strips markdown fences from model output", async () => {
    const model = makeModel("```json\n" + JSON.stringify({
      steps: [{ description: "step one" }],
    }) + "\n```");
    const planner = new Planner({ skills: stubSkills, model });
    const plan = await planner.createPlan("goal", "session-1");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toBe("step one");
  });

  it("emits plan_created hook", async () => {
    const model = makeModel(JSON.stringify({ steps: [{ description: "a" }] }));
    const hooks = new HookRegistry();
    let fired = false;
    hooks.register("plan_created", async (ctx) => {
      fired = true;
      return ctx.extras.plan;
    }, { mode: "broadcast" });
    const planner = new Planner({ skills: stubSkills, model, hooks });
    await planner.createPlan("goal", "session-1");
    expect(fired).toBe(true);
  });
});
