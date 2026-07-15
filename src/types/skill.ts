import { AuthorDefinition } from "@/types/enumTypes/index.js";

export type SkillSource = "builtin" | "user" | "project";

export interface SkillMetadata {
  author?: AuthorDefinition;
  version?: string;
  [key: string]: unknown;
}

/** Skill definition in Agent Skills standard (SKILL.md + frontmatter). */
export interface Skill {
  /** Skill name (must match directory name). */
  name: string;
  /** Short description used in system prompt. */
  description: string;
  /** Skill body — prompt guide the LLM reads, no executable code. */
  body: string;
  /** Absolute path to the skill directory. */
  location: string;
  /** Discovered source: builtin / user / project. */
  source: SkillSource;
  /** Frontmatter metadata (author, version, etc). */
  metadata: SkillMetadata;
  createdAt: number;
}
