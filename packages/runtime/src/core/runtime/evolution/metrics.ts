// src/core/runtime/evolution/metrics.ts
// Aggregated intelligence-loop metrics.
//
// Pulls from:
//  - PlanStore.validation_attempts (per-draft history + outcomes)
//  - PlanStore.loadBySession / load (plan statuses)
//  - Tape memory_write + plan_step_* events (optional, when a Tape is given)
//
// The point isn't a perfect KPI dashboard — it's a single object that
// gives an operator (or a test) a quick "is the loop learning?" signal.

import type { PlanStore } from "@phus/core/session/plan-store.js";
import type { Plan } from "../plan/types.js";
import type { TapeLike } from "@phus/core/types/hooks/index.js";
import type { TapeEntry } from "@phus/core/types/tape/index.js";

export interface DraftMetrics {
    name: string;
    attempts: number;
    improved: number;
    failed: number;
    pending: number;
    baseline: number;
    /** True when at least one "improved" attempt is recorded. */
    promoted: boolean;
    lastImprovedAt?: number;
}

export interface IntelligenceMetrics {
    plansRun: number;
    plansCompleted: number;
    plansFailed: number;
    plansPaused: number;
    /** Plans that needed at least one retry on any step. */
    plansWithRetries: number;
    /** Sum of step.retryCount across all plans. */
    totalStepRetries: number;
    drafts: DraftMetrics[];
    memoryWrites: number;
    /** Failure modes observed across reflection.whatFailed. */
    topFailureModes: string[];
    /** Average procedure confidence across reflection runs (0..1). */
    averageProcedureConfidence: number;
    /** Reflection sample count used to compute the average. */
    reflectionSamples: number;
}

export interface AggregateOptions {
    /** Optional session filter — when set, only plans/tape entries for
     *  this session contribute. */
    sessionId?: string;
}

const TOP_FAILURE_MODES = 5;

export class IntelligenceMetricsAggregator {
    constructor(
        private deps: {
            planStore: PlanStore;
            tape?: TapeLike;
        },
    ) {}

    aggregate(opts: AggregateOptions = {}): IntelligenceMetrics {
        const plans = this.collectPlans(opts.sessionId);
        const draftNames = this.collectDraftNames();

        const drafts: DraftMetrics[] = draftNames.map((name) => {
            const stats = this.deps.planStore.getValidationStats(name);
            return {
                name,
                attempts: stats.total,
                improved: stats.improved,
                failed: stats.failed,
                pending: stats.pending,
                baseline: stats.baseline,
                promoted: stats.improved > 0,
                lastImprovedAt: stats.lastImprovedAt,
            };
        });

        const planAgg = this.aggregatePlans(plans);
        const memoryAgg = this.aggregateTape(opts.sessionId);

        return {
            ...planAgg,
            drafts,
            ...memoryAgg,
        };
    }

    /** Serialize the metrics object to a human-friendly one-line-per-field
     *  text block. Useful for `phus metrics` console output. */
    format(metrics: IntelligenceMetrics): string {
        const lines: string[] = [];
        lines.push(`Plans:       ${metrics.plansRun} run (${metrics.plansCompleted} completed, ${metrics.plansFailed} failed, ${metrics.plansPaused} paused)`);
        lines.push(`Retries:     ${metrics.totalStepRetries} step retries across ${metrics.plansWithRetries} plan(s)`);
        lines.push(`Drafts:      ${metrics.drafts.length} (${metrics.drafts.filter((d) => d.promoted).length} promoted)`);
        for (const d of metrics.drafts) {
            const tag = d.promoted ? "✓" : "·";
            lines.push(`  ${tag} ${d.name} — ${d.improved} improved / ${d.failed} failed / ${d.pending} pending / ${d.attempts} attempts`);
        }
        lines.push(`Memory:      ${metrics.memoryWrites} writes`);
        if (metrics.reflectionSamples > 0) {
            lines.push(`Reflection:  avg procedure confidence ${(metrics.averageProcedureConfidence * 100).toFixed(0)}% over ${metrics.reflectionSamples} samples`);
        } else {
            lines.push(`Reflection:  no samples yet`);
        }
        if (metrics.topFailureModes.length > 0) {
            lines.push(`Top failure modes:`);
            for (const fm of metrics.topFailureModes) {
                lines.push(`  - ${fm}`);
            }
        }
        return lines.join("\n");
    }

    private collectPlans(sessionId?: string): Plan[] {
        if (sessionId) return this.deps.planStore.loadBySession(sessionId);
        // No session filter: read every saved plan via a synthetic query.
        // PlanStore doesn't expose "list all", so we approximate by reading
        // each session we've seen. Cheaper alternative: scan the
        // validation_attempts table for known session_ids — but plans and
        // validation_attempts have different lifecycles. Keep it scoped.
        return [];
    }

    private collectDraftNames(): string[] {
        // Walk the plans table directly — there's no public listDrafts()
        // but validation_attempts has a row per draft.
        // Use the underlying better-sqlite3 handle.
        const db = (this.deps.planStore as unknown as { db: { prepare: (s: string) => { all: () => unknown[] } } }).db;
        if (!db?.prepare) return [];
        const rows = db
            .prepare("SELECT DISTINCT draft_name FROM validation_attempts ORDER BY draft_name")
            .all() as Array<{ draft_name: string }>;
        return rows.map((r) => r.draft_name).filter((n) => n.length > 0);
    }

    private aggregatePlans(plans: Plan[]): Pick<
        IntelligenceMetrics,
        "plansRun" | "plansCompleted" | "plansFailed" | "plansPaused" | "plansWithRetries" | "totalStepRetries"
    > {
        const plansRun = plans.length;
        let plansCompleted = 0;
        let plansFailed = 0;
        let plansPaused = 0;
        let plansWithRetries = 0;
        let totalStepRetries = 0;

        for (const plan of plans) {
            if (plan.status === "completed") plansCompleted++;
            else if (plan.status === "failed") plansFailed++;
            else if (plan.status === "paused") plansPaused++;

            let planHadRetry = false;
            for (const step of plan.steps) {
                if (step.retryCount > 0) {
                    totalStepRetries += step.retryCount;
                    planHadRetry = true;
                }
            }
            if (planHadRetry) plansWithRetries++;
        }

        return { plansRun, plansCompleted, plansFailed, plansPaused, plansWithRetries, totalStepRetries };
    }

    private aggregateTape(sessionId?: string): Pick<
        IntelligenceMetrics,
        "memoryWrites" | "topFailureModes" | "averageProcedureConfidence" | "reflectionSamples"
    > {
        if (!this.deps.tape) {
            return { memoryWrites: 0, topFailureModes: [], averageProcedureConfidence: 0, reflectionSamples: 0 };
        }

        let memoryWrites = 0;
        for (const session of this.sessionsToScan(sessionId)) {
            for (const entry of this.deps.tape.replay(session)) {
                if (entry.kind === "memory_write") memoryWrites++;
            }
        }

        // Reflection aggregation lives behind a future reflection_history
        // table — until then, surface zeros so the schema is stable.
        return {
            memoryWrites,
            topFailureModes: [],
            averageProcedureConfidence: 0,
            reflectionSamples: 0,
        };
    }

    private sessionsToScan(sessionId?: string): string[] {
        if (sessionId) return [sessionId];
        // Without a session filter we don't have an index of sessions from
        // the tape interface alone; return [] so callers see "no data yet"
        // instead of a misleading zero.
        return [];
    }
}
