// src/core/internal-commands/builtins/schedule.ts
// ,schedule.* — inspect and edit cron-driven hook schedules.

import { asScheduleName } from "@/types/brand.js";
import type { InternalCommand, InternalCommandServices } from "../types.js";

async function getSchedulerOrMessage(): Promise<
  | { ok: true; sched: import("@/core/scheduler.js").Scheduler }
  | { ok: false; message: string }
> {
  const { getScheduler } = await import("@/core/scheduler-runtime.js");
  const sched = getScheduler();
  if (!sched) {
    return {
      ok: false,
      message: "(scheduler not initialized — only runs in gateway mode)",
    };
  }
  return { ok: true, sched };
}

export function defineScheduleCommands(
  _services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "schedule.list",
      description: "list all registered schedules",
      handler: async () => {
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        const list = r.sched.list();
        if (list.length === 0) return "(no schedules registered)";
        return list
          .map((s: any) =>
            `  ${s.enabled === false ? "○" : "●"} ${s.name.padEnd(24)} ${s.cron.padEnd(14)} → ${s.hookName}`,
          )
          .join("\n");
      },
    },
    {
      name: "schedule.add",
      description: "add a new schedule",
      usage: "name=<n> cron=\"<expr>\" hookName=<hook>",
      handler: async ({ args }) => {
        const name = args.name;
        const cron = args.cron;
        const hookName = args.hookName;
        if (!name || !cron || !hookName) {
          return "usage: ,schedule.add name=<n> cron=\"<expr>\" hookName=<hook>";
        }
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        try {
          r.sched.register({
            name: asScheduleName(name),
            cron,
            hookName: hookName as any,
            payload: args.payload ? JSON.parse(String(args.payload)) : undefined,
          });
          return `✓ schedule "${name}" added (${cron})`;
        } catch (err: any) {
          return `failed: ${err.message}`;
        }
      },
    },
    {
      name: "schedule.remove",
      description: "remove a schedule",
      usage: "name=<n>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,schedule.remove name=<n>";
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        const ok = r.sched.unregister(name as any);
        return ok ? `✓ schedule "${name}" removed` : `not found: ${name}`;
      },
    },
    {
      name: "schedule.enable",
      description: "enable a disabled schedule",
      usage: "name=<n>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,schedule.enable name=<n>";
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        return r.sched.setEnabled(name as any, true) ? `✓ enabled "${name}"` : `not found: ${name}`;
      },
    },
    {
      name: "schedule.disable",
      description: "disable a schedule (keeps registration, stops firing)",
      usage: "name=<n>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,schedule.disable name=<n>";
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        return r.sched.setEnabled(name as any, false) ? `○ disabled "${name}"` : `not found: ${name}`;
      },
    },
    {
      name: "schedule",
      description: "alias for ,schedule.list",
      handler: async ({ surface }) => {
        // Re-execute through the same registry the caller is using.
        // The builtin body uses getAgent()._internal directly today; we
        // delegate to ,schedule.list which already does the work.
        const r = await getSchedulerOrMessage();
        if (!r.ok) return r.message;
        const list = r.sched.list();
        if (list.length === 0) return "(no schedules registered)";
        return list
          .map((s: any) =>
            `  ${s.enabled === false ? "○" : "●"} ${s.name.padEnd(24)} ${s.cron.padEnd(14)} → ${s.hookName}`,
          )
          .join("\n");
      },
    },
  ];
}