// src/core/drafts.ts
// Draft skill management.
//
// Skills written by the agent (via reflection or skill_write) first land in
// $PHUS_SKILLS_DIR/.drafts/<name>/SKILL.md and stay there until a human
// runs `,skill-review approve` (moves to skills/) or `,skill-review reject`
// (deletes the draft).

import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "yaml";
import { loadConfig } from "@/infra/config/index.js";

export interface Draft {
  name: string;
  description: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  /** When the draft was created (ts). */
  path: string;
}

export interface DraftsOptions {
  skillsDir?: string;
}

export class DraftsStore {
  private draftsDir: string;

  constructor(opts: DraftsOptions = {}) {
    const skillsDir = opts.skillsDir ?? loadConfig().paths.skillsDir;
    this.draftsDir = path.join(skillsDir, ".drafts");
  }

  /** Path to the .drafts/ directory under skillsDir. */
  get dir(): string {
    return this.draftsDir;
  }

  /** Write a draft to .drafts/<name>/SKILL.md. */
  async write(draft: Omit<Draft, "createdAt" | "path">): Promise<Draft> {
    await fs.mkdir(this.draftsDir, { recursive: true });
    const dir = path.join(this.draftsDir, draft.name);
    await fs.mkdir(dir, { recursive: true });
    const fm = {
      name: draft.name,
      description: draft.description,
      author: "ai",
      version: "0.1.0-draft",
      ...draft.metadata,
    };
    const filePath = path.join(dir, "SKILL.md");
    const content = `---\n${yaml.stringify(fm).trim()}\n---\n\n${draft.body.trim()}\n`;
    await fs.writeFile(filePath, content, "utf-8");
    return { ...draft, createdAt: Date.now(), path: filePath };
  }

  /** List all drafts. */
  async list(): Promise<Draft[]> {
    try {
      await fs.mkdir(this.draftsDir, { recursive: true });
      const entries = await fs.readdir(this.draftsDir, { withFileTypes: true });
      const drafts: Draft[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const filePath = path.join(this.draftsDir, e.name, "SKILL.md");
        try {
          const raw = await fs.readFile(filePath, "utf-8");
          const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
          if (!m) continue;
          const fm = (yaml.parse(m[1] ?? "") as Record<string, unknown>) ?? {};
          drafts.push({
            name: String(fm.name ?? e.name),
            description: String(fm.description ?? ""),
            body: (m[2] ?? "").trim(),
            metadata: fm,
            createdAt: (await fs.stat(filePath)).mtimeMs,
            path: filePath,
          });
        } catch {
          // skip unreadable drafts
        }
      }
      return drafts.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /** Get one draft by name. */
  async get(name: string): Promise<Draft | undefined> {
    const all = await this.list();
    return all.find((d) => d.name === name);
  }

  /** Approve a draft: move to skills/<name>/ and remove from drafts. Returns the new skill path. */
  async approve(name: string): Promise<string> {
    const draft = await this.get(name);
    if (!draft) throw new Error(`draft not found: ${name}`);
    const target = path.join(path.dirname(this.draftsDir), name);
    await fs.mkdir(target, { recursive: true });
    // Read current draft content (with frontmatter) and write to skills/
    const content = await fs.readFile(draft.path, "utf-8");
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const body = content.replace(/^---[\s\S]*?---\s*\n?/, "");
    const finalFm = fm
      ? yaml.parse(fm[1] ?? "")
      : { name, description: draft.description };
    // Bump version from 0.1.0-draft → 0.1.0
    if (finalFm.version && String(finalFm.version).endsWith("-draft")) {
      finalFm.version = String(finalFm.version).replace(/-draft$/, "");
    }
    finalFm.author = "human"; // human-approved
    const outPath = path.join(target, "SKILL.md");
    const out = `---\n${yaml.stringify(finalFm).trim()}\n---\n\n${body.trim()}\n`;
    await fs.writeFile(outPath, out, "utf-8");
    // Remove draft
    await fs.rm(path.dirname(draft.path), { recursive: true, force: true });
    return outPath;
  }

  /** Reject a draft: delete the .drafts/<name>/ folder. */
  async reject(name: string): Promise<boolean> {
    const draft = await this.get(name);
    if (!draft) return false;
    await fs.rm(path.dirname(draft.path), { recursive: true, force: true });
    return true;
  }
}
