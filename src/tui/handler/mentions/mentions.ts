// src/tui/mentions.ts
// Parse @-mentions in user input, read referenced files and build the
// context block that is injected into the agent prompt.

import { readFile } from "node:fs/promises";

export interface Mention {
  type: "file" | "skill" | "session";
  raw: string;
  target: string;
}

export interface FileContext {
  path: string;
  content: string;
  size: number;
}

/**
 * Extract @-mentions from text. Files are detected by the presence of a
 * path separator or a dot extension; `@skill/name` is treated as a skill
 * mention; everything else is currently treated as a file path.
 */
export function extractMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  const regex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const target = match[1];
    if (!target) continue;

    if (target.startsWith("skill/")) {
      mentions.push({ type: "skill", raw, target: target.slice(6) });
    } else if (target.includes("/") || target.includes("\\") || target.includes(".")) {
      mentions.push({ type: "file", raw, target });
    } else {
      // Default to file for now; session mentions can be added later.
      mentions.push({ type: "file", raw, target });
    }
  }
  return mentions;
}

/** Read a file mention from disk. */
export async function readFileMention(target: string): Promise<FileContext> {
  const content = await readFile(target, "utf-8");
  return { path: target, content, size: content.length };
}

/** Build the injected context block for the agent prompt. */
export function buildContextBlock(files: FileContext[]): string {
  if (files.length === 0) return "";
  const blocks = files.map((f) => `--- file: ${f.path} ---\n${f.content}`);
  return `<context>\n${blocks.join("\n---\n")}\n</context>`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
