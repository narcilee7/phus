// src/tui/components/FileTree.tsx
// Keyboard-navigable project file tree sidebar. Built on top of the same
// file scan used by the command palette so the two stay consistent.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { scanFiles } from "@/tui/components/CommandPalette.js";

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await scanFiles(process.cwd(), 4);
      if (!cancelled) setFiles(list);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const root = useMemo(() => buildTree(files), [files]);
  const visible = useMemo(() => getVisibleNodes(root, expanded), [root, expanded]);

  const selectedNode = useMemo(() => {
    return visible.find((n) => n.path === selectedPath) ?? visible[0];
  }, [visible, selectedPath]);

  useEffect(() => {
    if (selectedNode && selectedNode.path !== selectedPath) {
      setSelectedPath(selectedNode.path);
    }
  }, [selectedNode, selectedPath]);

  const selectedIndex = useMemo(
    () => Math.max(0, visible.findIndex((n) => n.path === selectedPath)),
    [visible, selectedPath],
  );

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "b")) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedPath(visible[Math.max(0, selectedIndex - 1)]?.path ?? "");
      return;
    }
    if (key.downArrow) {
      setSelectedPath(visible[Math.min(visible.length - 1, selectedIndex + 1)]?.path ?? "");
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
          onPreview(`── ${node.path} (${text.length} chars) ──\n${text}`);
        })
        .catch((err: any) => {
          onPreview(`could not read ${node.path}: ${err.message ?? err}`);
        });
    }
  });

  const maxRows = Math.max(1, height - 4);
  const windowStart = Math.max(0, selectedIndex - maxRows + 1);
  const windowed = visible.slice(windowStart, windowStart + maxRows);

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
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {windowed.map((node) => {
          const isSelected = node.path === selectedPath;
          const isExpanded = expanded.has(node.path);
          const icon = node.type === "dir" ? (isExpanded ? "📂" : "📁") : "📄";
          const chevron = node.type === "dir" ? (isExpanded ? "▼ " : "▶ ") : "  ";
          const indent = "  ".repeat(depthOf(node, root));
          return (
            <Box key={`${node.type}-${node.path}`}>
              {isSelected ? (
                <Text backgroundColor="cyan" color="black">
                  {indent}{chevron}{icon} {node.name}
                </Text>
              ) : (
                <Text>
                  {indent}{chevron}{icon} {node.name}
                </Text>
              )}
            </Box>
          );
        })}
        {visible.length === 0 && (
          <Text dimColor>(no files)</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>↑↓ nav · ←→ expand · Enter @path · Space preview · Esc close</Text>
      </Box>
    </Box>
  );
}
