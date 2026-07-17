// src/tui/git-status.ts
// Thin wrapper around `git status --porcelain` so the TUI can decorate files
// with their working-tree state.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type GitStatusCode = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "!";

export interface GitStatusMap {
  [relativePath: string]: GitStatusCode;
}

/** Run git status --porcelain in cwd and return a map of relative paths to
 *  their short status codes. Returns an empty map if not inside a git repo or
 *  if git is unavailable. */
export async function loadGitStatus(cwd: string): Promise<GitStatusMap> {
  const map: GitStatusMap = {};
  try {
    const { stdout } = await execFileP("git", ["status", "--porcelain", "-z"], {
      cwd,
      timeout: 5000,
    });
    const parts = stdout.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part.length < 3) continue;
      const code = part.slice(0, 2).trim() as GitStatusCode;
      const filePath = part.slice(3);
      if (!code || !filePath) continue;
      map[filePath] = code;
      // Renames include the original name in the next null-delimited chunk.
      if (code === "R" || code === "C") {
        i++; // skip original name
      }
    }
  } catch {
    // Not a git repo or git not installed — silently ignore.
  }
  return map;
}
