// src/commands/tasks.ts
// `phus tasks` — show active/long-running/scheduled state.
// Reuses scheduler + tape data, no separate state to maintain.

import { PhusAgent } from "@/bridge/pi-agent.js";
import { getScheduler, nextFires } from "@/core/runtime/scheduler.js";
import { listCheckpoints, loadLatestCheckpoint } from "@/core/session/checkpoint.js";

export interface TasksOutput {
  agent: {
    model: string;
    thinking: string;
    messageCount: number;
    lastCheckpoint?: { ts: number; messages: number };
  };
  sessions: Array<{ id: string; entries: number }>;
  schedules: Array<{ name: string; cron: string; hookName: string; enabled: boolean; nextFire?: string }>;
  recentCheckpoints: Array<{ sessionId: string; ts: number; turnId?: string }>;
}

export async function collectTasks(): Promise<TasksOutput> {
  const handle = await PhusAgent.create();
  const { internals } = handle;
  const model = internals.getCurrentModel();
  const tape = internals.tape;

  const lastCp = loadLatestCheckpoint(
    tape,
    (internals as any)._currentSessionId ?? "default",
  );

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

  const sessions = Object.entries(tape.stats().sessions)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([id, entries]) => ({ id, entries: entries as number }));

  const recentCheckpoints = listCheckpoints(tape, (internals as any)._currentSessionId ?? "")
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
      lines.push(`  ${s.id.padEnd(40)}  ${s.entries} entries`);
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
