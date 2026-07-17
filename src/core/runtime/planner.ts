import * as crypto from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SkillRegistryLike } from "@/types/hooks/index.js";
import { HookRegistry, makeCtx } from "@/core/runtime/hook.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import { asSessionId } from "@/types/brand.js";

export interface PlannerDeps {
  skills: SkillRegistryLike;
  model:
    | { prompt(messages: AgentMessage[]): Promise<string> }
    | ((messages: AgentMessage[]) => Promise<string>);
  hooks?: HookRegistry;
}

export class Planner {
  constructor(private deps: PlannerDeps) {}

  async createPlan(goal: string, sessionId: string, context?: string): Promise<Plan> {
    const prompt = this.buildPrompt(goal, context);
    let response = "";
    try {
      const call = typeof this.deps.model === "function"
        ? this.deps.model
        : this.deps.model.prompt.bind(this.deps.model);
      response = await call(prompt);
    } catch (err: any) {
      response = "";
    }

    const steps = this.parseSteps(response, goal, context);
    const plan: Plan = {
      id: crypto.randomUUID(),
      sessionId: asSessionId(sessionId),
      goal,
      status: "pending",
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.deps.hooks) {
      await this.deps.hooks.execute(
        "plan_created",
        makeCtx({
          sessionId: asSessionId(sessionId),
          skills: this.deps.skills,
          extras: { plan },
        }),
        "broadcast",
      );
    }

    return plan;
  }

  private buildPrompt(goal: string, context?: string): AgentMessage[] {
    const parts = [
      "You are a task planner. Given a goal and available skills, output a JSON object with a top-level \"steps\" array.",
      "Each step must have: id (unique string), description (string), tool (optional tool/skill name), expectedOutput (optional string), dependsOn (optional array of step ids).",
      "Steps should be concrete, actionable, and ordered by dependency. Output only the JSON object, no markdown fences.",
      "",
      `Goal: ${goal}`,
    ];
    if (context) {
      parts.push(`Context: ${context}`);
    }
    parts.push("");
    parts.push("Available skills:");
    parts.push(this.deps.skills.toPromptContext());

    return [
      {
        role: "user",
        content: [{ type: "text", text: parts.join("\n") }],
        timestamp: Date.now(),
      },
    ];
  }

  private parseSteps(response: string, goal: string, context?: string): Step[] {
    const cleaned = this.stripJson(response);
    try {
      const parsed = JSON.parse(cleaned) as { steps?: Array<Partial<Step>> };
      if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return parsed.steps.map((raw, idx) => this.normalizeStep(raw, idx));
      }
    } catch {
      // fall through to single-step fallback
    }
    return [this.normalizeStep({ description: goal, expectedOutput: context }, 0)];
  }

  private normalizeStep(raw: Partial<Step>, index: number): Step {
    return {
      id: raw.id ?? crypto.randomUUID(),
      index,
      description: raw.description ?? "",
      tool: raw.tool,
      expectedOutput: raw.expectedOutput,
      status: "pending",
      retryCount: 0,
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn : undefined,
    };
  }

  private stripJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced && fenced[1]) return fenced[1].trim();
    return text.trim();
  }
}
