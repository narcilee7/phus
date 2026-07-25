// src/channels/cli.ts
// CLI Channel — supports two modes:
//   - one-shot (default): read prompt from argv, send to agent, print response, exit
//   - interactive (chat command): line-buffered stdin REPL

import * as readline from "node:readline";
import { makeTextEnvelope } from "./base.js";
import type { ChannelAdapter } from "./base.js";
import type { PhusAgent } from "../bridge/pi-agent.js";
import { loadConfig } from "../infra/config/index.js";

export class CLIChannel implements ChannelAdapter {
  readonly name = "cli";
  private rl?: readline.Interface;

  listen(agent: PhusAgent): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "🪨 phus> ",
    });
    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const text = line.trim();
      if (!text) {
        this.rl?.prompt();
        return;
      }
      // Bub-style internal commands (comma prefix)
      if (text.startsWith(",")) {
        const { execute, initInternalCommands } = await import("../runtime/internal-commands/index.js");
        initInternalCommands({
          agent,
          home: () => loadConfig().paths.home,
        });
        const result = await execute(text, "cli");
        if (result !== null && result !== "not-a-command") {
          console.log(result);
        }
        if (text === ",quit") {
          this.rl?.close();
          return;
        }
        this.rl?.prompt();
        return;
      }
      if (text === "/quit" || text === "/exit") {
        this.rl?.close();
        return;
      }
      const envelope = makeTextEnvelope({
        from: "user",
        content: text,
        channel: "cli",
        metadata: { chatId: "default" },
        address: { channel: "cli", scope: "local", conversationKey: "default" },
        subjectId: "local",
        displayName: "local user",
      });
      try {
        await agent.turn(envelope, this);
      } catch (err: any) {
        console.error(`[phus] error: ${err?.message ?? err}`);
      }
      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      console.log("\n[phus] bye.");
      process.exit(0);
    });
  }

  async send(outbounds: import("@phus/core/types/channel/index.js").Outbound[]): Promise<void> {
    for (const msg of outbounds) {
      if (msg.type === "text") {
        console.log(`\n⛰️  ${msg.content}\n`);
      }
    }
  }

  close(): void {
    this.rl?.close();
  }
}

/** Run a single prompt through the agent and exit. Optional
 *  `profileName` overrides the active profile for this run. `sessionId`
 *  rebinds the initial Session so the turn targets a specific
 *  catalog row (used by `phus run --session <id>`). */
export async function runOnce(
  prompt: string,
  options: { profileName?: string; sessionId?: string } = {},
): Promise<void> {
 *  `profileName` overrides the active profile for this run. `sessionId`
 *  rebinds the initial Session so the turn targets a specific
 *  catalog row (used by `phus run --session <id>`). */
export async function runOnce(
  prompt: string,
  options: { profileName?: string; sessionId?: string } = {},
): Promise<void> {
  // Lazy import so `chat` mode doesn't pull in unused code paths.
  const { PhusAgent } = await import("../bridge/pi-agent.js");
  const handle = await PhusAgent.create(options.profileName ? { profileName: options.profileName } : {});
  const handle = await PhusAgent.create(options.profileName ? { profileName: options.profileName } : {});
  const agent = handle.agent;
  if (options.sessionId) {
    agent.setNextSessionId(options.sessionId as any);
  }
  if (options.sessionId) {
    agent.setNextSessionId(options.sessionId as any);
  }
  const channel = new CLIChannel();
  const envelope = makeTextEnvelope({
    from: "user",
    content: prompt,
    channel: "cli",
    metadata: { chatId: "default" },
    address: { channel: "cli", scope: "local", conversationKey: "default" },
    subjectId: "local",
    displayName: "local user",
  });
  const turn = await agent.turn(envelope, channel);

  const hasText = turn.outbound.some(
    (m) => m.type === "text" && m.content.trim().length > 0,
  );
  if (!hasText) {
    process.stderr.write(
      "\n⚠️  Agent returned no text. Common causes:\n" +
        "   • Wrong provider/modelId in $PHUS_HOME/phus.config.yaml\n" +
        "   • Missing or wrong API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY)\n" +
        "   • Wrong PHUS_PROFILE or --profile <name>\n" +
        "   • Provider rejected the request (check `phus logs --follow`)\n\n",
    );
  }

  await handle.dispose();
}
