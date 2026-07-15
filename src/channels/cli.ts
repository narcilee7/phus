// src/channels/cli.ts
// CLI Channel — supports two modes:
//   - one-shot (default): read prompt from argv, send to agent, print response, exit
//   - interactive (chat command): line-buffered stdin REPL

import * as readline from "node:readline";
import { makeTextEnvelope } from "@/channels/base.js";
import type { ChannelAdapter } from "@/channels/base.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";

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
        const { execute, initInternalCommands } = await import("@/core/internal-commands.js");
        initInternalCommands(() => agent, () => process.env.PHUS_HOME ?? "./.phus");
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

  async send(outbounds: import("@/types/channel/index.js").Outbound[]): Promise<void> {
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

/** Run a single prompt through the agent and exit. */
export async function runOnce(prompt: string): Promise<void> {
  // Lazy import so `chat` mode doesn't pull in unused code paths.
  const { PhusAgent } = await import("@/bridge/pi-agent.js");
  const agent = new PhusAgent();
  const channel = new CLIChannel();
  const envelope = makeTextEnvelope({
    from: "user",
    content: prompt,
    channel: "cli",
    metadata: { chatId: "default" },
  });
  await agent.turn(envelope, channel);
  const assistantTexts = agent._internal.piAgent.state.messages
    .filter((m) => m.role === "assistant")
    .map((m) => ({
      to: "default",
      content: extractText(m),
      type: "text" as const,
      channel: "cli",
    }));

  if (assistantTexts.every((m) => !m.content.trim())) {
    process.stderr.write(
      "\n⚠️  Agent returned no text. Common causes:\n" +
        "   • Wrong PHUS_MODEL_ID (gateway doesn't recognize the model name)\n" +
        "   • Wrong PHUS_BASE_URL or DEEPSEEK_API_KEY\n" +
        "   • Provider rejected the request (check `phus logs --follow`)\n\n",
    );
  }

  await channel.send(assistantTexts);
}

function extractText(msg: any): string {
  if (!msg || msg.role !== "assistant") return "";
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}
