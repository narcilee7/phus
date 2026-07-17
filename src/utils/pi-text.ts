import type { AgentMessage } from "@mariozechner/pi-agent-core";

export const extractText = (msg?: AgentMessage): string => {
  if (!msg || msg.role !== "assistant") return "";
  const content = (msg as any).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}
