// src/tui/components/PermissionPanel.tsx
// Independent permission request panel with tool name, danger level, args
// preview and diff preview for write operations.

import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest, RememberChoice } from "@/tui/state/state.js";

const DANGEROUS_TOOLS = new Set([
  "bash",
  "file_write",
  "startup_write",
  "skill_write",
  "skill_delete",
  "memory_write",
]);

function dangerLevel(toolName: string): "high" | "medium" | "low" {
  if (["bash", "skill_delete"].includes(toolName)) return "high";
  if (DANGEROUS_TOOLS.has(toolName)) return "medium";
  return "low";
}

function dangerColor(level: ReturnType<typeof dangerLevel>): string {
  switch (level) {
    case "high":
      return "red";
    case "medium":
      return "yellow";
    default:
      return "green";
  }
}

function dangerLabel(level: ReturnType<typeof dangerLevel>): string {
  switch (level) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    default:
      return "LOW";
  }
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "(no args)";
  if (typeof args === "string") return args;
  try {
    const json = JSON.stringify(args, null, 2);
    return json.length > 400 ? json.slice(0, 400) + "\n…" : json;
  } catch {
    return String(args);
  }
}

function buildDiffPreview(toolName: string, args: unknown): string | undefined {
  if (toolName === "memory_write") {
    const action = (args as { action?: { section?: string; body?: string; kind?: string } } | undefined)
      ?.action;
    if (!action) return undefined;
    const heading = action.section?.startsWith("#") ? action.section : `## ${action.section}`;
    const lines = [`reason: ${action.kind ?? "write"}`, "", `${heading}`];
    if (action.body) {
      for (const ln of action.body.split("\n").slice(0, 8)) {
        lines.push(`  ${ln}`);
      }
    }
    return lines.join("\n");
  }

  if (toolName === "file_write" || toolName === "startup_write" || toolName === "skill_write") {
    const obj = args as Record<string, unknown> | undefined;
    const path = String(obj?.path ?? "unknown");
    const content = typeof obj?.content === "string" ? obj.content : undefined;
    if (!content) return undefined;
    const lines = [`path: ${path}`, ""];
    for (const ln of content.split("\n").slice(0, 8)) {
      lines.push(`+ ${ln}`);
    }
    if (content.split("\n").length > 8) lines.push("…");
    return lines.join("\n");
  }

  return undefined;
}

export interface PermissionPanelProps {
  request: PermissionRequest;
  onResolve: (allow: boolean, remember: RememberChoice) => void;
}

export function PermissionPanel({ request, onResolve }: PermissionPanelProps) {
  useInput((input, key) => {
    if (key.escape) {
      onResolve(false, "once");
      return;
    }
    if (key.return) {
      onResolve(true, "once");
      return;
    }
    const ch = input.toLowerCase();
    if (ch === "y") {
      onResolve(true, "once");
    } else if (ch === "s") {
      onResolve(true, "session");
    } else if (ch === "a") {
      onResolve(true, "always");
    } else if (ch === "n") {
      onResolve(false, "once");
    }
  });

  const level = dangerLevel(request.toolName);
  const color = dangerColor(level);
  const summary = request.preview ?? formatArgs(request.args);
  const diff = buildDiffPreview(request.toolName, request.args) ?? request.preview;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={color}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text>
          <Text color={color}>⚠ </Text>
          Allow <Text bold color={color}>{request.toolName}</Text>
          {request.caption ? <Text>? ({request.caption})</Text> : <Text>?</Text>}
        </Text>
        <Text color={color} bold>
          {dangerLabel(level)} risk
        </Text>
      </Box>
      {summary && (
        <Box marginBottom={1}>
          <Text dimColor wrap="wrap">
            {summary}
          </Text>
        </Box>
      )}
      {diff && summary !== diff && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          {diff.split("\n").map((line, idx) => (
            <Text key={idx} dimColor wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="green">[Y]es</Text>
          <Text> · </Text>
          <Text color="cyan">[S]ession</Text>
          <Text> · </Text>
          <Text color="blue">[A]lways</Text>
          <Text> · </Text>
          <Text color="red">[N]o</Text>
          <Text> · </Text>
          <Text dimColor>Esc</Text>
        </Text>
      </Box>
    </Box>
  );
}
