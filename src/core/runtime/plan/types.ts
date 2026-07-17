import type { SessionId } from "@/types/brand.js";

export type PlanStatus = "pending" | "running" | "paused" | "completed" | "failed";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface Step {
  id: string;
  index: number;
  description: string;
  tool?: string;
  expectedOutput?: string;
  status: StepStatus;
  result?: unknown;
  retryCount: number;
  dependsOn?: string[];
}

export interface Plan {
  id: string;
  sessionId: SessionId;
  goal: string;
  status: PlanStatus;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export interface VerificationResult {
  ok: boolean;
  confidence: number;
  reason: string;
  action: "proceed" | "retry" | "replan" | "escalate" | "abort";
}

export interface SubAgentOptions {
  task: string;
  parentSessionId: string;
  context?: string;
  maxSteps?: number;
}
