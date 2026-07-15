// test/drafts.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DraftsStore } from "../src/core/session/drafts.js";

describe("DraftsStore", () => {
  let dir: string;
  let store: DraftsStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-drafts-"));
    store = new DraftsStore({ skillsDir: path.join(dir, "skills") });
  });

  it("write creates a draft file", async () => {
    await store.write({
      name: "my-skill",
      description: "does something",
      body: "# Steps\n1. do X",
      metadata: {},
    });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("my-skill");
    expect(list[0]?.path).toContain(".drafts/my-skill/SKILL.md");
  });

  it("list returns empty when no drafts", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("get returns one draft by name", async () => {
    await store.write({ name: "alpha", description: "a", body: "x", metadata: {} });
    await store.write({ name: "beta", description: "b", body: "y", metadata: {} });
    const a = await store.get("alpha");
    expect(a?.description).toBe("a");
    expect(a?.body).toBe("x");
  });

  it("approve moves draft to skills/ and strips -draft version", async () => {
    await store.write({
      name: "ship-it",
      description: "deploy workflow",
      body: "# Deploy\nrun deploy.sh",
      metadata: { version: "0.1.0-draft" },
    });
    const newPath = await store.approve("ship-it");
    expect(newPath).toContain("skills/ship-it/SKILL.md");

    // Drafts gone, skills file exists
    expect(await store.list()).toHaveLength(0);
    const skillContent = fs.readFileSync(newPath, "utf-8");
    expect(skillContent).toContain("deploy workflow");
    expect(skillContent).not.toContain("0.1.0-draft");
    expect(skillContent).toContain("0.1.0");
    expect(skillContent).toContain("author: human");
  });

  it("reject deletes the draft", async () => {
    await store.write({ name: "tmp", description: "trash", body: "x", metadata: {} });
    expect(await store.list()).toHaveLength(1);
    const ok = await store.reject("tmp");
    expect(ok).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("reject on nonexistent returns false", async () => {
    expect(await store.reject("nope")).toBe(false);
  });

  it("approve on nonexistent throws", async () => {
    await expect(store.approve("nope")).rejects.toThrow();
  });
});
