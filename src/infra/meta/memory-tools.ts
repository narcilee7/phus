// src/infra/meta/memory-tools.ts
// Meta tools for project memory: memory_read, memory_write.
//
// The autonomy gate is enforced by the TUI permission handler (which
// has UI context) — see `src/tui/App.tsx`. `memory_write.execute`
// trusts that approval already happened at the handler layer and just
// applies the action + writes a tape entry.

import { Type } from "@mariozechner/pi-ai";
import type { MetaTool } from "@/types/tool.js";
import { asSessionId, type SessionId } from "@/types/brand.js";
import type { Tape } from "@/core/session/tape.js";
import type { MemoryStore, MemoryAction } from "@/infra/memory/index.js";

const actionSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("append"),
    section: Type.String({ description: "Section heading, e.g. 'Style' or '## Style'. Created if missing." }),
    body: Type.String({ description: "Markdown body to append under the section." }),
  }),
  Type.Object({
    kind: Type.Literal("replace"),
    section: Type.String({ description: "Section heading to replace in full." }),
    body: Type.String({ description: "New body for the section." }),
  }),
  Type.Object({
    kind: Type.Literal("delete"),
    section: Type.String({ description: "Section heading to remove." }),
  }),
]);

/** Returned by `memory_write.execute` for the TUI to render a diff
 *  preview in the PermissionBar (preview path) and to log to tape. */
export interface MemoryWriteResult {
  ok: true;
  path: string;
  action: MemoryAction;
  reason: string;
  diff: string;
  autonomyDecision: "auto" | "approve";
}

/** Validate + coerce the raw args into a typed `MemoryAction`. Throws
 *  on shape mismatch — surfaces as a tool error to the LLM. */
export function parseMemoryAction(raw: unknown): MemoryAction {
  if (!raw || typeof raw !== "object") {
    throw new Error("memory_write: missing action");
  }
  const a = raw as Record<string, unknown>;
  const kind = a.kind;
  const section = typeof a.section === "string" ? a.section.trim() : "";
  if (!section) throw new Error("memory_write: action.section is required");
  switch (kind) {
    case "append":
    case "replace": {
      const body = typeof a.body === "string" ? a.body : "";
      if (!body.trim()) throw new Error(`memory_write: action.body is required for ${kind}`);
      return { kind, section, body };
    }
    case "delete":
      return { kind, section };
    default:
      throw new Error(`memory_write: unknown action.kind "${String(kind)}"`);
  }
}

export function defineMemoryMetaTools(deps: {
  store: MemoryStore;
  tape: Tape;
  /** Session id to stamp onto the `memory_write` tape entry. Falls back
   *  to `"default"` if not provided — callers should always set it. */
  getCurrentSessionId?: () => SessionId | undefined;
}): MetaTool[] {
  return [
    {
      name: "memory_read",
      description:
        "Read the project's memory file (phus.md). Returns the full raw content " +
        "and a parsed sections map. Read-only — no permission required.",
      parameters: Type.Object({
        /** Optional section heading to read only one section; omit for full content. */
        section: Type.Optional(Type.String()),
      }),
      execute: async (args) => {
        const section = typeof args.section === "string" ? args.section.trim() : "";
        const { raw, sections } = deps.store.read();
        if (!section) {
          return { ok: true, path: deps.store.filePath, raw, sections };
        }
        // Accept "Style" / "## Style" / "# Style".
        const canonical = section.startsWith("#") ? section : `## ${section}`;
        const body = sections[canonical];
        if (body === undefined) {
          return { ok: false, error: "section_not_found", section: canonical };
        }
        return { ok: true, path: deps.store.filePath, section: canonical, body };
      },
    },
    {
      name: "memory_write",
      description:
        "Update the project's memory file (phus.md). The TUI will show a diff " +
        "preview and ask for approval unless the autonomy mode is yolo or the " +
        "action kind is in memory.autoApprove. Always provide a `reason` so the " +
        "user can decide whether to allow.",
      parameters: Type.Object({
        action: actionSchema,
        reason: Type.String({
          description: "Why this change? Shown in the permission prompt and written to tape.",
        }),
      }),
      execute: async (args): Promise<MemoryWriteResult> => {
        const action = parseMemoryAction(args.action);
        const reason = String(args.reason ?? "").trim() || "(no reason given)";

        const result = deps.store.apply(action);
        if (!result.ok) {
          throw new Error(result.reason);
        }

        const sid = deps.getCurrentSessionId?.() ?? asSessionId("default");
        const tapeEntry = {
          kind: "memory_write" as const,
          sessionId: sid,
          action,
          reason,
          diff: result.diff,
          // Per-call decision is recorded as "auto" here — the TUI handler
          // is responsible for the user-facing approve/deny gate, and at the
          // point this executes the user already said yes (or the gate is yolo).
          autonomyDecision: "auto" as const,
          ts: Date.now(),
        };
        try {
          deps.tape.append(tapeEntry as unknown as Parameters<Tape["append"]>[0]);
        } catch {
          // Tape failure shouldn't fail the write — memory store already succeeded.
        }

        return {
          ok: true,
          path: result.path,
          action,
          reason,
          diff: result.diff,
          autonomyDecision: "auto",
        };
      },
    },
  ];
}
