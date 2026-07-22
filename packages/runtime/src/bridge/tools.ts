// src/bridge/tools.ts
// External tools exposed to the agent: bash, file_read, file_write,
// edit (StrReplaceFile), grep, glob.
// All execute via child_process (no in-process eval of AI-written code).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { withRetry, DEFAULT_RETRY } from "../infra/retry.js";
import { logger } from "../infra/logging.js";

const execFileP = promisify(execFile);

// ─── Constants ─────────────────────────────────────────────────

const MAX_READ_LINES = 1000;
const MAX_READ_BYTES = 100 * 1024;

// ─── Helpers ───────────────────────────────────────────────────

/** Sensitive file patterns to always filter from search results. */
function isSensitivePath(p: string): boolean {
  const base = path.basename(p);
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub'].includes(base)) return true;
  if (p.includes('.aws/credentials') || p.includes('.gcp/credentials')) return true;
  return false;
}

function addLineNumbers(text: string, startLine: number): string {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const width = String(startLine + lines.length).length;
  return lines.map((line, i) => {
    const num = String(startLine + i).padStart(width, ' ');
    return `${num}\t${line}`;
  }).join('\n');
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

// ─── Tools ──────────────────────────────────────────────────────

export function createExternalTools(): AgentTool[] {
  return [
    // ── bash ───────────────────────────────────────────────────
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
      execute: async (toolCallId, params, signal) => {
        const p = params as { command: unknown; cwd?: unknown; timeoutMs?: number };
        const cmd = String(p.command);
        const cwd = (p.cwd as string | undefined) ?? process.cwd();
        const timeoutMs = p.timeoutMs ?? 30_000;
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
                // Encode stdout/stderr as utf-8 so the .stdout /
                // .stderr fields are strings, not Buffers. The
                // tool returns text to the model, so we don't
                // need binary.
                encoding: "utf-8",
                // Forward the abort signal to the child process. When
                // the parent Aborts (Ctrl+C, plan cancel, sub-agent
                // timeout), Node's child_process tears down the sh
                // subprocess and resolves the promise with an
                // AbortError — exactly what we want. Without this,
                // a long-running `npm install` or `cargo build`
                // keeps the child alive until the OS-level timeout.
                signal,
              } as any),
            { ...DEFAULT_RETRY, maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2000, jitter: false },
          );
          return textResult(
            String(stdout.stdout ?? "") + String(stdout.stderr ?? ""),
            { durationMs: Date.now() - startedAt },
          );
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      },
    },

    // ── file_read ───────────────────────────────────────────────
    {
      name: "file_read",
      label: "Read File",
      description:
        `Read the contents of a file as UTF-8. Lines are numbered (line_number<TAB>content). ` +
        `Defaults to reading the first ${MAX_READ_LINES} lines (${MAX_READ_BYTES / 1024}KB max). ` +
        `Use offset and limit to page through large files.`,
      parameters: Type.Object({
        path: Type.String({ description: "Absolute or cwd-relative path." }),
        offset: Type.Optional(Type.Number({ description: "Line number to start reading from. Defaults to 1." })),
        limit: Type.Optional(Type.Number({ description: `Max lines to read. Defaults to ${MAX_READ_LINES}.` })),
      }),
      execute: async (_id, params, signal) => {
        const p = params as { path: unknown; offset?: number; limit?: number };
        const filePath = String(p.path);
        const startLine = Math.max(1, p.offset ?? 1);
        const maxLines = Math.min(p.limit ?? MAX_READ_LINES, MAX_READ_LINES);
        // Forward signal: slow network mounts may block readFile for
        // a long time; abort cuts the read short. The cast widens
        // the result type — with `encoding: "utf-8"` set, Node
        // returns a string at runtime.
        const raw = (await readFile(filePath, { encoding: "utf-8", signal } as any)) as unknown as string;
        const allLines = raw.split('\n');
        if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
        const totalLines = allLines.length;

        const sliced = allLines.slice(startLine - 1, startLine - 1 + maxLines);
        let result = addLineNumbers(sliced.join('\n'), startLine);

        // byte cap
        if (Buffer.byteLength(result, 'utf8') > MAX_READ_BYTES) {
          let bytes = 0;
          let cutAt = 0;
          for (const line of result.split('\n')) {
            const lb = Buffer.byteLength(line + '\n', 'utf8');
            if (bytes + lb > MAX_READ_BYTES) break;
            bytes += lb;
            cutAt++;
          }
          result = sliced.slice(0, cutAt).join('\n');
          result = addLineNumbers(result, startLine);
        }

        const displayed = result.split('\n').length;
        const footer = displayed < sliced.length
          ? `\n<system>Showing ${displayed} lines (${Buffer.byteLength(result, 'utf8')} bytes) of ${totalLines} total. Use offset=${startLine + displayed} for more.</system>`
          : `\n<system>${displayed} lines read (${totalLines} total).</system>`;

        return textResult(result + footer);
      },
    },

    // ── file_write ──────────────────────────────────────────────
    {
      name: "file_write",
      label: "Write File",
      description: "Write UTF-8 content to a file, overwriting it. Parent directories are created.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute or cwd-relative path." }),
        content: Type.String({ description: "File content." }),
      }),
      execute: async (_id, params, signal) => {
        const p = params as { path: unknown; content: unknown };
        const filePath = String(p.path);
        await mkdir(path.dirname(filePath), { recursive: true });
        // Forward the abort signal — Node's fs rejects with
        // AbortError when the signal fires mid-write, which the
        // executor's error-handling path treats as a clean
        // "aborted by user" rather than a tool failure.
        await writeFile(filePath, String(p.content), { encoding: "utf-8", signal } as any);
        return textResult(`Wrote ${String(p.content).length} bytes to ${filePath}`);
      },
    },

    // ── edit ────────────────────────────────────────────────────
    {
      name: "edit",
      label: "Edit File (StrReplace)",
      description:
        "Replace exact string matches in a file. Replaces the first occurrence by default; " +
        "set replace_all=true to replace all. Errors if old_string is not found or not unique " +
        "(when replace_all=false). Use file_read first to get exact content including whitespace.",
      parameters: Type.Object({
        path: Type.String({ description: "Path to the file to edit. Relative or absolute." }),
        old_string: Type.String({ description: "Exact text to replace. Must match exactly one occurrence unless replace_all=true." }),
        new_string: Type.String({ description: "Replacement text." }),
        replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences. Defaults to false." })),
      }),
      execute: async (_id, params) => {
        const p = params as { path: unknown; old_string: unknown; new_string: unknown; replace_all?: boolean };
        const filePath = String(p.path);
        const oldStr = String(p.old_string);
        const newStr = String(p.new_string);
        const replaceAll = p.replace_all ?? false;

        if (oldStr === newStr) {
          return textResult("No changes: old_string and new_string are identical.");
        }
        if (oldStr.length === 0) {
          return textResult("Error: old_string must not be empty.");
        }

        const raw = await readFile(filePath, "utf-8");

        if (!replaceAll) {
          let count = 0;
          let pos = 0;
          while ((pos = raw.indexOf(oldStr, pos)) !== -1) { count++; pos += oldStr.length; }
          if (count === 0) {
            return textResult(`Error: old_string not found in ${filePath}. The file may have changed — use file_read to reload.`);
          }
          if (count > 1) {
            return textResult(`Error: old_string is not unique in ${filePath} (${count} occurrences). Include more surrounding context to make it unique, or set replace_all=true.`);
          }
          await writeFile(filePath, raw.replace(oldStr, newStr), "utf-8");
          return textResult(`Replaced 1 occurrence in ${filePath}`);
        }

        const parts = raw.split(oldStr);
        if (parts.length === 1) {
          return textResult(`Error: old_string not found in ${filePath}.`);
        }
        await writeFile(filePath, parts.join(newStr), "utf-8");
        return textResult(`Replaced ${parts.length - 1} occurrences in ${filePath}`);
      },
    },

    // ── grep ────────────────────────────────────────────────────
    {
      name: "grep",
      label: "Grep (ripgrep)",
      description:
        "Search file contents using ripgrep. Supports full regex syntax, glob filtering, " +
        "and context lines. Output modes: content (matching lines), files_with_matches, count. " +
        "Use head_limit and offset for pagination. Sensitive files are filtered.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Regular expression to search for." }),
        path: Type.Optional(Type.String({ description: "File or directory to search. Defaults to cwd." })),
        glob: Type.Optional(Type.String({ description: "Glob filter, e.g. '*.ts'." })),
        output_mode: Type.Optional(Type.String({ description: "content | files_with_matches | count. Defaults to files_with_matches." })),
        '-i': Type.Optional(Type.Boolean({ description: "Case-insensitive. Defaults to false." })),
        '-n': Type.Optional(Type.Boolean({ description: "Show line numbers (content mode only). Defaults to true." })),
        '-A': Type.Optional(Type.Number({ description: "Lines to show after each match." })),
        '-B': Type.Optional(Type.Number({ description: "Lines to show before each match." })),
        '-C': Type.Optional(Type.Number({ description: "Lines to show before and after each match." })),
        head_limit: Type.Optional(Type.Number({ description: "Max lines to return. Defaults to 250." })),
        offset: Type.Optional(Type.Number({ description: "Skip first N lines (for pagination). Defaults to 0." })),
        include_ignored: Type.Optional(Type.Boolean({ description: "Search files ignored by .gitignore. Defaults to false." })),
      }),
      execute: async (_id, params) => {
        const p = params as Record<string, unknown>;
        const searchPath = String(p.path ?? process.cwd());
        const mode = String(p.output_mode ?? 'files_with_matches');
        const headLimit = (p.head_limit as number) ?? 250;
        const offsetVal = (p.offset as number) ?? 0;
        const includeIgnored = p.include_ignored ?? false;

        const args: string[] = ['--hidden', '--null'];
        if (!includeIgnored) args.push('--no-ignore-vcs');
        if (mode === 'files_with_matches') args.push('-l');
        else if (mode === 'count') { args.push('--count-matches', '--with-filename'); }
        else { args.push('--with-filename'); if (p['-n'] !== false) args.push('-n'); }
        if (p['-i']) args.push('-i');
        if (p['-C'] != null) args.push('-C', String(p['-C']));
        else {
          if (p['-A'] != null) args.push('-A', String(p['-A']));
          if (p['-B'] != null) args.push('-B', String(p['-B']));
        }
        if (p.glob) args.push('--glob', String(p.glob));
        for (const dir of ['.git', '.svn', '.hg']) args.push('--glob', `!${dir}`);
        args.push('--', String(p.pattern), searchPath);

        try {
          const result = await execFileP('rg', args, {
            timeout: 20_000,
            maxBuffer: 10 * 1024 * 1024,
            cwd: process.cwd(),
          });
          let lines = result.stdout.split('\n').filter(l => l !== '');
          const total = lines.length;
          lines = lines.slice(offsetVal, offsetVal + headLimit);

          // Post-filter sensitive files
          const filtered = new Set<string>();
          const kept: string[] = [];
          for (const line of lines) {
            const filePath = line.split('\0')[0] ?? line.split(':')[0] ?? '';
            if (filePath && isSensitivePath(filePath)) { filtered.add(filePath); continue; }
            kept.push(line);
          }

          let output = kept.join('\n') || 'No matches found';
          if (filtered.size > 0) {
            output += `\n<system>Filtered ${filtered.size} sensitive file(s): ${[...filtered].join(', ')}</system>`;
          }
          if (offsetVal + headLimit < total) {
            output += `\n<system>Showing ${kept.length} of ${total} results. Use offset=${offsetVal + headLimit} for more.</system>`;
          }
          return textResult(output);
        } catch (err: any) {
          if (err.code === 1) return textResult("No matches found");
          return textResult(`Grep failed: ${err.stderr || err.message}`);
        }
      },
    },

    // ── glob ────────────────────────────────────────────────────
    {
      name: "glob",
      label: "Glob (File Search)",
      description:
        "Find files matching a glob pattern. Supports brace expansion (`*.{ts,tsx}`). " +
        "Returns up to 100 matches sorted by modification time (most recent first). " +
        "Results are relative paths. Use for discovering files by name pattern.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.{ts,tsx}'." }),
        path: Type.Optional(Type.String({ description: "Directory to search in. Defaults to cwd." })),
      }),
      execute: async (_id, params) => {
        const p = params as { pattern: unknown; path?: unknown };
        const searchDir = String(p.path ?? process.cwd());
        const patterns = expandBraces(String(p.pattern));
        const results: Array<{ filePath: string; mtime: number }> = [];
        const seen = new Set<string>();
        const MAX = 100;

        for (const pat of patterns) {
          try {
            const { stdout } = await execFileP('rg', ['--files', '--glob', pat, searchDir], {
              timeout: 15_000,
              maxBuffer: 5 * 1024 * 1024,
              cwd: process.cwd(),
            });
            for (const line of stdout.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed || seen.has(trimmed)) continue;
              if (isSensitivePath(trimmed)) continue;
              if (results.length >= MAX) break;
              seen.add(trimmed);
              try { results.push({ filePath: trimmed, mtime: (await stat(trimmed)).mtimeMs }); }
              catch { results.push({ filePath: trimmed, mtime: 0 }); }
            }
          } catch (err: any) {
            if (err.code === 1) continue;
          }
        }

        if (results.length === 0) return textResult("No matches found");

        results.sort((a, b) => b.mtime - a.mtime);
        const cwd = process.cwd() + '/';
        const lines = results.map(r => r.filePath.startsWith(cwd) ? r.filePath.slice(cwd.length) : r.filePath);

        let output = lines.join('\n');
        if (results.length === MAX) {
          output += `\n<system>Found ${results.length} matches (max). Use a more specific pattern for more.</system>`;
        }
        return textResult(output);
      },
    },
  ];
}

// ─── Brace Expansion ────────────────────────────────────────────

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!match) return [pattern];
  const [, prefix, inner, suffix] = match;
  const parts = (inner ?? '').split(',').map(s => s.trim());
  if (parts.length < 2) return [pattern];
  return parts.map(p => prefix + p + suffix);
}
