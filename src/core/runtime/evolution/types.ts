import { SkillDraft } from "@/infra/skills/draft";
import { SkillRegistryLike, TapeLike } from "@/types";
import { SessionId } from "@/types/brand";
import { AgentMessage } from "@mariozechner/pi-agent-core";
import { SkillValidator } from "@/core/runtime/skill/validator";
import { SkillRegistry } from "@/infra/skills/registry";
import { Learner } from "./learner";

export type ReflectionOutcomeStatus = "success" | "partial" | "failure"

export type Reflection = {
  sessionId: SessionId;
  task: string;
  outcome: ReflectionOutcomeStatus;
  whatWorked: string[];
  whatFailed: string[];
  reusableProcedure?: string;
  suggestedSkill?: SkillDraft;
}

export type LearnerDeps = {
  tape: TapeLike;
  skills: SkillRegistryLike;
  model:
    | { prompt(messages: AgentMessage[]): Promise<string> }
    | ((messages: AgentMessage[]) => Promise<string>);
}

export type EvolutionDeps = {
  learner: Learner;
  skillValidator: SkillValidator;
  skills: SkillRegistry;
  tape: TapeLike;
}
