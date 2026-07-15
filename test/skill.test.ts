// test/skill.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillRegistry, splitFrontmatter } from "../src/core/runtime/skills/skill.js";

describe("SkillRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skills-"));
  });

  it("discovers skills from one-directory-per-skill layout", () => {
    const greetDir = path.join(dir, "greet");
    fs.mkdirSync(greetDir);
    fs.writeFileSync(path.join(greetDir, "SKILL.md"), `---
name: greet
description: Say hello in a friendly way.
---
# Greet
Be warm and welcoming.`);

    const skillsDir = path.join(dir, "skills");
    fs.mkdirSync(skillsDir);
    fs.mkdirSync(path.join(skillsDir, "greet"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "greet", "SKILL.md"),
      `---
name: greet
description: Say hello in a friendly way.
author: human
version: 1.0.0
---
# Greet body`,
    );

    const reg = new SkillRegistry(skillsDir);
    const all = reg.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("greet");
    expect(all[0]?.description).toContain("friendly");
    expect(all[0]?.metadata.author).toBe("human");
    expect(all[0]?.body).toContain("Greet body");
  });

  it("write() creates a new skill and re-discovers", () => {
    const skillsDir = path.join(dir, "skills");
    const reg = new SkillRegistry(skillsDir);
    reg.write({ name: "echo", description: "Echo input back.", body: "Repeat the user's message." });

    const all = reg.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("echo");

    const onDisk = fs.readFileSync(path.join(skillsDir, "echo", "SKILL.md"), "utf-8");
    expect(onDisk).toContain("name: echo");
    expect(onDisk).toContain("description: Echo input back.");
    expect(onDisk).toContain("Repeat the user's message.");
  });

  it("delete() removes the skill directory", () => {
    const skillsDir = path.join(dir, "skills");
    const reg = new SkillRegistry(skillsDir);
    reg.write({ name: "tmp", description: "temporary", body: "x" });
    expect(reg.getAll()).toHaveLength(1);
    const ok = reg.delete("tmp");
    expect(ok).toBe(true);
    expect(reg.getAll()).toHaveLength(0);
  });

  it("toPromptContext() formats skills as markdown", () => {
    const skillsDir = path.join(dir, "skills");
    const reg = new SkillRegistry(skillsDir);
    reg.write({ name: "a", description: "alpha", body: "x" });
    reg.write({ name: "b", description: "beta", body: "y" });
    const out = reg.toPromptContext();
    expect(out).toContain("### a");
    expect(out).toContain("### b");
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("toPromptContext() returns hint when no skills exist", () => {
    const skillsDir = path.join(dir, "skills");
    const reg = new SkillRegistry(skillsDir);
    expect(reg.toPromptContext()).toContain("skill_write");
  });
});

describe("splitFrontmatter", () => {
  it("splits YAML frontmatter from body", () => {
    const raw = `---
name: foo
description: bar
---

# Body`;
    const { fm, body } = splitFrontmatter(raw);
    expect(fm.name).toBe("foo");
    expect(fm.description).toBe("bar");
    expect(body).toContain("Body");
  });

  it("returns empty frontmatter for plain markdown", () => {
    const { fm, body } = splitFrontmatter("just body");
    expect(fm).toEqual({});
    expect(body).toBe("just body");
  });
});
