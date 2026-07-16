// src/tui/components/CommandPalette.tsx
// Global command palette (Ctrl+K). Fuzzy-search slash commands, project
// files, loaded skills and tape sessions; select to insert or run.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import Fuse from "fuse.js";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import { SLASH_COMMANDS } from "@/tui/commands.js";

export type PaletteAction = "insert" | "run";

interface PaletteItem {
  type: "command" | "file" | "skill" | "session";
  label: string;
  value: string;
  icon: string;
}

interface CommandPaletteProps {
  agent: PhusAgent;
  onSelect: (value: string, action: PaletteAction) => void;
  onClose: () => void;
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", ".phus", ".claude", ".vscode"]);
const MAX_FILES = 200;
const VISIBLE_COUNT = 10;

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

export function CommandPalette({ agent, onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<PaletteItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [files, skills, sessions] = await Promise.all([
        scanFiles(process.cwd(), 3),
        Promise.resolve(agent.getAllSkills()),
        Promise.resolve(agent.getTapeStats()),
      ]);
      if (cancelled) return;

      const paletteItems: PaletteItem[] = [
        ...SLASH_COMMANDS.map((c) => ({
          type: "command" as const,
          label: `/${c.name}`,
          value: `/${c.name} `,
          icon: "/",
        })),
        ...files.slice(0, MAX_FILES).map((f) => ({
          type: "file" as const,
          label: f,
          value: `@${f} `,
          icon: "📄",
        })),
        ...skills.map((s) => ({
          type: "skill" as const,
          label: s.name,
          value: `@skill/${s.name} `,
          icon: "🔧",
        })),
        ...Object.keys(sessions.sessions).map((sid) => ({
          type: "session" as const,
          label: sid,
          value: `/use ${sid}`,
          icon: "💬",
        })),
      ];
      setItems(paletteItems);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [agent]);

  const fuse = useMemo(() => new Fuse(items, { keys: ["label"], threshold: 0.4 }), [items]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return items;
    return fuse.search(trimmed).map((r) => r.item);
  }, [query, items, fuse]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const visibleStart = Math.max(
    0,
    Math.min(selectedIndex, results.length - VISIBLE_COUNT),
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
      const item = results[selectedIndex];
      if (item) {
        const action: PaletteAction = item.type === "session" ? "run" : "insert";
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
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
      height={14}
    >
      <Box>
        <Text color="cyan">❯ </Text>
        <Text color="cyan">{query}</Text>
        <Text color="cyan">▍</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleResults.map((item, idx) => {
          const actualIndex = visibleStart + idx;
          return (
            <Box key={`${item.type}-${item.label}`} flexDirection="row">
              <Text>
                {actualIndex === selectedIndex ? (
                  <Text backgroundColor="cyan" color="black">
                    › {item.icon} {item.label}
                  </Text>
                ) : (
                  <Text dimColor>
                    {"  "}{item.icon} {item.label}
                  </Text>
                )}
              </Text>
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
  );
}
