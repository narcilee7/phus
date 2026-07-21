// src/commands/metrics.ts
// `phus metrics [--session <id>] [--json]` — print aggregated intelligence-loop stats.

import { PlanStore } from "@phus/core/session/plan-store.js";
import { IntelligenceMetricsAggregator } from "../core/runtime/evolution/metrics.js";

export interface MetricsOptions {
    /** Optional session filter. */
    sessionId?: string;
    /** When true, output JSON instead of the human-readable format. */
    json?: boolean;
}

/**
 * Print metrics for the agent's tape DB. Caller passes the resolved
 * DB path so the command stays decoupled from config loading.
 */
export function printMetrics(dbPath: string, opts: MetricsOptions = {}): void {
    const store = new PlanStore(dbPath);
    try {
        const agg = new IntelligenceMetricsAggregator({ planStore: store });
        const metrics = agg.aggregate({ sessionId: opts.sessionId });
        if (opts.json) {
            console.log(JSON.stringify(metrics, null, 2));
            return;
        }
        console.log(agg.format(metrics));
    } finally {
        store.close();
    }
}
