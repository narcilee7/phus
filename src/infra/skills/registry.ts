// src/core/skill.ts
// Skill discovery using Agent Skills standard: one skill = one directory
// containing a SKILL.md with YAML frontmatter. Body is a prompt guide,
// not executable code — the LLM reads it and uses tools to act.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { logger } from "@/infra/logging.js";
import { AuthorDefinition } from "@/types/enumTypes/index.js";
import { Skill } from "@/types/skill.js";
import type { SkillDraft } from "@/infra/skills/draft.js";

const SKILL_FILE = "SKILL.md";

const DRAFTS_DIR = "drafts";
const ARCHIVE_DIR = "archive";

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
  trigger?: string;
  sourceSessionId?: string;
  verified?: boolean;
  [key: string]: unknown;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private drafts = new Map<string, SkillDraft>();
  private roots: Array<RootItem>;

  /** `skillsDir` is required — callers get the path from `loadConfig().paths.skillsDir`. */
  constructor(
    skillsDir: string,
    extraRoots: Array<RootItem> = [],
  ) {
    fs.mkdirSync(skillsDir, { recursive: true });
    this.roots = [
      { dir: skillsDir, source: "user" },
      ...extraRoots,
    ];
    this.discover();
  }

  private get userDir(): string {
    return this.roots[0]!.dir;
  }

  private get draftsDir(): string {
    return path.join(this.userDir, DRAFTS_DIR);
  }

  private get archiveDir(): string {
    return path.join(this.userDir, ARCHIVE_DIR);
  }

  /** Scan all roots and load every <root>/<name>/SKILL.md. */
  discover(): void {
    this.skills.clear();
    for (const { dir, source } of this.roots) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Drafts and archives live in sub-directories and are loaded separately.
        if (entry.name === DRAFTS_DIR || entry.name === ARCHIVE_DIR) continue;
        const skill = this.loadOne(path.join(dir, entry.name), source);
        if (skill) this.skills.set(skill.name, skill);
      }
    }
    this.discoverDrafts();
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
    const dir = path.join(this.userDir, skill.name);
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

  // ─── Drafts ────────────────────────────────────────────────────

  /** Write a skill draft to <skillsDir>/drafts/<name>/SKILL.md. */
  writeDraft(draft: Omit<SkillDraft, "createdAt">): SkillDraft {
    fs.mkdirSync(this.draftsDir, { recursive: true });
    const dir = path.join(this.draftsDir, draft.name);
    fs.mkdirSync(dir, { recursive: true });
    const fm: Frontmatter = {
      name: draft.name,
      description: draft.description,
      author: "phus",
      version: draft.version,
      trigger: draft.trigger,
      sourceSessionId: draft.sourceSessionId,
      verified: draft.verified,
    };
    const filePath = path.join(dir, SKILL_FILE);
    const content = `---\n${yaml.stringify(fm).trim()}\n---\n\n${draft.body.trim()}\n`;
    fs.writeFileSync(filePath, content, "utf-8");
    const saved: SkillDraft = { ...draft, createdAt: Date.now() };
    this.drafts.set(saved.name, saved);
    return saved;
  }

  getDraft(name: string): SkillDraft | undefined {
    return this.drafts.get(name);
  }

  getAllDrafts(): SkillDraft[] {
    return Array.from(this.drafts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Promote a draft to a real skill. Returns the saved Skill or undefined if the draft did not exist. */
  promoteDraft(name: string): Skill | undefined {
    const draft = this.drafts.get(name);
    if (!draft) return undefined;

    const draftDir = path.join(this.draftsDir, name);
    const targetDir = path.join(this.userDir, name);
    fs.mkdirSync(targetDir, { recursive: true });
    const sourcePath = path.join(draftDir, SKILL_FILE);
    const targetPath = path.join(targetDir, SKILL_FILE);
    const raw = fs.readFileSync(sourcePath, "utf-8");
    const { fm, body } = splitFrontmatter(raw);
    const promotedFm: Frontmatter = {
      ...fm,
      name: draft.name,
      description: draft.description,
      verified: true,
      version: String(fm.version ?? draft.version).replace(/-draft$/, ""),
    };
    const content = `---\n${yaml.stringify(promotedFm).trim()}\n---\n\n${body.trim()}\n`;
    fs.writeFileSync(targetPath, content, "utf-8");
    fs.rmSync(draftDir, { recursive: true, force: true });
    this.drafts.delete(name);
    this.discover();
    return this.skills.get(name);
  }

  /** Archive a draft (moves <skillsDir>/drafts/<name> to <skillsDir>/archive/<name>). */
  archiveDraft(name: string): void {
    const draft = this.drafts.get(name);
    if (!draft) return;
    const draftDir = path.join(this.draftsDir, name);
    if (!fs.existsSync(draftDir)) return;
    fs.mkdirSync(this.archiveDir, { recursive: true });
    const targetDir = path.join(this.archiveDir, name);
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(draftDir, targetDir);
    this.drafts.delete(name);
  }

  /** Re-scan the drafts directory. Called automatically by discover(). */
  discoverDrafts(): void {
    this.drafts.clear();
    if (!fs.existsSync(this.draftsDir)) return;
    const entries = fs.readdirSync(this.draftsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const draft = this.loadDraft(path.join(this.draftsDir, entry.name));
      if (draft) this.drafts.set(draft.name, draft);
    }
  }

  private loadDraft(draftDir: string): SkillDraft | undefined {
    const filePath = path.join(draftDir, SKILL_FILE);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, "utf-8");
    const { fm, body } = splitFrontmatter(raw);
    if (!fm.name || !fm.description) {
      logger.warn("skill.invalid_draft_frontmatter", { path: draftDir, reason: "missing name or description" });
      return undefined;
    }
    return {
      name: fm.name,
      description: String(fm.description),
      body,
      trigger: String(fm.trigger ?? ""),
      sourceSessionId: String(fm.sourceSessionId ?? ""),
      verified: fm.verified === true,
      version: String(fm.version ?? "0.1.0-draft"),
      createdAt: fs.statSync(filePath).mtimeMs,
    };
  }

  /** Render skills as a section to inject into the system prompt. */
  toPromptContext(includeDrafts = false): string {
    const all = this.getAll();
    const sections: string[] = [];
    if (all.length === 0) {
      sections.push("(no skills yet — call skill_write to create one)");
    } else {
      sections.push(
        all
          .map(
            (s) =>
              `### ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})\n${s.description}`,
          )
          .join("\n\n"),
      );
    }

    if (includeDrafts) {
      const drafts = this.getAllDrafts();
      if (drafts.length > 0) {
        sections.push(
          "## Drafts (unverified)\n\n" +
            drafts
              .map((d) => `### ${d.name} (draft, v${d.version})\n${d.description}`)
              .join("\n\n"),
        );
      }
    }

    return sections.join("\n\n");
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
