// src/tui/components/PlanPanel.tsx
// Compact plan progress indicator shown above the input box.

import React from "react";
import { Box, Text } from "ink";
import type { PlanState } from "@/tui/state.js";

interface PlanPanelProps {
  plan: PlanState;
}

const STATUS_ICON: Record<PlanState["status"], string> = {
  pending: "◌",
  running: "◐",
  paused: "◑",
  completed: "✓",
  failed: "✗",
};

const STATUS_COLOR: Record<PlanState["status"], string> = {
  pending: "gray",
  running: "cyan",
  paused: "yellow",
  completed: "green",
  failed: "red",
};

const STEP_ICON: Record<PlanState["steps"][number]["status"], string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
};

const STEP_COLOR: Record<PlanState["steps"][number]["status"], string> = {
  pending: "gray",
  running: "cyan",
  completed: "green",
  failed: "red",
  skipped: "gray",
};

export function PlanPanel({ plan }: PlanPanelProps) {
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  const total = plan.steps.length || 1;
  const currentStep = plan.steps.find((s) => s.id === plan.currentStepId);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={STATUS_COLOR[plan.status]} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={STATUS_COLOR[plan.status]}>
          {STATUS_ICON[plan.status]} Plan: {plan.goal}
        </Text>
        <Text dimColor>
          {completed}/{total}
        </Text>
      </Box>
      {currentStep && plan.status === "running" && (
        <Box flexDirection="row" marginTop={1}>
          <Text color="cyan">● {currentStep.description}</Text>
        </Box>
      )}
      {plan.steps.length > 0 && (
        <Box flexDirection="row" marginTop={1} flexWrap="wrap">
          {plan.steps.map((step) => (
            <Box key={step.id} marginRight={2}>
              <Text color={STEP_COLOR[step.status]}>
                {STEP_ICON[step.status]} {step.description}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
