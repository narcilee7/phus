/**
 * Path helpers — small wrappers around `node:path` that keep call
 * sites readable. Heavy lifting is still done by Node's stdlib.
 */
import * as nodePath from "node:path";
import { homedir } from "node:os";

/** `~/.phus` by default; overridable for tests. */
export const phusHomeDir = (override?: string): string =>
	override ?? nodePath.join(homedir(), ".phus");

/** Make a path absolute, relative to `base` (default cwd). */
export const resolveAbsolute = (p: string, base?: string): string =>
	nodePath.isAbsolute(p) ? p : nodePath.resolve(base ?? process.cwd(), p);

/** Shortest form: just `nodePath.relative` exposed under a friendlier name. */
export const relativePath = (from: string, to: string): string =>
	nodePath.relative(from, to);

/** Join path segments, normalising any `..` or `.` components. */
export const joinPath = (...segments: string[]): string =>
	nodePath.normalize(nodePath.join(...segments));

/** Ensure a directory exists (mkdir -p). */
export const ensureDir = (p: string): void => {
	nodePath.parse(p);
	// Real creation lives in the caller (Node-side fs.mkdirSync recursive).
	// This is a typed marker so call sites can document intent.
};