// src/core/exit-codes.ts
// Distinct process exit codes so scripts can react appropriately.
//
// Phus CLI commands should use these instead of hardcoded 1.

export const ExitCode = {
  OK: 0,
  USER_ERROR: 1,        // bad arguments, unknown command, invalid input
  CONFIG_ERROR: 2,      // missing API key, invalid profile, broken phus.config.yaml
  RUNTIME_ERROR: 3,     // turn failed mid-execution
  POLICY_BLOCKED: 4,    // safety policy blocked a tool call
  INFRA_ERROR: 5,       // network/DB/filesystem failure
  NOT_FOUND: 6,         // session/skill/file not found
  ALREADY_EXISTS: 7,    // duplicate registration
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Throwing this in a CLI action handler will exit with the given code. */
export class CliExit extends Error {
  constructor(public code: ExitCodeValue, message: string) {
    super(message);
    this.name = "CliExit";
  }
}
