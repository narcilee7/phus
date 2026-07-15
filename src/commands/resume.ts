// src/commands/resume.ts
// `phus resume <sessionId>` — load the latest checkpoint and continue the turn.

import { PhusAgent } from "@/bridge/pi-agent.js";
import { loadLatestCheckpoint, listCheckpoints } from "@/core/checkpoint.js";
import { CLIChannel } from "@/channels/cli.js";
import { ExitCode, CliExit } from "@/core/exit-codes.js";
import { makeTextEnvelope } from "@/channels/base.js";
import { logger } from "@/core/logger.js";
import { asSessionId } from "@/types/brand.js";

export async function resumeSession(sessionId: string, prompt: string): Promise<void> {
  const branded = asSessionId(sessionId);
  const handle = await PhusAgent.create(); const agent = handle.agent;
  const cp = loadLatestCheckpoint(handle.internals._internal.tape, branded);
  if (!cp) {
    logger.error(`no checkpoint found for session "${sessionId}"`);
    const all = listCheckpoints(handle.internals._internal.tape, branded);
    if (all.length === 0) {
      logger.error(`(tape has no checkpoints for this session)`);
    }
    throw new CliExit(ExitCode.NOT_FOUND, "no checkpoint");
  }

  logger.info(`[phus] resuming session ${sessionId} from checkpoint (${cp.ts}, ${Array.isArray(cp.messages) ? cp.messages.length : 0} messages)`);
  // Restore Pi's transcript
  handle.internals._internal.piAgent.state.messages = cp.messages as any;

  // If user provided a follow-up prompt, send it; otherwise just continue
  const channel = new CLIChannel();
  const envelope = makeTextEnvelope({
    from: "user",
    content: prompt || "(continuing from checkpoint)",
    channel: "cli",
    metadata: { chatId: "resume" },
  });
  (handle.internals as any)._currentSessionId = sessionId;
  (handle.internals as any)._sessionOverride = sessionId;
  await agent.turn(envelope, channel);
  await handle.dispose();
  logger.info("resume.completed", { sessionId, fromCheckpoint: cp.ts });
}
