// src/core/meta.ts
// Meta Tools — let the agent modify itself: write/read/delete skills,
// write startup.sh, reflect on past turns, query tape stats.

import { Type } from "@mariozechner/pi-ai";
import type { SkillRegistry } from "@/core/skills/skill.js";
import type { Tape } from "@/core/tape.js";
import { MetaTool } from "@/types/tool.js";
import { asSessionId } from "@/types/brand.js";

export function createMetaTools(skills: SkillRegistry, tape: Tape): MetaTool[] {
  return [
    {
      name: "skill_write",
      description:
        "Create or update a skill. Body is a prompt guide the agent reads at runtime — not executable code. " +
        "The skill becomes immediately available in the system prompt.",
      parameters: Type.Object({
        name: Type.String({ description: "Skill name in kebab-case. Must match directory name." }),
        description: Type.String({ description: "One-line description shown in the system prompt." }),
        body: Type.String({ description: "Markdown body — instructions the agent reads when the skill is invoked." }),
        metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
      }),
      execute: async (args) => {
        const name = String(args.name);
        const description = String(args.description);
        const body = String(args.body);
        const metadata = (args.metadata as Record<string, unknown> | undefined) ?? {};
        const saved = skills.write({ name, description, body, metadata });
        return { ok: true, path: saved.location };
      },
    },
    {
      name: "skill_read",
      description: "Read an existing skill's full body and metadata.",
      parameters: Type.Object({
        name: Type.String(),
      }),
      execute: async (args) => {
        const skill = skills.get(String(args.name));
        if (!skill) return { ok: false, error: "skill_not_found" };
        return { ok: true, skill };
      },
    },
    {
      name: "skill_delete",
      description: "Remove a skill from disk permanently.",
      parameters: Type.Object({
        name: Type.String(),
      }),
      execute: async (args) => {
        const removed = skills.delete(String(args.name));
        return { ok: removed };
      },
    },
    {
      name: "startup_write",
      description:
        "Write startup.sh — a shell script that runs once when Phus boots in gateway mode. " +
        "Use this to set up cron jobs, fetch external state, warm caches, etc.",
      parameters: Type.Object({
        content: Type.String({ description: "Shell script content. Must be valid POSIX sh." }),
      }),
      execute: async (args) => {
        const home = process.env.PHUS_HOME ?? "./.phus";
        const fs = await import("node:fs");
        const path = await import("node:path");
        fs.mkdirSync(home, { recursive: true });
        const file = path.join(home, "startup.sh");
        fs.writeFileSync(file, String(args.content), "utf-8");
        fs.chmodSync(file, 0o755);
        return { ok: true, path: file };
      },
    },
    {
      name: "self_reflect",
      description: "Read your own past turns from the tape. Use to remember context across long sessions.",
      parameters: Type.Object({
        sessionId: Type.Optional(Type.String({ description: "Filter to one session. Omit for all." })),
        limit: Type.Optional(Type.Number({ description: "Max entries to return. Default 10." })),
      }),
      execute: async (args) => {
        const sessionId = args.sessionId ? String(args.sessionId) : undefined;
        const limit = Number(args.limit ?? 10);
        const out: unknown[] = [];
        for (const entry of tape.replay(sessionId)) {
          out.push(entry);
          if (out.length >= limit) break;
        }
        return { ok: true, entries: out.slice(-limit) };
      },
    },
    {
      name: "tape_stats",
      description: "Get statistics about the tape: total entries and per-session counts.",
      parameters: Type.Object({}),
      execute: async () => tape.stats(),
    },
    {
      name: "compact_session",
      description:
        "Manually compact the current session's tape. Summarizes older turns " +
        "into an anchor and keeps the most recent turns intact. Use when the " +
        "session is getting long and you want to preserve context without " +
        "consuming tokens on raw history.",
      parameters: Type.Object({
        sessionId: Type.Optional(Type.String({ description: "Session to compact. Defaults to current." })),
        keepRecent: Type.Optional(Type.Number({ description: "How many recent turns to keep. Default 10." })),
      }),
      execute: async (args) => {
        // Lazy import to avoid circular deps at module load.
        const { compactSession } = await import("@/core/compaction.js");
        const sessionId = asSessionId(String(args.sessionId ?? "default"));
        const keepRecent = args.keepRecent ? Number(args.keepRecent) : 10;
        // Use deterministic summarization when invoked from inside the agent
        // (recursive LLM call would be costly and confusing).
        const result = await compactSession(tape, sessionId, { keepRecent });
        return { ok: true, ...result };
      },
    },
  ];
}
