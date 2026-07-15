// src/commands/tasks.ts
// `phus tasks` — show active/long-running/scheduled state.
// Reuses scheduler + tape data, no separate state to maintain.

import { PhusAgent } from "../bridge/pi-agent.js";
import { getScheduler } from "../core/scheduler-runtime.js";
import { listCheckpoints, loadLatestCheckpoint } from "../core/checkpoint.js";
import { nextFires } from "../core/scheduler.js";

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

export function collectTasks(): TasksOutput {
  const agent = new PhusAgent();
  const model = agent._internal.piAgent.state.model;
  const tape = agent._internal.tape;

  const lastCp = loadLatestCheckpoint(tape, (agent as any)._currentSessionId ?? "default");

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
    .sort((a, b) => b[1] - a[1])
    .map(([id, entries]) => ({ id, entries }));

  const recentCheckpoints = listCheckpoints(tape, (agent as any)._currentSessionId ?? "")
    .slice(0, 5)
    .map((cp) => ({ sessionId: cp.sessionId, ts: cp.ts, turnId: cp.turnId }));

  return {
    agent: {
      model: `${model.provider}/${model.id}`,
      thinking: agent._internal.piAgent.state.thinkingLevel,
      messageCount: agent._internal.piAgent.state.messages.length,
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
