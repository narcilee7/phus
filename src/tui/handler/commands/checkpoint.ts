// src/tui/handler/commands/checkpoint.ts
// Tape-backed checkpoints and undo. /checkpoint list|create|restore <n>
// manages named snapshots; /undo restores the most recent one.

import { CHECKPOINT_PREVIEW } from "@/tui/constants.js";
import type { CommandRegistry } from "@/tui/handler/commands/context.js";
import { errorMessage, notify } from "@/tui/handler/commands/notice.js";

export function registerCheckpoint(): CommandRegistry {
  return {
    async undo(_arg, { agent, dispatch }) {
      const sid = agent.getCurrentSessionId();
      if (!sid) {
        notify(dispatch, "no active session to undo", "warn");
        return;
      }
      try {
        await agent.restoreCheckpoint(sid);
        dispatch({ type: "clear_items" });
        notify(dispatch, "✓ restored to last checkpoint");
      } catch (err) {
        notify(dispatch, `undo failed: ${errorMessage(err)}`, "error");
      }
    },

    async checkpoint(arg, { agent, dispatch }) {
      const sid = agent.getCurrentSessionId();
      if (!sid) {
        notify(dispatch, "no active session", "warn");
        return;
      }
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const subArg = rest.join(" ");

      if (!sub || sub === "list") {
        const cps = agent.listCheckpoints(sid);
        if (cps.length === 0) {
          notify(dispatch, "no checkpoints for this session");
          return;
        }
        const lines = cps.slice(0, CHECKPOINT_PREVIEW).map((cp, idx) => {
          const at = new Date(cp.ts / 1000).toLocaleString();
          return `${idx + 1}. ${at} · ${cp.messages.length} messages`;
        });
        notify(dispatch, lines.join("\n"));
        return;
      }
      if (sub === "create") {
        agent.saveCheckpoint(sid);
        notify(dispatch, "✓ checkpoint created");
        return;
      }
      if (sub === "restore") {
        const index = Number(subArg);
        const cps = agent.listCheckpoints(sid);
        const cp = Number.isNaN(index) ? undefined : cps[index - 1];
        if (!cp) {
          notify(dispatch, `checkpoint ${subArg} not found`, "warn");
          return;
        }
        try {
          await agent.restoreCheckpoint(sid);
          dispatch({ type: "clear_items" });
          notify(dispatch, "✓ restored to checkpoint");
        } catch (err) {
          notify(dispatch, `restore failed: ${errorMessage(err)}`, "error");
        }
        return;
      }
      notify(
        dispatch,
        "usage: /checkpoint list | /checkpoint create | /checkpoint restore <n>",
        "warn",
      );
    },
  };
}
