// test/prompt-assembly.test.ts
// Regression coverage for query-aware memory selection inside prompt assembly.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { buildContextBlock } from "@/bridge/prompt-assembly";
import { MemoryStore } from "@/infra/memory/store";
import type { TapeLike, SkillRegistryLike } from "@phus/core/types/hooks.js";

function makeTape(): TapeLike {
  return {
    append: () => {},
    replay: function* () {},
    summary: () => "",
    stats: () => ({ totalEntries: 0, sessions: {} }),
    loadAnchor: () => undefined,
  };
}

const skills: SkillRegistryLike = {
  discover: () => {},
  getAll: () => [],
  get: () => undefined,
  toPromptContext: () => "(no skills yet)",
};

describe("buildContextBlock", () => {
  it("passes the latest user query into memory selection", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-prompt-"));
    const memoryPath = path.join(dir, "phus.md");
    fs.writeFileSync(
      memoryPath,
      [
        "## Style",
        "",
        "Use Chinese for user-facing output.",
        "",
        "## Deploy",
        "",
        "Run the smoke tests before deployment.",
        "",
        "## Notes",
        "",
        "Keep memory concise.",
        "",
      ].join("\n"),
    );

    const memory = new MemoryStore(memoryPath);
    let systemPrompt = "";
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "How do I deploy this?" }],
        timestamp: Date.now(),
      },
    ] as unknown as AgentMessage[];

    try {
      await buildContextBlock(messages, {
        hooks: { execute: async () => undefined },
        tape: makeTape(),
        skills,
        memory,
        getContextWindow: () => undefined,
        getCurrentSessionId: () => undefined,
        setSystemPrompt: (prompt) => {
          systemPrompt = prompt;
        },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    expect(systemPrompt).toContain("## Project memory (selected for");
    expect(systemPrompt).toContain("## Deploy");
    expect(systemPrompt).not.toContain("## Style");
    expect(systemPrompt).not.toContain("## Notes");
  });
});
