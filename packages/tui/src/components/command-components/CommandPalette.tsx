// src/tui/components/CommandPalette.tsx
// Global command palette (Ctrl+K). Fuzzy-search slash commands, project
// files, loaded skills and tape sessions; select to insert or run.
// Supports frecency-boosted history and grouped display.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import Fuse from "fuse.js";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { SLASH_COMMANDS } from "@/handler/commands/commands.js";
import {
  loadPaletteHistory,
  recordPaletteUse,
  score,
  type PaletteHistoryEntry,
} from "@/handler/history/palette-history.js";
import { loadConfig } from "@phus/runtime/infra/config/index.js";

export type PaletteAction = "insert" | "run";

export type PaletteGroup = "command" | "file" | "skill" | "session";

interface PaletteItem {
  type: PaletteGroup;
  group: PaletteGroup;
  label: string;
  value: string;
  icon: string;
}

interface CommandPaletteProps {
  agent: PhusAgent;
  /** Optional PHUS_HOME override. If omitted, loadConfig().paths.home is used. */
  home?: string;
  onSelect: (value: string, action: PaletteAction) => void;
  onClose: () => void;
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", ".phus", ".claude", ".vscode"]);
const MAX_FILES = 200;
const VISIBLE_COUNT = 10;

const GROUP_ORDER: PaletteGroup[] = ["command", "file", "skill", "session"];
const GROUP_COLORS: Record<PaletteGroup, string> = {
  command: "cyan",
  file: "green",
  skill: "yellow",
  session: "magenta",
};

export async function scanFiles(dir: string, depth: number): Promise<string[]> {
  if (depth <= 0) return [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const name of names) {
    if (name.startsWith(".") && name !== ".") continue;
    if (EXCLUDED_DIRS.has(name)) continue;
    if (files.length >= MAX_FILES) break;

    const fullPath = path.join(dir, name);
    const relPath = path.relative(process.cwd(), fullPath);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) {
      const subFiles = await scanFiles(fullPath, depth - 1);
      files.push(...subFiles.slice(0, MAX_FILES - files.length));
    } else if (entryStat.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

export function CommandPalette({ agent, home: homeProp, onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [history, setHistory] = useState<PaletteHistoryEntry[]>([]);
  const [preview, setPreview] = useState<{ title: string; lines: string[] } | null>(null);

  const home = useMemo(() => {
    if (homeProp) return homeProp;
    try {
      return loadConfig().paths.home;
    } catch {
      return "";
    }
  }, [homeProp]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [files, skills, sessions, hist] = await Promise.all([
        scanFiles(process.cwd(), 3),
        Promise.resolve(agent.getAllSkills()),
        Promise.resolve(agent.getTapeStats()),
        loadPaletteHistory(home),
      ]);
      if (cancelled) return;

      const paletteItems: PaletteItem[] = [
        ...SLASH_COMMANDS.map((c) => ({
          type: "command" as const,
          group: "command" as const,
          label: `/${c.name}`,
          value: `/${c.name} `,
          icon: "/",
        })),
        ...[
          { name: "plan create", args: "", icon: "📋" },
          { name: "plan status", args: "", icon: "📋" },
          { name: "plan list", args: "", icon: "📋" },
          { name: "plan resume", args: "", icon: "📋" },
        ].map((c) => ({
          type: "command" as const,
          group: "command" as const,
          label: `/${c.name}`,
          value: `/${c.name}${c.args ? ` ${c.args}` : ""} `,
          icon: c.icon,
        })),
        ...files.slice(0, MAX_FILES).map((f) => ({
          type: "file" as const,
          group: "file" as const,
          label: f,
          value: `@${f} `,
          icon: "📄",
        })),
        ...skills.map((s) => ({
          type: "skill" as const,
          group: "skill" as const,
          label: s.name,
          value: `@skill/${s.name} `,
          icon: "🔧",
        })),
        ...Object.keys(sessions.sessions).map((sid) => ({
          type: "session" as const,
          group: "session" as const,
          label: sid,
          value: `/use ${sid}`,
          icon: "💬",
        })),
      ];
      setItems(paletteItems);
      setHistory(hist);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [agent, home]);

  const historyScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of history) {
      map.set(`${h.group}:${h.value}`, score(h));
    }
    return map;
  }, [history]);

  const fuse = useMemo(() => new Fuse(items, { keys: ["label"], threshold: 0.4 }), [items]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    let matched: PaletteItem[];
    if (!trimmed) {
      matched = [...items];
    } else {
      matched = fuse.search(trimmed).map((r) => r.item);
    }
    // Boost recently/frequently used items without fully overriding relevance.
    matched.sort((a, b) => {
      const scoreA = historyScoreMap.get(`${a.group}:${a.value}`) ?? 0;
      const scoreB = historyScoreMap.get(`${b.group}:${b.value}`) ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    });
    // When there is no query, keep a stable group order with boosted items first inside each group.
    if (!trimmed) {
      const byGroup = new Map<PaletteGroup, PaletteItem[]>();
      for (const g of GROUP_ORDER) byGroup.set(g, []);
      for (const item of matched) {
        byGroup.get(item.group)?.push(item);
      }
      matched = GROUP_ORDER.flatMap((g) => byGroup.get(g) ?? []);
    }
    return matched;
  }, [query, items, fuse, historyScoreMap]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Clamp selected index when the result list shrinks (e.g. query changed
  // before the reset effect fired, or async items loaded while navigating).
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  // Async preview pane: show the first lines of a selected file, or a short
  // hint for commands/skills/sessions.
  useEffect(() => {
    let cancelled = false;
    const item = results[safeSelectedIndex];
    async function loadPreview() {
      if (!item) {
        setPreview(null);
        return;
      }
      if (item.group === "file") {
        const filePath = item.value.trim().replace(/^@/, "").trimEnd();
        try {
          const text = await readFile(filePath, "utf-8");
          const lines = text.split("\n").slice(0, 10);
          if (!cancelled) setPreview({ title: item.label, lines });
        } catch (err: any) {
          if (!cancelled) setPreview({ title: item.label, lines: [`(cannot read: ${err.message})`] });
        }
        return;
      }
      if (!cancelled) setPreview({ title: item.label, lines: [item.value.trim()] });
    }
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [results, safeSelectedIndex]);

  // Codex-style smooth scroll: keep the selected row near the bottom of the
  // visible window so the list pushes up one item at a time.
  const bottomAnchor = VISIBLE_COUNT - 1;
  const visibleStart =
    results.length <= VISIBLE_COUNT
      ? 0
      : Math.max(
          0,
          Math.min(safeSelectedIndex - bottomAnchor, results.length - VISIBLE_COUNT),
        );
  const visibleResults = results.slice(visibleStart, visibleStart + VISIBLE_COUNT);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => (i - 1 + Math.max(1, results.length)) % Math.max(1, results.length));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => (i + 1) % Math.max(1, results.length));
      return;
    }
    if (key.return) {
      const item = results[safeSelectedIndex];
      if (item) {
        const action: PaletteAction = item.type === "session" ? "run" : "insert";
        void recordPaletteUse(home, item.value, item.group);
        onSelect(item.value, action);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (input && /^[\x20-\x7E\u00A0-\uFFFF]+$/.test(input) && !key.ctrl && !key.meta && !key.return) {
      setQuery((q) => q + input);
    }
  });

  return (
    <Box
      flexDirection="row"
      borderStyle="double"
      borderColor="cyan"
      marginY={1}
      height={14}
    >
      <Box width="60%" flexDirection="column" paddingX={1}>
        <Box>
          <Text color="cyan">❯ </Text>
          <Text color="cyan">{query}</Text>
          <Text color="cyan">▍</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {visibleResults.map((item, idx) => {
            const actualIndex = visibleStart + idx;
            const color = GROUP_COLORS[item.group];
            return (
              <Box key={`${item.group}-${item.label}-${actualIndex}`} flexDirection="row">
                {actualIndex === safeSelectedIndex ? (
                  <Text backgroundColor="cyan" color="black">
                    {"› "}{item.icon} {item.label}
                  </Text>
                ) : (
                  <Text>
                    <Text dimColor>{"  "}{item.icon} </Text>
                    <Text color={color}>{item.label}</Text>
                  </Text>
                )}
              </Box>
            );
          })}
          {results.length === 0 && (
            <Text dimColor>(no matches)</Text>
          )}
        </Box>
        <Box>
          <Text dimColor>↑↓ navigate · Enter select · Esc close</Text>
        </Box>
      </Box>
      <Box width="1">
        <Text color="cyan">│</Text>
      </Box>
      <Box width="39%" flexDirection="column" paddingX={1}>
        <Box>
          <Text color="cyan" bold>Preview</Text>
        </Box>
        <Box>
          <Text dimColor wrap="truncate-end">{preview?.title ?? ""}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {preview ? (
            preview.lines.map((line, i) => (
              <Text key={i} dimColor wrap="truncate-end">{line}</Text>
            ))
          ) : (
            <Text dimColor>(no preview)</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
