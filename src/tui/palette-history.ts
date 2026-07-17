// src/tui/palette-history.ts
// Frecency history for the command palette. Lightweight append-only
// journal stored in PHUS_HOME; read-time merge keeps the hot set small.

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HISTORY_FILE = "palette-history.jsonl";
const MAX_ENTRIES = 200;

export interface PaletteHistoryEntry {
  /** Palette value (e.g. "/model ", "@src/foo.ts "). */
  value: string;
  /** Item group (command, file, skill, session). */
  group: string;
  /** Last used timestamp (ms). */
  ts: number;
  /** Times this value has been selected. */
  count: number;
}

function now(): number {
  return Date.now();
}

function historyPath(home: string): string {
  return path.join(home, HISTORY_FILE);
}

/** Frecency score: higher is better; decays with age. */
export function score(entry: PaletteHistoryEntry): number {
  const ageHours = Math.max(0.001, (now() - entry.ts) / 36e5);
  return (entry.count * 10) / ageHours;
}

/** Load merged history from PHUS_HOME. Returns empty array on missing file. */
export async function loadPaletteHistory(home: string): Promise<PaletteHistoryEntry[]> {
  if (!home) return [];
  const file = historyPath(home);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf-8").catch(() => "");
  const map = new Map<string, PaletteHistoryEntry>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as PaletteHistoryEntry;
      if (!e.value || !e.group) continue;
      const key = `${e.group}:${e.value}`;
      const existing = map.get(key);
      if (!existing || e.ts > existing.ts) {
        map.set(key, {
          value: e.value,
          group: e.group,
          ts: e.ts,
          count: (existing?.count ?? 0) + (e.count || 1),
        });
      } else {
        existing.count += e.count || 1;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ENTRIES);
}

async function savePaletteHistory(home: string, entries: PaletteHistoryEntry[]): Promise<void> {
  if (!home) return;
  try {
    const dir = home;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = historyPath(home);
    await writeFile(
      file,
      entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""),
      "utf-8",
    );
  } catch (err: any) {
    // Non-fatal: history is a best-effort UX enhancement. Log so the user
    // can notice a permission problem without breaking the palette flow.
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(`[phus] palette history write failed: ${err.message}\n`);
    }
  }
}

/** Record a palette selection, merging with any existing entry. */
export async function recordPaletteUse(
  home: string,
  value: string,
  group: string,
): Promise<void> {
  if (!home || !value || !group) return;
  const entries = await loadPaletteHistory(home);
  const key = `${group}:${value}`;
  const idx = entries.findIndex((e) => `${e.group}:${e.value}` === key);
  if (idx >= 0) {
    const existing = entries[idx]!;
    const updated: PaletteHistoryEntry = {
      ...existing,
      count: existing.count + 1,
      ts: now(),
    };
    entries.splice(idx, 1);
    entries.unshift(updated);
  } else {
    entries.unshift({ value, group, ts: now(), count: 1 });
  }
  while (entries.length > MAX_ENTRIES) entries.pop();
  await savePaletteHistory(home, entries);
}
