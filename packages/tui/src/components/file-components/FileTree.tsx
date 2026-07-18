// src/tui/components/FileTree.tsx
// Keyboard-navigable project file tree sidebar. Built on top of the same
// file scan used by the command palette so the two stay consistent.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { scanFiles } from "@/components/command-components/CommandPalette.js";
import { loadGitStatus, type GitStatusMap } from "@/handler/git/git-status.js";

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children: TreeNode[];
  parent?: TreeNode;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", type: "dir", children: [] };
  for (const file of files) {
    const parts = file.split(path.sep);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: current.path ? `${current.path}${path.sep}${part}` : part,
          type: isFile ? "file" : "dir",
          children: [],
          parent: current,
        };
        current.children.push(child);
        current.children.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "dir" ? -1 : 1;
        });
      }
      current = child;
    }
  }
  return root;
}

function getVisibleNodes(root: TreeNode, expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(node: TreeNode) {
    if (node === root) {
      for (const child of node.children) walk(child);
      return;
    }
    result.push(node);
    if (node.type === "dir" && expanded.has(node.path)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return result;
}

function depthOf(node: TreeNode, root: TreeNode): number {
  let depth = 0;
  let parent = node.parent;
  while (parent && parent !== root) {
    depth++;
    parent = parent.parent;
  }
  return depth;
}

function statusBadge(code: string | undefined): string {
  if (!code) return "";
  const color: Record<string, string> = {
    M: "yellow",
    A: "green",
    D: "red",
    "?": "magenta",
    R: "cyan",
    C: "cyan",
    U: "red",
  };
  return ` [${code}]`;
}

const PREVIEW_MAX_LINES = 100;

export interface FileTreeProps {
  height: number;
  onInsert: (value: string) => void;
  onPreview: (text: string) => void;
  onClose: () => void;
}

export function FileTree({ height, onInsert, onPreview, onClose }: FileTreeProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [gitStatus, setGitStatus] = useState<GitStatusMap>({});
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [list, status] = await Promise.all([
        scanFiles(process.cwd(), 4),
        loadGitStatus(process.cwd()),
      ]);
      if (!cancelled) {
        setFiles(list);
        setGitStatus(status);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const root = useMemo(() => buildTree(files), [files]);
  const visible = useMemo(() => getVisibleNodes(root, expanded), [root, expanded]);

  // In filter mode flatten to matching files across the whole tree, regardless
  // of which directories are currently expanded.
  const filteredVisible = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!filterMode || !q) return visible;
    const allFiles: TreeNode[] = [];
    function collect(node: TreeNode) {
      if (node === root) {
        for (const child of node.children) collect(child);
        return;
      }
      if (node.type === "file") allFiles.push(node);
      else for (const child of node.children) collect(child);
    }
    collect(root);
    return allFiles.filter((n) => n.name.toLowerCase().includes(q));
  }, [visible, root, filterMode, filterQuery]);

  const selectedNode = useMemo(() => {
    return filteredVisible.find((n) => n.path === selectedPath) ?? filteredVisible[0];
  }, [filteredVisible, selectedPath]);

  useEffect(() => {
    if (selectedNode && selectedNode.path !== selectedPath) {
      setSelectedPath(selectedNode.path);
    }
  }, [selectedNode, selectedPath]);

  const selectedIndex = useMemo(
    () => Math.max(0, filteredVisible.findIndex((n) => n.path === selectedPath)),
    [filteredVisible, selectedPath],
  );

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilterQuery("");
        return;
      }
      if (key.backspace || key.delete) {
        setFilterQuery((q) => q.slice(0, -1));
        return;
      }
      if (key.return) {
        setFilterMode(false);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterQuery((q) => q + input);
      }
      return;
    }

    if (input === "/") {
      setFilterMode(true);
      setFilterQuery("");
      return;
    }

    if (key.escape || (key.ctrl && input === "b")) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedPath(filteredVisible[Math.max(0, selectedIndex - 1)]?.path ?? "");
      return;
    }
    if (key.downArrow) {
      setSelectedPath(filteredVisible[Math.min(filteredVisible.length - 1, selectedIndex + 1)]?.path ?? "");
      return;
    }
    if (key.leftArrow) {
      const node = selectedNode;
      if (!node) return;
      if (node.type === "dir" && expanded.has(node.path)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(node.path);
          return next;
        });
      } else if (node.parent && node.parent !== root) {
        setSelectedPath(node.parent.path);
      }
      return;
    }
    if (key.rightArrow) {
      const node = selectedNode;
      if (!node) return;
      if (node.type === "dir" && !expanded.has(node.path)) {
        setExpanded((prev) => new Set([...prev, node.path]));
      } else if (node.type === "dir" && node.children.length > 0) {
        setSelectedPath(node.children[0]!.path);
      }
      return;
    }
    if (key.return) {
      const node = selectedNode;
      if (!node) return;
      if (node.type === "file") {
        onInsert(`@${node.path} `);
        onClose();
      } else {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(node.path)) next.delete(node.path);
          else next.add(node.path);
          return next;
        });
      }
      return;
    }
    if (input === " ") {
      const node = selectedNode;
      if (!node || node.type !== "file") return;
      void readFile(node.path, "utf-8")
        .then((text) => {
          const lines = text.split("\n");
          const preview =
            lines.length > PREVIEW_MAX_LINES
              ? lines.slice(0, PREVIEW_MAX_LINES).join("\n") + "\n..."
              : text;
          onPreview(`── ${node.path} (${text.length} chars) ──\n${preview}`);
        })
        .catch((err: any) => {
          onPreview(`could not read ${node.path}: ${err.message ?? err}`);
        });
    }
  });

  const maxRows = Math.max(1, height - 4);
  const windowStart = Math.max(0, selectedIndex - maxRows + 1);
  const windowed = filteredVisible.slice(windowStart, windowStart + maxRows);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      height={height}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Files</Text>
        {filterMode && (
          <Text>
            {"  "}
            <Text color="cyan">/</Text>
            <Text>{filterQuery}</Text>
            <Text color="cyan">▍</Text>
          </Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {windowed.map((node) => {
          const isSelected = node.path === selectedPath;
          const isExpanded = expanded.has(node.path);
          const icon = node.type === "dir" ? (isExpanded ? "📂" : "📁") : "📄";
          const chevron = node.type === "dir" ? (isExpanded ? "▼ " : "▶ ") : "  ";
          const indent = "  ".repeat(depthOf(node, root));
          const badge = node.type === "file" ? statusBadge(gitStatus[node.path]) : "";
          return (
            <Box key={`${node.type}-${node.path}`}>
              {isSelected ? (
                <Text backgroundColor="cyan" color="black">
                  {indent}{chevron}{icon} {node.name}
                  <Text color="black">{badge}</Text>
                </Text>
              ) : (
                <Text>
                  {indent}{chevron}{icon} {node.name}
                  <Text color="yellow">{badge}</Text>
                </Text>
              )}
            </Box>
          );
        })}
        {filteredVisible.length === 0 && (
          <Text dimColor>{filterMode ? "(no matches)" : "(no files)"}</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>
          {filterMode
            ? "type to filter · Enter keep · Esc clear"
            : "↑↓ nav · ←→ expand · Enter @path · Space preview · / filter · Esc close"}
        </Text>
      </Box>
    </Box>
  );
}
