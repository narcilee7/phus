// src/core/policy.ts
// Operator-equivalence safety policy (Bub principle).
// Enforced via the before_tool_call hook in PhusAgent so it applies
// uniformly to every tool — meta tools and external tools alike.

import * as path from "node:path";

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string };

export interface PolicyContext {
  toolName: string;
  args: Record<string, unknown>;
  /** Absolute cwd for resolving relative paths. */
  cwd: string;
}

export interface PolicyRule {
  /** Match tools by exact name. */
  toolName: string;
  /** Return decision for this tool call. */
  evaluate: (args: Record<string, unknown>, cwd: string) => PolicyDecision;
}

const DEFAULT_BASH_BLOCKLIST: RegExp[] = [
  // Destructive recursive delete
  /\brm\s+(-[a-z]*f[a-z]*\s+)?-[a-z]*r[a-z]*\s+\/\s*$/i,
  /\brm\s+-[a-z]*r[a-z]*\s+\/(?:\s|$)/i,
  // Fork bomb
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  // Pipe remote script to shell
  /\bcurl\b[^|]*\|\s*(?:ba)?sh\b/,
  /\bwget\b[^|]*\|\s*(?:ba)?sh\b/,
  // Raw disk write
  /\bdd\s+if=/,
  // chmod 777 on root
  /\bchmod\s+-R\s+777\s+\//,
  // mkfs
  /\bmkfs(\.[a-z0-9]+)?\s+\/dev\//,
];

/**
 * Default safety config: file writes allowed anywhere in the workspace.
 * Operators tighten this via `phus.config.yaml`:
 *
 *   safety:
 *     fileWriteRoots:
 *       - "./skills"
 *       - "./.phus"
 *       - "./tmp"
 *       - "./out"
 *
 * The `./` default keeps the typical local-edit flow unblocked while
 * still routing every `file_write` through the per-call permission
 * gate (`toolPermissionHandler`), which is where the operator sees
 * the diff and approves/denies. Setting an explicit, narrower list is
 * the right move for shared / multi-tenant deployments.
 */
export const DEFAULT_FILE_WRITE_ROOTS: readonly string[] = ["./"];

export interface SafetyOptions {
  /** Override the default `file_write` allowlist. Absolute paths and
   *  cwd-relative paths are both accepted. */
  fileWriteRoots?: string[];
}

/** Build the default policy rule set. */
export function defaultPolicy(
  cwd: string = process.cwd(),
  opts: SafetyOptions = {},
): PolicyRule[] {
  const roots = (opts.fileWriteRoots && opts.fileWriteRoots.length > 0)
    ? opts.fileWriteRoots
    : [...DEFAULT_FILE_WRITE_ROOTS];
  return [
    fileWriteAllowlist(roots, cwd),
    bashBlocklist(DEFAULT_BASH_BLOCKLIST),
  ];
}

/** Allow file_write only if the target path is under one of the allowed roots. */
export function fileWriteAllowlist(roots: string[], cwd: string): PolicyRule {
  const absRoots = roots.map((r) => path.resolve(cwd, r));
  return {
    toolName: "file_write",
    evaluate: (args) => {
      const raw = String(args.path ?? "");
      if (!raw) return { allow: false, reason: "file_write: missing path" };
      const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
      const ok = absRoots.some((root) => abs === root || abs.startsWith(root + path.sep));
      if (!ok) {
        return {
          allow: false,
          reason: `file_write: path "${raw}" is outside allowed roots (${roots.join(", ")})`,
        };
      }
      return { allow: true };
    },
  };
}

/** Block bash commands matching any dangerous pattern. */
export function bashBlocklist(patterns: RegExp[]): PolicyRule {
  return {
    toolName: "bash",
    evaluate: (args) => {
      const cmd = String(args.command ?? "");
      for (const re of patterns) {
        if (re.test(cmd)) {
          return { allow: false, reason: `bash: blocked by policy pattern ${re}` };
        }
      }
      return { allow: true };
    },
  };
}

/** Apply a rule set to a tool call. Returns the first matching rule's decision,
 *  or allow if no rule matches. */
export function evaluate(
  rules: PolicyRule[],
  ctx: PolicyContext,
): PolicyDecision {
  for (const rule of rules) {
    if (rule.toolName === ctx.toolName) {
      return rule.evaluate(ctx.args, ctx.cwd);
    }
  }
  return { allow: true };
}
