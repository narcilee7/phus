// src/core/internal-commands/builtins/index.ts
// Aggregator for the built-in command clusters. Phase 4 will reshape
// the services parameter as `_internal` reach-through is replaced
// with narrow capabilities.

import type {
  InternalCommand,
  InternalCommandServices,
} from "../types";
import { defineEvolutionCommands } from "./evolution";
import { defineFilesystemCommands } from "./filesystem";
import { defineMaintenanceCommands } from "./maintenance";
import { defineMeshCommands } from "./mesh";
import { defineScheduleCommands } from "./schedule";
import { defineSkillCommands } from "./skills";
import { defineTapeCommands } from "./tape";
import { definePlanCommands } from "./plan";

/** All built-in command clusters. */
export function defineAllBuiltinCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    ...defineEvolutionCommands(services),
    ...defineSkillCommands(services),
    ...defineTapeCommands(services),
    ...defineFilesystemCommands(services),
    ...defineMaintenanceCommands(services),
    ...defineMeshCommands(services),
    ...defineScheduleCommands(services),
    ...definePlanCommands(services),
  ];
}
