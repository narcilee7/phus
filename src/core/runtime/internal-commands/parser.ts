// src/core/internal-commands/parser.ts
// Pure tokenizer + parser for `,foo key=val pos1 pos2 ...` lines.

import type { ParsedCommand } from "./types.js";

/**
 * Parse a command line into name + args + positional.
 *
 *   "help"                          → { name: "help", args: {}, positional: [] }
 *   "skill name=foo"                → { name: "skill", args: { name: "foo" }, positional: [] }
 *   "trace 10"                      → { name: "trace", args: {}, positional: ["10"] }
 *   'fs.write path=/tmp/x content="hi there"'  → args + positional ["hi there"]
 */
export function parse(line: string): ParsedCommand | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(",")) return null;
  const body = trimmed.slice(1).trim();
  if (!body) return null;

  const tokens = tokenize(body);
  if (tokens.length === 0) return null;

  const name = tokens[0]!;
  const args: Record<string, string> = {};
  const positional: string[] = [];
  let kwargDone = false;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const eq = tok.indexOf("=");
    if (eq > 0 && !kwargDone) {
      const key = tok.slice(0, eq);
      const val = stripQuotes(tok.slice(eq + 1));
      args[key] = val;
    } else {
      kwargDone = true;
      positional.push(stripQuotes(tok));
    }
  }
  return { name, args, positional };
}

/** Tokenize respecting single/double-quoted strings. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === " " && !inSingle && !inDouble) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}