// src/tui/constants.ts
// Magic numbers and shared sets used across the TUI. Keep them here so
// the layout math is greppable and the policy tool list isn't repeated.

/** Row budget for the top header bar (title + session line + borders). */
export const HEADER_ROWS = 4;

/** Row budget for the input box (prompt + typing line + borders). */
export const INPUT_ROWS = 3;

/** Row budget for the bottom status bar. */
export const STATUS_ROWS = 1;

/** Row budget for an expanded plan panel (full timeline visible). */
export const PLAN_ROWS_EXPANDED = 16;

/** Row budget for the collapsed plan summary. */
export const PLAN_ROWS_COLLAPSED = 6;

/** Row budget for the TodoPill (single row when busy). */
export const TODO_ROWS = 1;

/** Row budget for the permission Y/S/A/N bar. */
export const PERMISSION_ROWS = 4;

/** Row budget for the command palette overlay (Ctrl+K). */
export const PALETTE_ROWS = 14;

/** Minimum chat viewport height — guarantees the spinner stays readable. */
export const MIN_CHAT_HEIGHT = 6;

/**
 * Upper-bound estimate for the rendered row count of a single chat
 * item. Used by the Ctrl+O mass-toggle heuristic in App.ts: we
 * don't have actual rendered heights in the App layer, so we walk
 * the items list assuming each one is at most this many rows tall.
 * Deliberately over-sized — the visible window may include a couple
 * of "barely off-screen" items at the top, and toggling those is
 * harmless. 60 is enough for a long markdown assistant reply or a
 * multi-line tool result; anything beyond is genuinely off-screen
 * for the standard 30+ row terminal.
 */
export const MAX_ITEM_ROWS = 60;

/** Minimum sidebar height so the tree doesn't get truncated to a sliver. */
export const MIN_SIDEBAR_HEIGHT = 10;

/** How long the "Ctrl+Z undo" hint lingers after a file write completes. */
export const WRITE_HINT_TTL_MS = 10_000;

/** Status bar / tape stats refresh interval. */
export const STATS_TICK_MS = 1_500;

/** Hard timeout for /bash so a runaway shell doesn't lock the TUI. */
export const BASH_TIMEOUT_MS = 30_000;

/** How many models to show per provider in /model-list before "+N more". */
export const MODEL_LIST_PREVIEW = 8;

/** How many checkpoints /checkpoint lists at a time. */
export const CHECKPOINT_PREVIEW = 10;

/** /trace default — number of recent turns to render. */
export const TURN_TRACE_PREVIEW = 5;

/** Inbound-content truncation length for /trace. */
export const TURN_TRACE_CHARS = 60;

/** Tool names whose calls always go through the permission bar (unless
 *  already in the always-allow / session-allow set). Module-level Set so
 *  identity is stable and the membership check stays O(1). */
export const DANGEROUS_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "file_write",
  "startup_write",
  "skill_write",
  "skill_delete",
  "memory_write",
]);
