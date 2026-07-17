// src/infra/memory/index.ts
// Aggregator for the project-memory subsystem.

export {
  MemoryStore,
  MEMORY_PROMPT_BUDGET_BYTES,
  MEMORY_FILE_SOFT_LIMIT_BYTES,
  MEMORY_CATEGORIES,
  MEMORY_AUTHORITIES,
  MEMORY_AUTHORITY_WEIGHT,
  inferCategory,
} from "./store.js";
export type {
  MemoryAction,
  MemoryActionKind,
  MemoryCategory,
  MemoryAuthority,
  ApplyResult,
} from "./store.js";

export { AutonomyGate, decide, actionTag } from "./autonomy.js";
export type { Decision } from "./autonomy.js";
