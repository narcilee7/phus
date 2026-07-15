// src/bridge/text.ts
// Extract plain text from an assistant message's content blocks.

import type { AgentMessage } from "@mariozechner/pi-agent-core";

/** Returns the concatenated text content of an assistant message,
 *  or an empty string for any other shape. Pure: no side effects. */
export function extractText(msg: AgentMessage | undefined): string {
  if (!msg || msg.role !== "assistant") return "";
  const content = (msg as any).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}