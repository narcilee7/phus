// ─── Memory write preview helpers ─────────────────────────────────
// Short caption used in the permission prompt header:

import { parseMemoryAction } from "@/infra/meta";

//   "memory_write? (append 'Style')" / "memory_write? (replace 'Style')" / "memory_write? (delete 'Style')"
export function describeMemoryAction(rawArgs: unknown): string | undefined {
  try {
    const action = parseMemoryAction((rawArgs as { action?: unknown })?.action);
    const heading = action.section.startsWith("#") ? action.section : `## ${action.section}`;
    const verb = action.kind === "append" ? "append to"
      : action.kind === "replace" ? "replace"
      : "delete";
    return `${verb} ${heading}`;
  } catch {
    return undefined;
  }
}

// Compact diff preview shown in the permission body. Kept to a few
// lines so the permission bar stays one terminal-row tall.
export function buildMemoryPreview(rawArgs: unknown): string | undefined {
  try {
    const args = (rawArgs ?? {}) as { action?: unknown; reason?: unknown };
    const action = parseMemoryAction(args.action);
    const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : "(no reason)";
    const heading = action.section.startsWith("#") ? action.section : `## ${action.section}`;
    const lines: string[] = [`reason: ${reason}`, ""];
    if (action.kind === "append") {
      lines.push(`+ ${heading}`);
      for (const ln of action.body.split("\n")) lines.push(`  + ${ln}`);
    } else if (action.kind === "replace") {
      lines.push(`~ ${heading}`);
      for (const ln of action.body.split("\n")) lines.push(`  ${ln}`);
    } else {
      lines.push(`- ${heading}`);
      lines.push("  (removed)");
    }
    return lines.slice(0, 10).join("\n");
  } catch {
    return undefined;
  }
}
