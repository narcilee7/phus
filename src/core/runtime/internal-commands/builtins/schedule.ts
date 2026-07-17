// ,schedule.* — inspect and edit cron-driven hook schedules.

import { asScheduleName } from "@/types/brand";
import type { InternalCommand, InternalCommandServices } from "../types";

function notInitializedMessage(): string {
  return "(scheduler not initialized — only runs in gateway mode)";
}

function sched(services: InternalCommandServices) {
  return services.scheduler ?? null;
}

export function defineScheduleCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "schedule.list",
      description: "list all registered schedules",
      handler: async () => {
        const s = sched(services);
        if (!s) return notInitializedMessage();
        const list = s.list();
        if (list.length === 0) return "(no schedules registered)";
        return list
          .map((sch: any) =>
            `  ${sch.enabled === false ? "○" : "●"} ${sch.name.padEnd(24)} ${sch.cron.padEnd(14)} → ${sch.hookName}`,
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
        const s = sched(services);
        if (!s) return notInitializedMessage();
        try {
          s.register({
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
        const s = sched(services);
        if (!s) return notInitializedMessage();
        const ok = s.unregister(name as any);
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
        const s = sched(services);
        if (!s) return notInitializedMessage();
        return s.setEnabled(name as any, true) ? `✓ enabled "${name}"` : `not found: ${name}`;
      },
    },
    {
      name: "schedule.disable",
      description: "disable a schedule (keeps registration, stops firing)",
      usage: "name=<n>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,schedule.disable name=<n>";
        const s = sched(services);
        if (!s) return notInitializedMessage();
        return s.setEnabled(name as any, false) ? `○ disabled "${name}"` : `not found: ${name}`;
      },
    },
    {
      name: "schedule",
      description: "alias for ,schedule.list",
      handler: async () => {
        const s = sched(services);
        if (!s) return notInitializedMessage();
        const list = s.list();
        if (list.length === 0) return "(no schedules registered)";
        return list
          .map((sch: any) =>
            `  ${sch.enabled === false ? "○" : "●"} ${sch.name.padEnd(24)} ${sch.cron.padEnd(14)} → ${sch.hookName}`,
          )
          .join("\n");
      },
    },
  ];
}
