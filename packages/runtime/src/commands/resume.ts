// src/commands/resume.ts
// `phus resume <sessionId>` — load the latest checkpoint and continue the turn.

import { PhusAgent } from "../bridge/pi-agent.js";
import { loadLatestCheckpoint, listCheckpoints } from "@phus/core/session/checkpoint.js";
import { CLIChannel } from "../channels/cli.js";
import { ExitCode, CliExit } from "@phus/runtime/core/runtime/executor/exit-code.js";
import { makeTextEnvelope } from "../channels/base.js";
import { logger } from "../infra/logging.js";
import { asSessionId, type SessionId } from "@phus/core/types/brand.js";
import type { Session } from "@phus/core/types/session/index.js";

function resolveSessionId(input: string, sessions: readonly Session[]): SessionId {
  if (input.includes(":")) {
    const [channel, ...rest] = input.split(":");
    const needle = rest.join(":");
    const match = sessions.find((s) =>
      s.origin.channel === channel && s.origin.conversationKey === needle
    );
    if (match) return match.id;
  }
  return asSessionId(input);
}

export async function resumeSession(sessionId: string, prompt: string): Promise<void> {
  const handle = await PhusAgent.create();
  let agent = handle.agent;
  try {
    const sessions = agent.listSessions({ includeArchived: true });
    const resolved = resolveSessionId(sessionId, sessions);
    const meta = agent.getSession(resolved);
    if (meta && (meta.status === "closed" || meta.status === "archived")) {
      throw new CliExit(
        ExitCode.PERMISSION_DENIED,
        `session ${resolved} is ${meta.status}; run \`phus reopen ${resolved}\` first`,
      );
    }

    const tape = handle.internals.tape;
    const cp = loadLatestCheckpoint(tape, resolved);
    if (!cp) {
      logger.error(`no checkpoint found for session "${sessionId}"`);
      const all = listCheckpoints(tape, resolved);
      if (all.length === 0) {
        logger.error(`(tape has no checkpoints for this session)`);
      }
      throw new CliExit(ExitCode.NOT_FOUND, "no checkpoint");
    }

    logger.info(
      `[phus] resuming session ${sessionId} from checkpoint (${cp.ts}, ${Array.isArray(cp.messages) ? cp.messages.length : 0} messages)`,
    );
    await agent.restoreCheckpoint(resolved);

    const channel = new CLIChannel();
    const address = meta?.origin
      ? {
          channel: meta.origin.channel,
          scope: meta.origin.scope,
          conversationKey: meta.origin.conversationKey,
          threadKey: meta.origin.threadKey,
        }
      : { channel: "cli", scope: "local", conversationKey: "default" };
    const envelope = makeTextEnvelope({
      from: "user",
      content: prompt || "(continuing from checkpoint)",
      channel: "cli",
      metadata: { chatId: "resume" },
      address,
    });
    await agent.turn(envelope, channel);
    logger.info("resume.completed", { sessionId, fromCheckpoint: cp.ts });
  } finally {
    await handle.dispose();
  }
}
