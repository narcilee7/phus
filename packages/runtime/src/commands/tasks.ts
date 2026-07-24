// src/commands/tasks.ts
// `phus tasks` — show active/long-running/scheduled state.
// Reuses scheduler + tape data, no separate state to maintain.

import { PhusAgent } from "../bridge/pi-agent.js";
import { getScheduler, nextFires } from "@phus/core/runtime/scheduler/index.js";
import { listCheckpoints, loadLatestCheckpoint } from "@phus/core/session/checkpoint.js";
import type { Session, SessionStatus } from "@phus/core/types/session/index.js";
import { asSessionId } from "@phus/core/types/brand.js";

export interface TasksOutput {
  agent: {
    model: string;
    thinking: string;
    messageCount: number;
    lastCheckpoint?: { ts: number; messages: number };
  };
  sessions: Array<{
    id: string;
    status: SessionStatus;
    address: string;
    threadKey?: string;
    lastTurnAt?: number;
    entries: number;
  }>;
  schedules: Array<{ name: string; cron: string; hookName: string; enabled: boolean; nextFire?: string }>;
  recentCheckpoints: Array<{ sessionId: string; ts: number; turnId?: string }>;
}

const SESSION_STATUS_MARK: Record<SessionStatus, string> = {
  open: "●",
  closed: "○",
  archived: "×",
};

export async function collectTasks(): Promise<TasksOutput> {
  const handle = await PhusAgent.create();
  const { internals } = handle;
  const model = internals.getCurrentModel();
  const tape = internals.tape;
  const agent = handle.agent;

  const selectedId = agent.getCurrentSessionId() ?? asSessionId("default");
  const lastCp = loadLatestCheckpoint(tape, selectedId);

  const schedules = (getScheduler()?.list() ?? []).map((s) => {
    let nextFire: string | undefined;
    try {
      const next = nextFires(s.cron, 1)[0];
      if (next) nextFire = next.toISOString();
    } catch {
      // invalid cron, skip
    }
    return {
      name: s.name,
      cron: s.cron,
      hookName: s.hookName,
      enabled: s.enabled !== false,
      nextFire,
    };
  });

  const all = agent.listSessions({ includeArchived: true });
  const tapeCounts = tape.stats().sessions;
  const sessions = all
    .slice()
    .sort((a, b) => (b.lastTurnAt ?? b.updatedAt) - (a.lastTurnAt ?? a.updatedAt))
    .map((s: Session) => ({
      id: s.id,
      status: s.status,
      address: `${s.origin.channel}:${s.origin.scope}:${s.origin.conversationKey}`,
      threadKey: s.origin.threadKey,
      lastTurnAt: s.lastTurnAt,
      entries: tapeCounts[s.id] ?? 0,
    }));

  const recentCheckpoints = listCheckpoints(tape, selectedId)
    .slice(0, 5)
    .map((cp) => ({ sessionId: cp.sessionId, ts: cp.ts, turnId: cp.turnId }));

  await handle.dispose();

  return {
    agent: {
      model: `${model.provider}/${model.id}`,
      thinking: String(internals.getThinkingLevel() ?? ""),
      messageCount: internals.getMessageCount(),
      lastCheckpoint: lastCp
        ? { ts: lastCp.ts, messages: Array.isArray(lastCp.messages) ? lastCp.messages.length : 0 }
        : undefined,
    },
    sessions,
    schedules,
    recentCheckpoints,
  };
}

export function renderTasks(o: TasksOutput): string {
  const lines: string[] = [];
  lines.push("── Agent ──");
  lines.push(`  model:    ${o.agent.model}`);
  lines.push(`  thinking: ${o.agent.thinking}`);
  lines.push(`  messages: ${o.agent.messageCount}`);
  if (o.agent.lastCheckpoint) {
    lines.push(
      `  checkpoint: ${new Date(o.agent.lastCheckpoint.ts).toISOString()} (${o.agent.lastCheckpoint.messages} msgs)`,
    );
  }

  lines.push("");
  lines.push(`── Sessions (${o.sessions.length}) ──`);
  if (o.sessions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of o.sessions.slice(0, 10)) {
      const mark = SESSION_STATUS_MARK[s.status] ?? "?";
      const lastTurn = s.lastTurnAt
        ? new Date(s.lastTurnAt).toISOString().slice(0, 19)
        : "—";
      const thread = s.threadKey ? `:${s.threadKey}` : "";
      lines.push(
        `  ${mark} ${s.id.slice(0, 8).padEnd(8)} ${s.status.padEnd(8)} ` +
        `${s.address}${thread}  last=${lastTurn}  entries=${s.entries}`,
      );
    }
    if (o.sessions.length > 10) lines.push(`  ... +${o.sessions.length - 10} more`);
  }

  lines.push("");
  lines.push(`── Schedules (${o.schedules.length}) ──`);
  if (o.schedules.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of o.schedules) {
      const mark = s.enabled ? "●" : "○";
      const next = s.nextFire ? `  next: ${s.nextFire}` : "";
      lines.push(`  ${mark} ${s.name.padEnd(24)} ${s.cron.padEnd(14)} → ${s.hookName}${next}`);
    }
  }

  lines.push("");
  lines.push(`── Recent checkpoints (${o.recentCheckpoints.length}) ──`);
  if (o.recentCheckpoints.length === 0) {
    lines.push("  (none)");
  } else {
    for (const cp of o.recentCheckpoints) {
      lines.push(`  [${new Date(cp.ts).toISOString().slice(0, 19)}] ${cp.sessionId}  ${cp.turnId ?? "(no turnId)"}`);
    }
  }

  return lines.join("\n");
}
