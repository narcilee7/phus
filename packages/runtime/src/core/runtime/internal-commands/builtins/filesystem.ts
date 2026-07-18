// src/core/internal-commands/builtins/filesystem.ts
// ,fs.read / ,fs.write — file inspection utilities.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InternalCommand, InternalCommandServices } from "../types.js";

export function defineFilesystemCommands(
  _services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "fs.read",
      description: "print a file's contents",
      usage: "path=<file>",
      handler: async ({ args }) => {
        const p = args.path;
        if (!p) return "usage: ,fs.read path=<file>";
        try {
          const content = await fs.readFile(p, "utf-8");
          return `── ${p} (${content.length} chars) ──\n${content}`;
        } catch (err: any) {
          return `read failed: ${err.message}`;
        }
      },
    },
    {
      name: "fs.write",
      description: "write a file (must be in policy root)",
      usage: "path=<file> content=<text>",
      handler: async ({ args }) => {
        const p = args.path;
        const content = args.content;
        if (!p || content === undefined) return "usage: ,fs.write path=<file> content=<text>";
        try {
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, content, "utf-8");
          return `✓ wrote ${content.length} bytes to ${p}`;
        } catch (err: any) {
          return `write failed: ${err.message}`;
        }
      },
    },
  ];
}