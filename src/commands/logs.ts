// src/commands/logs.ts
// `phus logs` — query the structured JSON log file.
// Supports --follow (tail -f style), --session, --level, --event, --limit.

import * as fs from "node:fs";
import * as readline from "node:readline";
import type { LogEvent, LogLevel } from "@/infra/logging.js";

export interface LogsOptions {
  follow?: boolean;
  session?: string;
  level?: LogLevel;
  event?: string;
  limit?: number;
  json?: boolean;
}

export async function tailLogs(file: string, opts: LogsOptions = {}): Promise<void> {
  if (!fs.existsSync(file)) {
    console.error(`No log file at ${file}. Set PHUS_LOG_FILE or run phus at least once.`);
    return;
  }

  const matches = (e: LogEvent) => {
    if (opts.session && e.sessionId !== opts.session) return false;
    if (opts.level && !levelAtLeast(e.level, opts.level)) return false;
    if (opts.event && e.event !== opts.event) return false;
    return true;
  };

  const emit = (e: LogEvent) => {
    if (!matches(e)) return;
    if (opts.json) {
      console.log(JSON.stringify(e));
    } else {
      console.log(format(e));
    }
  };

  // Initial dump: last N matching lines.
  if (opts.limit && !opts.follow) {
    const lines = readAllLines(file);
    const matched: LogEvent[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as LogEvent;
        if (matches(e)) matched.push(e);
      } catch {
        // skip malformed
      }
    }
    for (const e of matched.slice(-opts.limit)) emit(e);
    return;
  }

  // Stream mode (--follow) or full dump.
  const stream = fs.createReadStream(file, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LogEvent;
      emit(e);
    } catch {
      // skip malformed
    }
  }

  if (opts.follow) {
    // Watch for appended lines.
    let pos = fs.statSync(file).size;
    const watcher = fs.watch(file, async () => {
      const stat = fs.statSync(file);
      if (stat.size <= pos) return;
      const fd = fs.openSync(file, "r");
      const len = stat.size - pos;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      fs.closeSync(fd);
      pos = stat.size;
      for (const line of buf.toString("utf-8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as LogEvent;
          emit(e);
        } catch { /* skip */ }
      }
    });
    process.on("SIGINT", () => { fs.unwatchFile(file); watcher.close(); process.exit(0); });
    // Keep process alive.
    await new Promise(() => {});
  }
}

function readAllLines(file: string): string[] {
  return fs.readFileSync(file, "utf-8").split("\n");
}

const LEVEL_RANK: Record<LogLevel, number> = {
  fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10,
};
function levelAtLeast(actual: LogLevel, min: LogLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[min];
}

function format(e: LogEvent): string {
  const t = new Date(e.ts ?? Date.now()).toISOString().slice(11, 23);
  const lvl = (e.level ?? "info").padEnd(5);
  const ev = e.event ?? "?";
  const sid = e.sessionId ? ` session=${e.sessionId}` : "";
  const extras = Object.entries(e)
    .filter(([k]) => !["ts", "level", "event", "sessionId", "service", "pid"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${t} ${lvl} ${ev}${sid}${extras ? " " + extras : ""}`;
}
