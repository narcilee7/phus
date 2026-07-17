import { SessionId } from "@/types/brand";
import { LearnerDeps, Reflection } from "./types";
import { AgentMessage } from "@mariozechner/pi-agent-core";
import { SkillDraft } from "@/infra/skills/draft";

export class Learner {
  constructor(private deps: LearnerDeps) {}

  async reflect(
    sessionId: SessionId,
    task: string,
    outcome?: Reflection["outcome"],
  ): Promise<Reflection> {
    const entries = this.collectEntries(sessionId);
    const prompt = this.buildPrompt(sessionId, task, outcome, entries);

    const call = typeof this.deps.model === "function"
      ? this.deps.model
      : this.deps.model.prompt.bind(this.deps.model);
    const response = await call(prompt);

    const parsed = this.parseResponse(response, sessionId, task);
    return parsed;
  }

  private collectEntries(sessionId: SessionId): unknown[] {
    const out: unknown[] = [];
    for (const entry of this.deps.tape.replay(sessionId)) {
      out.push(entry);
    }
    return out;
  }

  private buildPrompt(
    sessionId: SessionId,
    task: string,
    outcome: Reflection["outcome"] | undefined,
    entries: unknown[],
  ): AgentMessage[] {
    const recent = entries.slice(-20);
    const outcomeHint = outcome
      ? `The known outcome is: ${outcome}.`
      : "Infer the outcome from the tape entries.";

    const text = [
      "You are a reflective learner. Analyze the session tape below and produce a structured reflection.",
      "",
      `Task: ${task}`,
      `Session: ${sessionId}`,
      outcomeHint,
      "",
      "Output a JSON object with these fields:",
      '- "outcome": one of "success", "partial", "failure"',
      '- "whatWorked": array of short strings describing what went well',
      '- "whatFailed": array of short strings describing problems, errors, or gaps',
      '- "reusableProcedure": optional string describing a reusable step-by-step procedure',
      '- "suggestedSkill": optional object with { name, description, body, trigger }. Only include this if a genuinely reusable procedure was identified.',
      "",
      "Available skills:",
      this.deps.skills.toPromptContext(),
      "",
      "Recent tape entries:",
      JSON.stringify(recent, null, 2),
      "",
      "Output only the JSON object, no markdown fences.",
    ].join("\n");

    return [
      {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      },
    ];
  }

  private parseResponse(response: string, sessionId: SessionId, task: string): Reflection {
    const cleaned = response.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
    const fallback: Reflection = {
      sessionId,
      task,
      outcome: "partial",
      whatWorked: [],
      whatFailed: ["could not parse learner response"],
    };

    try {
      const parsed = JSON.parse(cleaned) as Partial<Reflection> & {
        suggestedSkill?: Partial<SkillDraft>;
      };
      const suggestedSkill = this.normalizeSkillDraft(parsed.suggestedSkill, sessionId);

      return {
        sessionId,
        task,
        outcome: this.normalizeOutcome(parsed.outcome),
        whatWorked: this.normalizeStringArray(parsed.whatWorked),
        whatFailed: this.normalizeStringArray(parsed.whatFailed),
        reusableProcedure:
          typeof parsed.reusableProcedure === "string" && parsed.reusableProcedure.trim()
            ? parsed.reusableProcedure.trim()
            : undefined,
        suggestedSkill,
      };
    } catch {
      return fallback;
    }
  }

  private normalizeOutcome(raw: unknown): Reflection["outcome"] {
    if (raw === "success" || raw === "partial" || raw === "failure") return raw;
    return "partial";
  }

  private normalizeStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string");
  }

  private normalizeSkillDraft(
    raw: Partial<SkillDraft> | undefined,
    sessionId: SessionId,
  ): SkillDraft | undefined {
    if (!raw) return undefined;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (!name || !description || !body) return undefined;

    return {
      name,
      description,
      body,
      trigger: typeof raw.trigger === "string" ? raw.trigger.trim() : `Use when the task resembles: ${description}`,
      sourceSessionId: typeof raw.sourceSessionId === "string" ? raw.sourceSessionId : sessionId,
      verified: false,
      version: typeof raw.version === "string" ? raw.version : "0.1.0-draft",
      createdAt: Date.now(),
    };
  }
}
