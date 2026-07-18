// src/tui/handler/commands/runtime.ts
// Runtime configuration commands — provider model, reasoning level,
// profile switching, plugin reload, context compaction.

import { loadConfig } from "@phus/runtime/infra/config/index.js";
import { MODEL_LIST_PREVIEW } from "@/constants.js";
import type { CommandRegistry } from "@/handler/commands/context.js";
import { errorMessage, notify } from "@/handler/commands/notice.js";

const VALID_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

export function registerRuntime(): CommandRegistry {
  return {
    "model-list": async (_arg, { dispatch }) => {
      try {
        const { getProviders, getModels } = await import("@mariozechner/pi-ai");
        const lines: string[] = [];
        for (const p of getProviders()) {
          const models = getModels(p as unknown as Parameters<typeof getModels>[0]);
          lines.push(`  ${p}:`);
          for (const m of models.slice(0, MODEL_LIST_PREVIEW)) {
            lines.push(`    - ${m.id}`);
          }
          const extra = models.length - MODEL_LIST_PREVIEW;
          if (extra > 0) lines.push(`    ... +${extra} more`);
        }
        notify(dispatch, lines.join("\n"));
      } catch (err) {
        notify(dispatch, `model-list failed: ${errorMessage(err)}`, "error");
      }
    },

    model(arg, { agent, dispatch }) {
      const current = agent.getCurrentModel();
      if (!arg) {
        notify(
          dispatch,
          `current: ${current.provider}/${current.id}\nswitch: /model <provider>/<modelId>`,
        );
        return;
      }
      const [provider, modelId] = arg.split("/", 2);
      if (!provider || !modelId) {
        notify(dispatch, "usage: /model <provider>/<modelId>", "warn");
        return;
      }
      try {
        agent.setModel(modelId, provider);
        notify(dispatch, `✓ model switched to ${provider}/${modelId}`);
      } catch (err) {
        notify(dispatch, `switch failed: ${errorMessage(err)}`, "error");
      }
    },

    reasoning(arg, { agent, dispatch }) {
      if (!arg) {
        notify(
          dispatch,
          `current: ${agent.getThinkingLevel()}\nset: /reasoning <${VALID_LEVELS.join("|")}>`,
        );
        return;
      }
      if (!VALID_LEVELS.includes(arg as (typeof VALID_LEVELS)[number])) {
        notify(dispatch, `invalid level. allowed: ${VALID_LEVELS.join(", ")}`, "warn");
        return;
      }
      agent.setThinkingLevel(arg);
      notify(dispatch, `✓ thinking level = ${arg}`);
    },

    async profiles(arg, { agent, dispatch }) {
      const {
        formatProfiles,
        resolveProfile,
        modelFromProfile,
        loadProviderConfig,
      } = await import("@phus/runtime/infra/profile.js");
      const activeName = loadConfig().profileName;
      if (!arg) {
        notify(
          dispatch,
          `── Provider profiles ──\n${formatProfiles()}\n\nactive: ${activeName}\nuse: /profiles <name>  to switch for next turn`,
        );
        return;
      }
      try {
        const cfg = loadProviderConfig();
        resolveProfile(arg, cfg);
        // Switch the live agent's model in place; the active profile is
        // an in-process concern for the TUI, so we don't mutate env.
        const next = modelFromProfile(resolveProfile(arg, cfg));
        agent.setModel(next.id, next.provider);
        notify(dispatch, `✓ switched to profile: ${arg} (${next.provider}/${next.id})`);
      } catch (err) {
        notify(dispatch, `switch failed: ${errorMessage(err)}`, "error");
      }
    },

    async reload(_arg, { agent, dispatch }) {
      try {
        const result = await agent.loadPluginsForReload([]);
        notify(dispatch, `✓ reloaded: ${result.skills} skills, ${result.plugins} plugins`);
      } catch (err) {
        notify(dispatch, `reload failed: ${errorMessage(err)}`, "error");
      }
    },

    async compact(_arg, { agent, dispatch }) {
      const sid = agent.getCurrentSessionId();
      if (!sid) {
        notify(dispatch, "no active session to compact", "warn");
        return;
      }
      try {
        agent.setNextSessionId(sid);
        const out = await agent.compactCurrentSession();
        notify(dispatch, out);
      } catch (err) {
        notify(dispatch, `compact failed: ${errorMessage(err)}`, "error");
      }
    },
  };
}
