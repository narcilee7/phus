// src/bridge/tools.ts
// External tools exposed to the agent: bash, file_read, file_write.
// All execute via child_process (no in-process eval of AI-written code).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { withRetry, DEFAULT_RETRY } from "@/core/scheduler/retry/index.js";
import { logger } from "@/core/logger.js";

const execFileP = promisify(execFile);

export function createExternalTools(): AgentTool[] {
  return [
    {
      name: "bash",
      label: "Bash",
      description:
        "Execute a shell command. Runs via `sh -c`. Default timeout 30s; override with timeoutMs. " +
        "Auto-retries once on transient errors (network/timeout). " +
        "Use for git, curl, package managers, etc. Avoid for reading/writing files — use file_read/file_write.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute." }),
        cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to $PWD." })),
        timeoutMs: Type.Optional(Type.Number({ description: "Max execution time in ms. Default 30000." })),
      }),
      execute: async (toolCallId, params) => {
        const p = params as { command: unknown; cwd?: unknown; timeoutMs?: number };
        const cmd = String(p.command);
        const cwd = (p.cwd as string | undefined) ?? process.cwd();
        const timeoutMs = p.timeoutMs ?? 30_000;
        // B.2.4: emit heartbeat every 5s for long-running commands so the
        // TUI / log can show "still working" instead of dead silence.
        let heartbeat: NodeJS.Timeout | undefined;
        const startedAt = Date.now();
        if (timeoutMs > 10_000) {
          heartbeat = setInterval(() => {
            logger.debug("tool.bash.heartbeat", {
              toolCallId,
              elapsedMs: Date.now() - startedAt,
              timeoutMs,
            });
          }, 5000);
        }
        try {
          const stdout = await withRetry(
            () =>
              execFileP("sh", ["-c", cmd], {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 5 * 1024 * 1024,
              }),
            { ...DEFAULT_RETRY, maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2000, jitter: false },
          );
          return {
            content: [{ type: "text", text: (stdout.stdout ?? "") + (stdout.stderr ?? "") }],
            details: { stdout: stdout.stdout, stderr: stdout.stderr, durationMs: Date.now() - startedAt },
          };
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      },
    },
    {
      name: "file_read",
      label: "Read File",
      description: "Read the contents of a file as UTF-8.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute or cwd-relative path." }),
      }),
      execute: async (_id, params) => {
        const p = params as { path: unknown };
        const text = await readFile(String(p.path), "utf-8");
        return {
          content: [{ type: "text", text }],
          details: { length: text.length },
        };
      },
    },
    {
      name: "file_write",
      label: "Write File",
      description: "Write UTF-8 content to a file, overwriting it. Parent directories are created.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute or cwd-relative path." }),
        content: Type.String({ description: "File content." }),
      }),
      execute: async (_id, params) => {
        const p = params as { path: unknown; content: unknown };
        await writeFile(String(p.path), String(p.content), "utf-8");
        return {
          content: [{ type: "text", text: `wrote ${String(p.content).length} bytes to ${p.path}` }],
          details: { path: p.path, bytes: String(p.content).length },
        };
      },
    },
  ];
}
