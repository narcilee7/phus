// src/core/internal-commands/builtins/index.ts
// Aggregator for the built-in command clusters. Phase 4 will reshape
// the services parameter as `_internal` reach-through is replaced
// with narrow capabilities.

import type {
  InternalCommand,
  InternalCommandServices,
} from "../types.js";
import { defineFilesystemCommands } from "./filesystem.js";
import { defineMaintenanceCommands } from "./maintenance.js";
import { defineMeshCommands } from "./mesh.js";
import { defineScheduleCommands } from "./schedule.js";
import { defineSkillCommands } from "./skills.js";
import { defineTapeCommands } from "./tape.js";
import { definePlanCommands } from "./plan.js";

/** All built-in command clusters. */
export function defineAllBuiltinCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    ...defineSkillCommands(services),
    ...defineTapeCommands(services),
    ...defineFilesystemCommands(services),
    ...defineMaintenanceCommands(services),
    ...defineMeshCommands(services),
    ...defineScheduleCommands(services),
    ...definePlanCommands(services),
  ];
}