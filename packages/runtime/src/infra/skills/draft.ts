import type { SessionId } from "@phus/core/types/brand.js";

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  trigger: string;
  sourceSessionId: string;
  verified: boolean;
  version: string;
  createdAt: number;
}

/** Minimal SkillRegistry surface for draft operations. */
export interface SkillDraftStore {
  writeDraft(draft: Omit<SkillDraft, "createdAt">): SkillDraft;
  getDraft(name: string): SkillDraft | undefined;
  getAllDrafts(): SkillDraft[];
  promoteDraft(name: string): import("@phus/core/types/skill.js").Skill | undefined;
  archiveDraft(name: string): void;
  discoverDrafts(): void;
}
