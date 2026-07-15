// src/commands/resume.ts
// `phus resume <sessionId>` — load the latest checkpoint and continue the turn.

import { PhusAgent } from "@/bridge/pi-agent.js";
import { loadLatestCheckpoint, listCheckpoints } from "@/core/checkpoint.js";
import { CLIChannel } from "@/channels/cli.js";
import { ExitCode, CliExit } from "@/core/exit-codes.js";
import { makeTextEnvelope } from "@/channels/base.js";
import { logger } from "@/core/logger.js";

export async function resumeSession(sessionId: string, prompt: string): Promise<void> {
  const agent = new PhusAgent();
  const cp = loadLatestCheckpoint(agent._internal.tape, sessionId);
  if (!cp) {
    logger.error(`no checkpoint found for session "${sessionId}"`);
    const all = listCheckpoints(agent._internal.tape, sessionId);
    if (all.length === 0) {
      logger.error(`(tape has no checkpoints for this session)`);
    }
    throw new CliExit(ExitCode.NOT_FOUND, "no checkpoint");
  }

  logger.info(`[phus] resuming session ${sessionId} from checkpoint (${cp.ts}, ${Array.isArray(cp.messages) ? cp.messages.length : 0} messages)`);
  // Restore Pi's transcript
  agent._internal.piAgent.state.messages = cp.messages as any;

  // If user provided a follow-up prompt, send it; otherwise just continue
  const channel = new CLIChannel();
  const envelope = makeTextEnvelope({
    from: "user",
    content: prompt || "(continuing from checkpoint)",
    channel: "cli",
    metadata: { chatId: "resume" },
  });
  (agent as any)._currentSessionId = sessionId;
  (agent as any)._sessionOverride = sessionId;
  await agent.turn(envelope, channel);
  logger.info("resume.completed", { sessionId, fromCheckpoint: cp.ts });
}
