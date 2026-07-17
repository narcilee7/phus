// src/core/internal-commands/builtins/tape.ts
// ,tape / ,trace / ,sessions / ,use / ,compact — tape and session ops.

import type { InternalCommand, InternalCommandServices } from "../types";

export function defineTapeCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "tape",
      description: "tape statistics",
      handler: async () =>
        JSON.stringify(services.agent.getTapeStats(), null, 2),
    },
    {
      name: "trace",
      description: "show last n turns of current session",
      usage: "[n=5]",
      handler: async ({ args }) => {
        const n = parseInt(args.n ?? "5", 10) || 5;
        const sid = services.agent.getCurrentSessionId();
        const lines: string[] = [];
        const all = Array.from(services.agent.replayTape(sid));
        for (let i = all.length - 1; i >= 0 && lines.length < n; i--) {
          const e = all[i]!;
          if (e.kind === "turn" && (e as any).turn) {
            const t = (e as any).turn;
            const u = (t.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
            lines.push(
              `  [${new Date(t.ts).toISOString().slice(11, 19)}] ${t.inbound.from}: ${u}`,
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
        const s = services.agent.getTapeStats();
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
        services.agent.setNextSessionId(sid as any);
        return `✓ next turn will use session: ${sid}`;
      },
    },
    {
      name: "compact",
      description: "compact current session, keeping the most recent N turns",
      usage: "[keep=10]",
      handler: async ({ args }) => {
        const keep = parseInt(args.keep ?? "10", 10) || 10;
        try {
          return await services.agent.compactCurrentSession();
        } catch (err: any) {
          return `compact failed: ${err.message}`;
        }
      },
    },
  ];
}
