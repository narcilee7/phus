// src/bridge/tools.ts
// External tools exposed to the agent: bash, file_read, file_write.
// All execute via child_process (no in-process eval of AI-written code).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const execFileP = promisify(execFile);

export function createExternalTools(): AgentTool[] {
  return [
    {
      name: "bash",
      label: "Bash",
      description:
        "Execute a shell command. Runs via `sh -c` with a 30-second timeout. " +
        "Use for git, curl, package managers, etc. Avoid for reading/writing files — use file_read/file_write.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute." }),
        cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to $PWD." })),
      }),
      execute: async (_id, params) => {
        const p = params as { command: unknown; cwd?: unknown };
        const stdout = await execFileP("sh", ["-c", String(p.command)], {
          cwd: (p.cwd as string | undefined) ?? process.cwd(),
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024,
        });
        return {
          content: [{ type: "text", text: (stdout.stdout ?? "") + (stdout.stderr ?? "") }],
          details: { stdout: stdout.stdout, stderr: stdout.stderr },
        };
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
