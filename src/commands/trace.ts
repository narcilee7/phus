// src/commands/trace.ts
// `phus trace <sessionId>` — print a turn timeline for one session.

import Database from "better-sqlite3";

export interface TraceOptions {
  limit?: number;
  kind?: "turn" | "tool_call" | "tool_result" | "error" | "anchor";
  json?: boolean;
}

export function traceSession(dbPath: string, sessionId: string, opts: TraceOptions = {}): void {
  const db = new Database(dbPath, { readonly: true });

  const where: string[] = ["session_id = ?"];
  const params: unknown[] = [sessionId];
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  const limit = opts.limit ?? 50;

  const rows = db.prepare(
    `SELECT id, ts, kind, payload FROM tape WHERE ${where.join(" AND ")} ORDER BY ts ASC, id ASC LIMIT ?`,
  ).all(...params, limit) as Array<{ id: number; ts: number; kind: string; payload: string }>;

  db.close();

  if (rows.length === 0) {
    console.log(`(no entries for session "${sessionId}"${opts.kind ? `, kind="${opts.kind}"` : ""})`);
    return;
  }

  if (opts.json) {
    const out = rows.map((r) => ({ ...r, payload: safeParse(r.payload) }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  for (const row of rows) {
    const at = new Date(row.ts).toISOString().slice(11, 19);
    const payload = safeParse(row.payload);
    console.log(`[${at}] ${row.kind.padEnd(12)} ${summarize(payload)}`);
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}

function summarize(payload: any): string {
  if (!payload || typeof payload !== "object") return String(payload);
  switch (payload.kind) {
    case "turn": {
      const t = payload.turn;
      const u = (t.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
      const r = (t.modelOutput ?? "").slice(0, 60).replace(/\n/g, " ");
      return `${t.inbound.from}: ${u}  →  ${r}`;
    }
    case "tool_call":
      return `${payload.name}(${truncate(JSON.stringify(payload.args))})`;
    case "tool_result":
      return `isError=${payload.isError}  ${truncate(JSON.stringify(payload.result))}`;
    case "error":
      return `[${payload.stage}] ${payload.error}`;
    case "anchor":
      return payload.name;
    default:
      return truncate(JSON.stringify(payload));
  }
}

function truncate(s: string, n = 100): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
