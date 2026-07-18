// test/evaluation.test.ts
// End-to-end evaluation suite for the intelligence loop.
//
// These tests intentionally cross module boundaries (memory + plan +
// reflection + verifier + prompt assembly) so a regression in any one
// piece of the loop is caught. They are slower than unit tests by design.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EvolutionEngine } from "@/core/runtime/evolution/engine";
import { Learner } from "@/core/runtime/evolution/learner";
import { IntelligenceMetricsAggregator } from "@/core/runtime/evolution/metrics";
import { MemoryStore } from "@/infra/memory/store";
import { SkillRegistry } from "@/infra/skills/registry";
import { PlanStore } from "@/core/session/plan-store";
import { SkillValidator } from "@/core/runtime/skill/validator";
import { buildContextBlock } from "@/bridge/prompt-assembly";
import { asSessionId } from "@/types/brand";
import type { Plan, Step } from "@/core/runtime/plan/types";
import type { PlanRunner } from "@/core/runtime/plan/plan-runner";
import type { TapeLike } from "@/types/hooks/index";
import type { TapeEntry } from "@/types/tape/index";
import type { HookRegistry } from "@/core/runtime/hook/registry";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function makeTape(entries: TapeEntry[] = []): { tape: TapeLike; entries: TapeEntry[] } {
    return {
        entries,
        tape: {
            append: (e: TapeEntry) => entries.push(e),
            replay: function* () {
                for (const e of entries) yield e;
            },
            summary: () => "",
            stats: () => ({ totalEntries: entries.length, sessions: {} }),
            loadAnchor: () => undefined,
        } as unknown as TapeLike,
    };
}

function makePlanRunner(): PlanRunner {
    return {
        createAndRun: async () =>
            ({
                id: "validation-plan",
                sessionId: asSessionId("session-1"),
                goal: "validate skill",
                status: "completed",
                steps: [
                    { id: "s1", index: 0, description: "step", status: "completed", retryCount: 0 } as Step,
                ],
                createdAt: 1,
                updatedAt: 2,
            }) as Plan,
    } as unknown as PlanRunner;
}

describe("Evaluation: intelligence loop integration", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-eval-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("memory writes are persisted and visible to next reflection", async () => {
        const memoryPath = path.join(dir, "phus.md");
        const memory = new MemoryStore(memoryPath);

        memory.apply({
            kind: "append",
            section: "Procedures",
            body: "- Task: deploy\n- Steps: 1. tests, 2. ship",
        });

        const learner = new Learner({
            tape: makeTape().tape,
            skills: new SkillRegistry(dir),
            model: {
                prompt: async () =>
                    JSON.stringify({
                        outcome: "success",
                        whatWorked: ["followed the procedure"],
                        whatFailed: [],
                        procedureConfidence: 0.8,
                    }),
            },
        });
        const skills = new SkillRegistry(dir);
        const store = new PlanStore(":memory:");
        const validator = new SkillValidator({ planRunner: makePlanRunner(), planStore: store, skills });
        const { tape } = makeTape();
        const engine = new EvolutionEngine({
            learner,
            skillValidator: validator,
            skills,
            memoryStore: memory,
            tape,
            planStore: store,
        });

        const plan: Plan = {
            id: "p1",
            sessionId: asSessionId("session-1"),
            goal: "Deploy safely",
            status: "completed",
            steps: [],
            createdAt: 1,
            updatedAt: 2,
        };

        await engine.onPlanCompleted(plan);

        const stored = fs.readFileSync(memoryPath, "utf-8");
        // Both the seeded procedure AND the new reflection entry should be present.
        expect(stored).toContain("deploy");
        expect(stored).toContain("followed the procedure");
    });

    it("draft skill can improve on baseline and be promoted", async () => {
        const skills = new SkillRegistry(dir);
        const memory = new MemoryStore(path.join(dir, "phus.md"));
        const store = new PlanStore(":memory:");

        // Seed an existing baseline that the next run can beat.
        store.recordValidationBaseline("improve-me", {
            stepCount: 5,
            failures: 3,
            durationMs: 100,
            status: "failed",
            recordedAt: 1,
        });

        const learner = new Learner({
            tape: makeTape().tape,
            skills,
            model: {
                prompt: async () =>
                    JSON.stringify({
                        outcome: "success",
                        whatWorked: ["reduced failures to 0"],
                        whatFailed: [],
                        procedureConfidence: 0.9,
                        suggestedSkill: {
                            name: "improve-me",
                            description: "Better deploy",
                            body: "Use this for deploys",
                            trigger: "deploy",
                        },
                    }),
            },
        });

        const validator = new SkillValidator({ planRunner: makePlanRunner(), planStore: store, skills });
        const { tape } = makeTape();
        const engine = new EvolutionEngine({
            learner,
            skillValidator: validator,
            skills,
            memoryStore: memory,
            tape,
            planStore: store,
        });

        const plan: Plan = {
            id: "p2",
            sessionId: asSessionId("session-1"),
            goal: "Deploy better",
            status: "completed",
            steps: [
                { id: "s1", index: 0, description: "x", status: "completed", retryCount: 0 } as Step,
            ],
            createdAt: 1,
            updatedAt: 2,
        };

        const result = await engine.onPlanCompleted(plan);

        expect(result.validationOutcome).toBe("improved");
        // Promoted: should be in skills (not drafts, not archive).
        expect(skills.get("improve-me")).toBeDefined();
        expect(skills.getDraft("improve-me")).toBeUndefined();

        const stats = store.getValidationStats("improve-me");
        expect(stats.improved).toBe(1);
        expect(store.hasImprovedAtLeastOnce("improve-me")).toBe(true);
    });

    it("metrics aggregator rolls up plan + validation + memory writes", async () => {
        const skills = new SkillRegistry(dir);
        const memory = new MemoryStore(path.join(dir, "phus.md"));
        const store = new PlanStore(":memory:");
        store.recordValidationAttempt("a", "improved", {
            stepCount: 2,
            failures: 0,
            durationMs: 1,
            status: "completed",
            recordedAt: 1,
        }, "seed");
        store.recordValidationAttempt("a", "failed", {
            stepCount: 2,
            failures: 1,
            durationMs: 1,
            status: "completed",
            recordedAt: 2,
        }, "seed");
        store.recordValidationAttempt("b", "pending", {
            stepCount: 2,
            failures: 0,
            durationMs: 1,
            status: "completed",
            recordedAt: 1,
        }, "seed");

        // Seed a plan so plansRun > 0.
        store.save({
            id: "p-metrics",
            sessionId: asSessionId("session-1"),
            goal: "metrics",
            status: "completed",
            steps: [{ id: "s1", index: 0, description: "x", status: "completed", retryCount: 2 } as Step],
            createdAt: 1,
            updatedAt: 2,
        });

        const { tape } = makeTape([
            { kind: "memory_write", sessionId: asSessionId("session-1"), ts: 1 } as unknown as TapeEntry,
            { kind: "memory_write", sessionId: asSessionId("session-1"), ts: 2 } as unknown as TapeEntry,
        ]);

        const agg = new IntelligenceMetricsAggregator({ planStore: store, tape });
        const metrics = agg.aggregate({ sessionId: "session-1" });

        expect(metrics.plansRun).toBe(1);
        expect(metrics.plansCompleted).toBe(1);
        expect(metrics.totalStepRetries).toBe(2);
        expect(metrics.plansWithRetries).toBe(1);
        expect(metrics.memoryWrites).toBe(2);
        expect(metrics.drafts).toHaveLength(2);
        const draftA = metrics.drafts.find((d) => d.name === "a");
        expect(draftA?.improved).toBe(1);
        expect(draftA?.failed).toBe(1);
        expect(draftA?.promoted).toBe(true);
        const draftB = metrics.drafts.find((d) => d.name === "b");
        expect(draftB?.promoted).toBe(false);

        const formatted = agg.format(metrics);
        expect(formatted).toContain("1 run");
        expect(formatted).toContain("1 promoted");
        expect(formatted.length).toBeGreaterThan(0);
    });

    it("prompt assembly injects repo files when an index is wired", async () => {
        // Create a fake repo tree under dir/.
        fs.mkdirSync(path.join(dir, "src"), { recursive: true });
        fs.writeFileSync(path.join(dir, "src", "foo.ts"), "export const foo = 1;\n");
        fs.writeFileSync(path.join(dir, "src", "bar.ts"), "export const bar = 2;\n");

        const { RepoFileIndex } = await import("@/core/session/repo-file-index.js");
        const index = new RepoFileIndex(dir);

        const tape = makeTape().tape;
        const skills = new SkillRegistry(dir);
        const hooks = { execute: async () => undefined } as unknown as Pick<HookRegistry, "execute">;
        let captured = "";
        const deps = {
            hooks,
            tape,
            skills,
            memory: { toPromptContext: () => "## Project memory\n(seed)" },
            getContextWindow: () => undefined,
            getCurrentSessionId: () => asSessionId("session-1"),
            setSystemPrompt: (s: string) => { captured = s; },
            repoIndex: index,
        };

        const messages: AgentMessage[] = [
            { role: "user", content: [{ type: "text", text: "fix the foo file please" }], timestamp: Date.now() },
        ];

        await buildContextBlock(messages, deps);

        expect(captured).toContain("## Relevant files in this repo");
        expect(captured).toContain("src/foo.ts");
        // The matched token is "foo" — both files mention it via path.
        expect(captured).toMatch(/matched: foo/);
    });

    it("failed verification attempts get archived with a reason", async () => {
        const skills = new SkillRegistry(dir);
        const memory = new MemoryStore(path.join(dir, "phus.md"));
        const store = new PlanStore(":memory:");
        store.recordValidationBaseline("worse", {
            stepCount: 2,
            failures: 0,
            durationMs: 1,
            status: "completed",
            recordedAt: 1,
        });

        const learner = new Learner({
            tape: makeTape().tape,
            skills,
            model: {
                prompt: async () =>
                    JSON.stringify({
                        outcome: "success",
                        whatWorked: ["tried something"],
                        whatFailed: [],
                        procedureConfidence: 0.8,
                        suggestedSkill: {
                            name: "worse",
                            description: "Less effective",
                            body: "Do less",
                            trigger: "rare",
                        },
                    }),
            },
        });

        const validator = new SkillValidator({ planRunner: makePlanRunner(), planStore: store, skills });
        const { tape } = makeTape();
        const engine = new EvolutionEngine({
            learner,
            skillValidator: validator,
            skills,
            memoryStore: memory,
            tape,
            planStore: store,
        });

        const plan: Plan = {
            id: "p-worse",
            sessionId: asSessionId("session-1"),
            goal: "Make it worse",
            status: "completed",
            steps: [
                { id: "s1", index: 0, description: "x", status: "failed", retryCount: 0 } as Step,
                { id: "s2", index: 1, description: "y", status: "failed", retryCount: 0 } as Step,
            ],
            createdAt: 1,
            updatedAt: 2,
        };

        const result = await engine.onPlanCompleted(plan);

        expect(result.validationOutcome).toBe("failed");
        expect(skills.getDraft("worse")).toBeUndefined();
        const history = store.getValidationHistory("worse");
        expect(history[0]?.outcome).toBe("failed");
        expect(history[0]?.reason).toContain("no improvement");
    });
});