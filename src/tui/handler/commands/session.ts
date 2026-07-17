// src/tui/handler/commands/session.ts
// Session-scoped commands — list sessions, switch active session, dump
// context, forget history, trace recent turns, tape stats, retry last
// prompt, start fresh, clear chat area, quit / exit.

import { asSessionId } from "@/types/brand.js";
import { TURN_TRACE_CHARS, TURN_TRACE_PREVIEW } from "@/tui/constants.js";
import { truncate } from "@/tui/state/state.js";
import type { CommandRegistry } from "@/tui/handler/commands/context.js";
import { errorMessage, notify } from "@/tui/handler/commands/notice.js";

export function registerSession(): CommandRegistry {
  return {
    quit() {
      return "quit" as never;
    },
    exit() {
      return "quit" as never;
    },
    clear() {
      return "clear" as never;
    },

    sessions(_arg, { agent, dispatch }) {
      const s = agent.getTapeStats();
      const list = Object.entries(s.sessions)
        .sort((a, b) => b[1] - a[1])
        .map(([sid, n]) => `  ${sid}  (${n} entries)`)
        .join("\n");
      notify(dispatch, `sessions:\n${list || "(none)"}`);
    },

    use(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /use <sessionId>", "warn");
        return;
      }
      agent.setNextSessionId(asSessionId(arg));
      notify(dispatch, `✓ next turn will use session: ${arg}`);
    },

    context(_arg, { agent, dispatch }) {
      const m = agent.getCurrentModel();
      const skills = agent.getSkillsPrompt();
      const tapeSum = agent.getTapeSummary(agent.getCurrentSessionId(), 5);
      notify(
        dispatch,
        [
          `model: ${m.provider}/${m.id}`,
          `thinking: ${agent.getThinkingLevel()}`,
          `messages: ${agent.getMessageCount()}`,
          "",
          "── skills ──",
          skills || "(none)",
          "",
          "── recent tape ──",
          tapeSum || "(empty)",
        ].join("\n"),
      );
    },

    async forget(_arg, { agent, dispatch }) {
      await agent.clearConversation();
      notify(dispatch, "✓ conversation cleared (tape intact)");
    },

    trace(arg, { agent, dispatch }) {
      const n = parseInt(arg, 10) || TURN_TRACE_PREVIEW;
      const lines: string[] = [];
      let count = 0;
      const all = Array.from(agent.replayTape(undefined));
      for (let i = all.length - 1; i >= 0 && count < n; i--, count++) {
        const e = all[i]!;
        if (e.kind === "turn") {
          const t = (e as { turn: { ts: number; inbound: { from: string; content: string | undefined } } }).turn;
          const u = truncate(t.inbound.content ?? "", TURN_TRACE_CHARS).replace(/\n/g, " ");
          lines.push(
            `  [${new Date(t.ts).toISOString().slice(11, 19)}] ${t.inbound.from}: ${u}`,
          );
        }
      }
      notify(dispatch, lines.length ? lines.join("\n") : "(empty)");
    },

    tape(_arg, { agent, dispatch }) {
      notify(dispatch, JSON.stringify(agent.getTapeStats(), null, 2));
    },

    retry(arg, { state, dispatch }) {
      const lastUser = [...state.items].reverse().find((it) => it.kind === "user");
      if (!lastUser?.text) {
        notify(dispatch, "nothing to retry", "warn");
        return;
      }
      // Caller (App.tsx) will pick this up via the items state; the input
      // field is owned by App. We push the user item a second time via
      // dispatch on the caller side; here we just notify.
      notify(dispatch, `(retry requested — press Enter to re-submit)`);
      void arg;
    },

    async new(arg, { agent, dispatch }) {
      await agent.clearConversation();
      dispatch({ type: "clear_items" });
      dispatch({ type: "clear_session_allowed_tools" });
      notify(dispatch, `✓ fresh session started`);
      void arg;
    },
  };
}
