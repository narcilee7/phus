import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Learner } from "@/core/runtime/evolution/learner";
import { SkillRegistry } from "@/infra/skills/registry";
import { asSessionId } from "@/types/brand";
import type { TapeLike } from "@/types/hooks/index";
import type { CorePort } from "@/bridge/core-port";

function makeTape(entries: unknown[] = []): TapeLike {
  return {
    append: () => {},
    replay: function* () {
      for (const entry of entries) yield entry as any;
    },
    summary: () => "",
    stats: () => ({ totalEntries: entries.length, sessions: {} }),
    loadAnchor: () => undefined,
  };
}

function makePort(response: string): CorePort {
  return { complete: async () => ({ text: response }) };
}

describe("Learner", () => {
  it("reflects and extracts a skill draft", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-learner-"));
    const skills = new SkillRegistry(dir);
    const tape = makeTape([
      {
        kind: "turn",
        turn: {
          prompt: "deploy the app",
          modelOutput: "deployment completed",
        },
      },
    ]);

    const modelResponse = JSON.stringify({
      outcome: "success",
      whatWorked: ["used the deploy script"],
      whatFailed: [],
      procedureConfidence: 0.9,
      reusableProcedure: "Run deploy.sh after tests pass.",
      suggestedSkill: {
        name: "deploy-app",
        description: "Deploy the application",
        body: "## Deploy\n1. Run tests\n2. Run deploy.sh",
        trigger: "when the user asks to deploy",
      },
    });
    const port = makePort(modelResponse);

    const learner = new Learner({ tape, skills, port });
    const reflection = await learner.reflect(asSessionId("session-1"), "deploy the app");

    expect(reflection.outcome).toBe("success");
    expect(reflection.whatWorked).toContain("used the deploy script");
    expect(reflection.suggestedSkill).toBeDefined();
    expect(reflection.suggestedSkill?.name).toBe("deploy-app");
    expect(reflection.suggestedSkill?.sourceSessionId).toBe("session-1");
  });

  it("falls back to partial outcome on malformed model output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-learner-"));
    const skills = new SkillRegistry(dir);
    const tape = makeTape([]);
    const port = makePort("not valid json");

    const learner = new Learner({ tape, skills, port });
    const reflection = await learner.reflect(asSessionId("session-2"), "some task");

    expect(reflection.outcome).toBe("partial");
    expect(reflection.whatFailed).toContain("could not parse learner response");
    expect(reflection.suggestedSkill).toBeUndefined();
  });
});
