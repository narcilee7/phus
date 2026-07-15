// src/cli/program.ts
// Commander wiring for every `phus <cmd>` entry point.
//
// Each command file under `cli/commands/` exports a single
// `register(program)` function. `buildProgram()` assembles them in
// order, then drains the plugin CLI command queue before parsing.

import { Command } from "commander";
import { drainPendingCliCommands } from "@/infra/plugins/cli-queue.js";

import { registerDefaultCommand } from "./commands/default.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerRunCommand } from "./commands/run.js";
import { registerGatewayCommand } from "./commands/gateway.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerTapeCommand } from "./commands/tape.js";
import { registerPolicyCommand } from "./commands/policy.js";
import { registerTasksCommand } from "./commands/tasks.js";
import { registerProfilesCommand } from "./commands/profiles.js";
import { registerPluginsListCommand } from "./commands/plugins-list.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerCompactCommand } from "./commands/compact.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerTuiCommand } from "./commands/tui.js";
import { registerResumeCommand } from "./commands/resume.js";

/** Build the Commander program with every built-in subcommand
 *  registered. Plugin commands are drained later via
 *  `drainPendingCliCommands(program)`. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("phus")
    .description("⛰️  Phus — self-evolving agent. Push the stone up the mountain.")
    .version("0.1.0");

  // Register every built-in command. Order does not matter for
  // dispatch; we keep the lifecycle-relevant ones first.
  registerDefaultCommand(program);
  registerChatCommand(program);
  registerTuiCommand(program);
  registerRunCommand(program);
  registerGatewayCommand(program);
  registerHooksCommand(program);
  registerSkillsCommand(program);
  registerTapeCommand(program);
  registerPolicyCommand(program);
  registerTasksCommand(program);
  registerProfilesCommand(program);
  registerPluginsListCommand(program);
  registerTraceCommand(program);
  registerLogsCommand(program);
  registerCompactCommand(program);
  registerHealthCommand(program);
  registerResumeCommand(program);

  return program;
}

/** Drain the plugin-provided CLI commands queued via
 *  `PluginContext.registerCliCommand` into `program`. Plugin commands
 *  are added after built-ins so users see phus-native help first. */
export async function registerPluginCliCommands(program: Command): Promise<void> {
  // 1. Drain queue (set by PluginContext.registerCliCommand during plugin load)
  const beforeCount = (await import("@/infra/plugins/cli-queue.js"))._pendingCliCommandCount();
  try {
    drainPendingCliCommands(program);
  } catch (err) {
    const { logger } = await import("@/infra/logging.js");
    logger.error("plugin.cli_command_failed", {
      count: beforeCount,
      error: (err as Error).message,
    });
  }

  // 2. Run the register_cli_commands hook (plugins that prefer the hook)
  //    Note: we need a PhusAgent just to access the HookRegistry. We
  //    don't actually start a turn — the agent is created lazily.
  const { PhusAgent } = await import("@/bridge/pi-agent.js");
  const { makeCtx } = await import("@/core/runtime/hook.js");
  const { initInternalCommands } = await import("@/core/runtime/internal-commands/index.js");
  const tempHandle = await PhusAgent.create();
  initInternalCommands({
    agent: tempHandle.agent,
    home: () => process.env.PHUS_HOME ?? "./.phus",
    mesh: tempHandle.internals.mesh,
  });
  const ctx = makeCtx({
    state: {},
    tape: tempHandle.internals.tape,
    skills: tempHandle.internals.skills,
    extras: { program },
  });
  await tempHandle.internals.hooks.execute(
    "register_cli_commands",
    ctx,
    "broadcast",
  );
}