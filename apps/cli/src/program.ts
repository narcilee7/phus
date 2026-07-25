// src/cli/program.ts
// Commander wiring for every `phus <cmd>` entry point.
//
// Each command file under `cli/commands/` exports a single
// `register(program)` function. `buildProgram()` assembles them in
// order, then drains the plugin CLI command queue before parsing.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { drainPendingCliCommands } from "@phus/runtime/infra/plugins/cli-queue.js";
import type { ResolvedConfig } from "@phus/runtime/infra/config/index.js";

function findPackageJson(startDir: string): string | undefined {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = resolve(dir, "package.json");
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      dir = dirname(dir);
    }
  }
  return undefined;
}

const packageJsonPath = findPackageJson(dirname(fileURLToPath(import.meta.url)));
const cliVersion = packageJsonPath
  ? (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string }).version
  : "0.0.0";

import { registerChatCommand } from "./commands/chat.js";
import { registerRunCommand } from "./commands/run.js";
import { registerGatewayCommand } from "./commands/gateway.js";
import { registerGatewayDaemonCommands } from "@phus/runtime/commands/gateway-daemon.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerSkillCreateCommand } from "./commands/skill-create.js";
import { registerTapeCommand } from "./commands/tape.js";
import { registerPolicyCommand } from "./commands/policy.js";
import { registerTasksCommand } from "./commands/tasks.js";
import { registerProfilesCommand } from "./commands/profiles.js";
import { registerMeshCommand } from "./commands/mesh.js";
import { registerPluginsListCommand } from "./commands/plugins-list.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerCompactCommand } from "./commands/compact.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerMetricsCommand } from "./commands/metrics.js";

/** Build the Commander program with every built-in subcommand
 *  registered. Plugin commands are drained later via
 *  `drainPendingCliCommands(program)`. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("phus")
    .description("⛰️  Phus — self-evolving agent. Push the stone up the mountain.")
    .version(cliVersion);

  // Register every built-in command. Order does not matter for
  // dispatch; we keep the lifecycle-relevant ones first.
  // `phus tui` is intentionally NOT registered — typing `phus tui` is a
  // usage error. The TUI is the implicit default: `phus` (no args) wakes
  // it via the `program.action(...)` block in `apps/cli/src/main.ts`.
  // See documents/Proposal-Monorepo-Split.md §4.
  registerChatCommand(program);
  registerRunCommand(program);
  registerGatewayCommand(program);
  registerGatewayDaemonCommands(program);
  registerHooksCommand(program);
  registerSkillsCommand(program);
  registerSkillCreateCommand(program);
  registerTapeCommand(program);
  registerPolicyCommand(program);
  registerTasksCommand(program);
  registerProfilesCommand(program);
  registerMeshCommand(program);
  registerPluginsListCommand(program);
  registerTraceCommand(program);
  registerLogsCommand(program);
  registerCompactCommand(program);
  registerHealthCommand(program);
  registerSetupCommand(program);
  registerResumeCommand(program);
  registerMetricsCommand(program);

  return program;
}

/** Drain the plugin-provided CLI commands queued via
 *  `PluginContext.registerCliCommand` into `program`. Plugin commands
 *  are added after built-ins so users see phus-native help first. */
export async function registerPluginCliCommands(program: Command, config: ResolvedConfig): Promise<void> {
  // 1. Drain queue (set by PluginContext.registerCliCommand during plugin load)
  const beforeCount = (await import("@phus/runtime/infra/plugins/cli-queue.js"))._pendingCliCommandCount();
  try {
    drainPendingCliCommands(program);
  } catch (err) {
    const { logger } = await import("@phus/runtime/infra/logging.js");
    logger.error("plugin.cli_command_failed", {
      count: beforeCount,
      error: (err as Error).message,
    });
  }

  // 2. Run the register_cli_commands hook (plugins that prefer the hook).
  //    Throwaway PhusAgent uses the pre-loaded config — no re-parse.
  //    If the agent cannot be created (e.g. no API key), log a warning and
  //    continue so help/setup/version commands still work.
  const { PhusAgent } = await import("@phus/runtime/bridge/pi-agent.js");
  const { makeCtx } = await import("@phus/core/runtime/hook/ctx-builder.js");
  const { initInternalCommands } = await import("@phus/runtime/runtime/internal-commands/index.js");

  let tempHandle;
  try {
    tempHandle = await PhusAgent.create({ config, profileName: config.profileName });
  } catch (err: any) {
    const { logger } = await import("@phus/runtime/infra/logging.js");
    logger.warn("plugin.agent_creation_skipped", {
      reason: err.message,
      hint: "run `phus setup` to configure an API key",
    });
    return;
  }

  initInternalCommands({
    agent: tempHandle.agent,
    home: () => config.paths.home,
    mesh: tempHandle.internals.mesh,
  });
  const ctx = makeCtx({
    state: {},
    tape: tempHandle.internals.tape,
    skills: tempHandle.internals.skills,
    extras: { program, config },
  });
  await tempHandle.internals.hooks.execute(
    "register_cli_commands",
    ctx,
    "broadcast",
  );
}
