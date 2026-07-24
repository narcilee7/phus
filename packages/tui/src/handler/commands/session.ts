// src/tui/handler/commands/session.ts
// Session-scoped commands — list sessions, switch active session, dump
// context, forget history, trace recent turns, tape stats, retry last
// prompt, start fresh, clear chat area, quit / exit.

import { asSessionId } from "@phus/core/types/brand.js";
import { TURN_TRACE_CHARS, TURN_TRACE_PREVIEW } from "../../constants.js";
import { truncate } from "../../state/state.js";
import type { CommandRegistry } from "./context.js";
import { errorMessage, notify } from "./notice.js";
import type { Session, SessionFilter } from "@phus/core/types/session/index.js";

const STATUS_MARK: Record<Session["status"], string> = {
	open: "●",
	closed: "○",
	archived: "×",
};

function pickSession(
	agent: { listSessions(filter?: SessionFilter): Session[]; getSession(id: string): Session | undefined },
	ref: string,
	filter: SessionFilter = {},
): Session | undefined {
	const all = agent.listSessions({ includeArchived: true, ...filter });
	const direct = all.find((s) => s.id === ref);
	if (direct) return direct;
	const prefixed = all.find((s) => s.id.startsWith(ref));
	if (prefixed) return prefixed;
	const refAddr = ref.includes(":") ? ref : null;
	if (refAddr) {
		const [channel, ...rest] = refAddr.split(":");
		return all.find((s) =>
			s.origin.channel === channel && s.origin.conversationKey === rest.join(":"));
	}
	return undefined;
}

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
      const all = agent.listSessions({ includeArchived: true });
      const list = all
        .slice()
        .sort((a, b) => (b.lastTurnAt ?? b.updatedAt) - (a.lastTurnAt ?? a.updatedAt))
        .map((s) => {
          const mark = STATUS_MARK[s.status] ?? "?";
          const addr = `${s.origin.channel}:${s.origin.scope}:${s.origin.conversationKey}`;
          const thread = s.origin.threadKey ? `:${s.origin.threadKey}` : "";
          const last = s.lastTurnAt
            ? new Date(s.lastTurnAt).toISOString().slice(0, 19)
            : "—";
          return `  ${mark} ${s.id.slice(0, 8)}  ${addr}${thread}  ${s.status}  last=${last}`;
        })
        .join("\n");
      notify(dispatch, `sessions:\n${list || "(none)"}`);
    },

    use(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /use <sessionId|prefix|channel:conversationKey>", "warn");
        return;
      }
      const target = pickSession(agent, arg);
      if (!target) {
        notify(dispatch, `no session matches "${arg}"`, "warn");
        return;
      }
      if (target.status !== "open") {
        notify(dispatch, `session is ${target.status}; reopen it first`, "warn");
        return;
      }
      try {
        agent.setNextSessionId(target.id);
        notify(dispatch, `✓ active session: ${target.id.slice(0, 8)}  ${target.origin.channel}:${target.origin.conversationKey}`);
      } catch (err) {
        notify(dispatch, errorMessage(err), "error");
      }
    },

    close(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /close <sessionId|prefix>", "warn");
        return;
      }
      const target = pickSession(agent, arg);
      if (!target) {
        notify(dispatch, `no session matches "${arg}"`, "warn");
        return;
      }
      if (target.status === "closed") {
        notify(dispatch, `already closed`, "info");
        return;
      }
      if (target.status === "archived") {
        notify(dispatch, `archived; reopen it first`, "warn");
        return;
      }
      try {
        agent.closeSession(target.id);
        notify(dispatch, `✓ closed ${target.id.slice(0, 8)}`);
      } catch (err) {
        notify(dispatch, errorMessage(err), "error");
      }
    },

    reopen(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /reopen <sessionId|prefix>", "warn");
        return;
      }
      const target = pickSession(agent, arg, { includeArchived: true });
      if (!target) {
        notify(dispatch, `no session matches "${arg}"`, "warn");
        return;
      }
      if (target.status === "open") {
        notify(dispatch, `already open`, "info");
        return;
      }
      try {
        agent.reopenSession(target.id);
        notify(dispatch, `✓ reopened ${target.id.slice(0, 8)}`);
      } catch (err) {
        notify(dispatch, errorMessage(err), "error");
      }
    },

    archive(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /archive <sessionId|prefix>", "warn");
        return;
      }
      const target = pickSession(agent, arg, { includeArchived: true });
      if (!target) {
        notify(dispatch, `no session matches "${arg}"`, "warn");
        return;
      }
      if (target.status === "archived") {
        notify(dispatch, `already archived`, "info");
        return;
      }
      try {
        agent.archiveSession(target.id);
        notify(dispatch, `✓ archived ${target.id.slice(0, 8)}`);
      } catch (err) {
        notify(dispatch, errorMessage(err), "error");
      }
    },

    end(_arg, { agent, dispatch }) {
      const id = agent.getCurrentSessionId();
      if (!id) {
        notify(dispatch, `no active session`, "warn");
        return;
      }
      const target = agent.getSession(id);
      if (!target) {
        notify(dispatch, `current session missing from catalog`, "warn");
        return;
      }
      try {
        agent.closeSession(target.id);
        void agent.clearConversation();
        dispatch({ type: "clear_items" });
        dispatch({ type: "clear_session_allowed_tools" });
        notify(dispatch, `✓ ended ${target.id.slice(0, 8)} (use /reopen to resume)`);
      } catch (err) {
        notify(dispatch, errorMessage(err), "error");
      }
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
