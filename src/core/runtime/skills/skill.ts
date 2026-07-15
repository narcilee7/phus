// src/core/skill.ts
// Skill discovery using Agent Skills standard: one skill = one directory
// containing a SKILL.md with YAML frontmatter. Body is a prompt guide,
// not executable code — the LLM reads it and uses tools to act.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { logger } from "@/core/runtime/logger.js";
import { AuthorDefinition } from "@/types/enumTypes/index.js";
import { Skill } from "@/types/skill.js";

const SKILL_FILE = "SKILL.md";
const SKILL_DIRS = process.env.PHUS_SKILLS_DIR || "./skills";

type SkillRootSource = "builtin" | "user" | "project"

type RootItem = {
  dir: string;
  source: SkillRootSource;
}

interface Frontmatter {
  name?: string;
  description?: string;
  author?: AuthorDefinition
  version?: string;
  [key: string]: unknown;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private roots: Array<RootItem>;

  constructor(
    skillsDir: string | undefined = SKILL_DIRS,
    extraRoots: Array<RootItem> = [],
  ) {
    fs.mkdirSync(skillsDir, { recursive: true });
    this.roots = [
      { dir: skillsDir, source: "user" },
      ...extraRoots,
    ];
    this.discover();
  }

  /** Scan all roots and load every <root>/<name>/SKILL.md. */
  discover(): void {
    this.skills.clear();
    for (const { dir, source } of this.roots) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skill = this.loadOne(path.join(dir, entry.name), source);
        if (skill) this.skills.set(skill.name, skill);
      }
    }
  }

  private loadOne(skillDir: string, source: SkillRootSource): Skill | undefined {
    const filePath = path.join(skillDir, SKILL_FILE);
    if (!fs.existsSync(filePath)) return undefined;

    const raw = fs.readFileSync(filePath, "utf-8");
    const { fm, body } = splitFrontmatter(raw);
    if (!fm.name || !fm.description) {
      logger.warn("skill.invalid_frontmatter", { path: skillDir, reason: "missing name or description" });
      return undefined;
    }

    return {
      name: fm.name,
      description: String(fm.description),
      body,
      location: path.resolve(skillDir),
      source,
      metadata: {
        author: fm.author,
        version: fm.version,
        ...fm,
      },
      createdAt: fs.statSync(filePath).mtimeMs,
    };
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Write a skill to the user skills dir. Returns the saved Skill. */
  write(skill: { name: string; description: string; body: string; metadata?: Record<string, unknown> }): Skill {
    const dir = path.join(this.roots[0]!.dir, skill.name);
    fs.mkdirSync(dir, { recursive: true });
    const fm: Frontmatter = {
      name: skill.name,
      description: skill.description,
      author: "phus",
      version: (skill.metadata?.version as string | undefined) ?? "0.1.0",
      ...skill.metadata,
    };
    const filePath = path.join(dir, SKILL_FILE);
    const content = `---\n${yaml.stringify(fm).trim()}\n---\n\n${skill.body.trim()}\n`;
    fs.writeFileSync(filePath, content, "utf-8");
    this.discover();
    return this.skills.get(skill.name)!;
  }

  delete(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    fs.rmSync(skill.location, { recursive: true, force: true });
    this.skills.delete(name);
    return true;
  }

  /** Render skills as a section to inject into the system prompt. */
  toPromptContext(): string {
    const all = this.getAll();
    if (all.length === 0) {
      return "(no skills yet — call skill_write to create one)";
    }
    return all
      .map(
        (s) =>
          `### ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})\n${s.description}`,
      )
      .join("\n\n");
  }
}

/** Split a SKILL.md file into YAML frontmatter and body. */
export function splitFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  let fm: Frontmatter = {};
  try {
    fm = (yaml.parse(m[1] ?? "") as Frontmatter) ?? {};
  } catch (err) {
    logger.warn("skill.frontmatter_parse_failed", { error: (err as Error).message });
  }
  return { fm, body: (m[2] ?? "").trim() };
}
