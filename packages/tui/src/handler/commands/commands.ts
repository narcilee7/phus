// src/tui/handler/commands/commands.ts
// Slash command dispatcher. Backed by per-cluster registries merged at
// runtime; see ./runtime.ts, ./session.ts, ./skills.ts, ./exec.ts,
// ./safety.ts, ./checkpoint.ts, ./plan.ts, ./subagent.ts, ./help.ts.
//
// Returns "quit" / "clear" so callers can propagate exit / wipe.

import type {
  CommandContext,
  CommandHandler,
  CommandRegistry,
} from "@/handler/commands/context.js";
import type { AppAction, AppState } from "@/state/state.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { loadConfig } from "@phus/runtime/infra/config/index.js";
import { registerRuntime } from "@/handler/commands/runtime.js";
import { registerSession } from "@/handler/commands/session.js";
import { registerSkills } from "@/handler/commands/skills.js";
import { registerExec } from "@/handler/commands/exec.js";
import { registerSafety } from "@/handler/commands/safety.js";
import { registerCheckpoint } from "@/handler/commands/checkpoint.js";
import { registerPlan } from "@/handler/commands/plan.js";
import { registerSubagent } from "@/handler/commands/subagent.js";
import { registerHelp, HELP_TEXT, SLASH_COMMANDS } from "@/handler/commands/help.js";
import { notify } from "@/handler/commands/notice.js";

export type SlashResult = "quit" | "clear" | void;
export { HELP_TEXT, SLASH_COMMANDS };

/** Registry of every slash command, keyed by name. Built once on first
 *  use — subsequent calls reuse the same memoized object. */
let _registry: CommandRegistry | undefined;
function registry(): CommandRegistry {
  if (_registry) return _registry;
  _registry = {
    ...registerRuntime(),
    ...registerSession(),
    ...registerSkills(),
    ...registerExec(),
    ...registerSafety(),
    ...registerCheckpoint(),
    ...registerPlan(),
    ...registerSubagent(),
    ...registerHelp(),
  };
  return _registry;
}

/** Internal Bub-style ,foo command runner. Lives here because it is the
 *  other half of the slash dispatcher. */
async function runInternalCommand(
  line: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): Promise<SlashResult> {
  const { execute, initInternalCommands } = await import(
    "@phus/runtime/core/runtime/internal-commands/index.js"
  );
  initInternalCommands({
    agent,
    home: () => loadConfig().paths.home,
    mesh: agent.getMesh(),
  });
  const result = await execute(line, "tui");
  if (result === "__QUIT_TUI__") return "quit";
  if (result === "__CLEAR_TUI__") return "clear";
  if (result && result !== "not-a-command") {
    notify(dispatch, result);
  }
  return;
}

/** Dispatch a slash command. Mutates state via `dispatch`.
 *  Returns special signals ("quit", "clear") so the caller can
 *  exit the TUI or wipe the chat area. */
export async function runSlash(
  cmd: string,
  agent: PhusAgent,
  state: AppState,
  dispatch: (action: AppAction) => void,
): Promise<SlashResult> {
  const trimmed = cmd.trim();

  // Bub-style ,foo commands (also accepted in TUI).
  if (trimmed.startsWith(",")) {
    return runInternalCommand(trimmed, agent, dispatch);
  }
  if (!trimmed.startsWith("/")) return;

  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  if (!name) return;

  const handler = registry()[name] as CommandHandler | undefined;
  if (!handler) {
    notify(dispatch, `unknown command: /${name}. Try /help.`, "warn");
    return;
  }
  const ctx: CommandContext = { agent, state, dispatch };
  // `quit` / `clear` from session.ts return the typed `never`; cast to
  // pick those signals back up here.
  const result = (await handler(arg, ctx)) as SlashResult | undefined;
  if (result === "quit" || result === "clear") return result;
}
