import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillRegistry } from "../src/infra/skills/registry.js";

function draftInput(name: string) {
  return {
    name,
    description: "A test draft",
    body: "## Steps\n1. Do something useful.",
    trigger: "when testing drafts",
    sourceSessionId: "session-1",
    verified: false,
    version: "0.1.0-draft",
  };
}

describe("SkillRegistry drafts", () => {
  let dir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-skill-draft-"));
    registry = new SkillRegistry(dir);
  });

  it("writes and reads a draft", () => {
    const draft = registry.writeDraft(draftInput("my-draft"));
    expect(draft.createdAt).toBeGreaterThan(0);

    const found = registry.getDraft("my-draft");
    expect(found?.name).toBe("my-draft");
    expect(found?.description).toBe("A test draft");

    expect(registry.getAllDrafts()).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "drafts", "my-draft", "SKILL.md"))).toBe(true);
  });

  it("promotes a draft to a real skill", () => {
    registry.writeDraft(draftInput("promote-me"));
    const skill = registry.promoteDraft("promote-me");

    expect(skill).toBeDefined();
    expect(registry.get("promote-me")?.name).toBe("promote-me");
    expect(registry.getDraft("promote-me")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "promote-me", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "drafts", "promote-me"))).toBe(false);
  });

  it("archives a draft", () => {
    registry.writeDraft(draftInput("archive-me"));
    registry.archiveDraft("archive-me");

    expect(registry.getDraft("archive-me")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "archive", "archive-me", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "drafts", "archive-me"))).toBe(false);
  });

  it("toPromptContext does not include drafts by default", () => {
    registry.writeDraft(draftInput("hidden"));
    const ctx = registry.toPromptContext();
    expect(ctx).not.toContain("hidden");
  });

  it("toPromptContext can include drafts", () => {
    registry.writeDraft(draftInput("visible"));
    const ctx = registry.toPromptContext(true);
    expect(ctx).toContain("visible");
    expect(ctx).toContain("Drafts");
  });
});
