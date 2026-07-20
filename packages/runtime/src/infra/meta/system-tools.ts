// src/core/llm/meta/system-tools.ts
// Meta tools for runtime introspection + self-modification:
// startup_write, self_reflect, tape_stats, compact_session.

import { Type } from "@mariozechner/pi-ai";
import type { MetaTool } from "@phus/runtime/types/tool.js";
import type { SessionId } from "@phus/core/types/brand.js";
import { asSessionId } from "@phus/core/types/brand.js";
import { loadConfig } from "@/infra/config/index.js";
import { StartupAdvisor } from "@phus/core/runtime/startup/advisor";

export function defineSystemMetaTools(deps: {
  tape: { replay: (sessionId?: string) => Generator<unknown>; stats: () => unknown };
  compactSession: (
    tape: unknown,
    sessionId: SessionId,
    opts: { keepRecent?: number },
  ) => Promise<{ summarized: number; keptRecent: number }>;
  /** Concrete Tape instance — passed through to compactSession which types it concretely. */
  tapeConcrete: unknown;
}): MetaTool[] {
  return [
    {
      name: "startup_write",
      description:
        "Write startup.sh — a shell script that runs once when Phus boots in gateway mode. " +
        "Use this to set up cron jobs, fetch external state, warm caches, etc.",
      parameters: Type.Object({
        content: Type.String({ description: "Shell script content. Must be valid POSIX sh." }),
      }),
      execute: async (args) => {
        const home = loadConfig().paths.home;
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
        for (const entry of deps.tape.replay(sessionId)) {
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
      execute: async () => deps.tape.stats(),
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
        const sessionId = asSessionId(String(args.sessionId ?? "default"));
        const keepRecent = args.keepRecent ? Number(args.keepRecent) : 10;
        const result = await deps.compactSession(deps.tapeConcrete, sessionId, { keepRecent });
        return { ok: true, ...result };
      },
    },
    {
      name: "startup_suggest",
      description:
        "Analyze recent tape and plans and suggest additions to startup.sh. " +
        "Returns a proposed script but does NOT write it — use startup_write to apply.",
      parameters: Type.Object({}),
      execute: async () => {
        const advisor = new StartupAdvisor();
        const script = await advisor.suggestStartup(deps.tapeConcrete as unknown as import("@phus/core/types/hooks/index.js").TapeLike);
        return { ok: true, script };
      },
    },
  ];
}
