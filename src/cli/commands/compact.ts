// src/cli/commands/compact.ts
// `phus compact <sessionId>` — manually compact a session's tape.

import type { Command } from "commander";
import { Tape } from "@/core/session/tape.js";
import { compactSession } from "@/core/session/compaction.js";
import { asSessionId } from "@/types/brand.js";
import { loadConfig } from "@/infra/config/index.js";

export function registerCompactCommand(program: Command): void {
  program
    .command("compact <sessionId>")
    .description("Compact a session's tape: summarize old turns into an anchor")
    .option("-k, --keep-recent <n>", "How many recent turns to keep", "10")
    .action(async (sessionId: string, opts: { keepRecent: string }) => {
      const tape = new Tape(loadConfig().paths.tapeDb);
      try {
        const result = await compactSession(tape, asSessionId(sessionId), {
          keepRecent: parseInt(opts.keepRecent, 10),
        });
        console.log(JSON.stringify(result, null, 2));
      } finally {
        tape.close();
      }
    });
}