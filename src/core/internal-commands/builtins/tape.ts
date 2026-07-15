// src/core/internal-commands/builtins/tape.ts
// ,tape / ,trace / ,sessions / ,use / ,compact — tape and session ops.

import { asSessionId } from "@/types/brand.js";
import type { InternalCommand, InternalCommandServices } from "../types.js";

export function defineTapeCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "tape",
      description: "tape statistics",
      handler: async () =>
        JSON.stringify((services.getAgent() as any)._internal.tape.stats(), null, 2),
    },
    {
      name: "trace",
      description: "show last n turns of current session",
      usage: "[n=5]",
      handler: async ({ args }) => {
        const n = parseInt(args.n ?? "5", 10) || 5;
        const agent = services.getAgent() as any;
        const sid = agent._currentSessionId ?? "default";
        const lines: string[] = [];
        const all = Array.from(agent._internal.tape.replay(sid)) as Array<{
          kind: string;
          turn?: any;
        }>;
        for (let i = all.length - 1; i >= 0 && lines.length < n; i--) {
          const e = all[i]!;
          if (e.kind === "turn" && e.turn) {
            const u = (e.turn.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
            lines.push(
              `  [${new Date(e.turn.ts).toISOString().slice(11, 19)}] ${e.turn.inbound.from}: ${u}`,
            );
          }
        }
        return lines.length ? lines.reverse().join("\n") : "(empty)";
      },
    },
    {
      name: "sessions",
      description: "list sessions in tape",
      handler: async () => {
        const s = (services.getAgent() as any)._internal.tape.stats();
        const entries = Object.entries(s.sessions) as Array<[string, number]>;
        const lines = entries
          .sort((a, b) => b[1] - a[1])
          .map(([sid, n]) => `  ${sid}  (${n} entries)`);
        return lines.length ? lines.join("\n") : "(no sessions)";
      },
    },
    {
      name: "use",
      description: "switch the active session id for the next turn",
      usage: "session=<sessionId>",
      handler: async ({ args }) => {
        const sid = args.session;
        if (!sid) return "usage: ,use session=<id>";
        (services.getAgent() as any)._sessionOverride = sid;
        return `✓ next turn will use session: ${sid}`;
      },
    },
    {
      name: "compact",
      description: "compact current session, keeping the most recent N turns",
      usage: "[keep=10]",
      handler: async ({ args }) => {
        const { compactSession } = await import("@/core/compaction.js");
        const keep = parseInt(args.keep ?? "10", 10) || 10;
        const agent = services.getAgent() as any;
        const rawSid = agent._sessionOverride ?? agent._currentSessionId ?? "default";
        const sid = asSessionId(rawSid);
        const r = await compactSession(agent._internal.tape, sid, { keepRecent: keep });
        return `compacted: summarized=${r.summarized}, kept=${r.keptRecent}`;
      },
    },
  ];
}