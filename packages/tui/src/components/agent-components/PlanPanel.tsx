// src/tui/components/PlanPanel.tsx
// Compact plan progress indicator + expandable timeline view with
// keyboard shortcuts for pause/resume/cancel/retry.

import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PlanState, PlanStepState, PlanSubagentState } from "@/state/state.js";
import { getTheme } from "@/theme/theme.js";

interface PlanPanelProps {
  plan: PlanState;
  /** When true, render the full step timeline instead of the compact summary. */
  expanded?: boolean;
  /** Called when the user toggles expand/collapse. */
  onToggleExpand?: () => void;
  /** Called when the user presses "p" to pause. */
  onPause?: () => void;
  /** Called when the user presses "r" to resume. */
  onResume?: () => void;
  /** Called when the user presses "c" to cancel. */
  onCancel?: () => void;
  /** Called when the user presses "y" to retry the selected failed step. */
  onRetryStep?: (stepId: string) => void;
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

const STEP_ICON: Record<PlanStepState["status"], string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
};

const STEP_COLOR: Record<PlanStepState["status"], string> = {
  pending: "gray",
  running: "cyan",
  completed: "green",
  failed: "red",
  skipped: "gray",
};

const SUBAGENT_COLOR: Record<PlanSubagentState["status"], string> = {
  running: "cyan",
  completed: "green",
  failed: "red",
};

function formatDuration(ms?: number): string {
  if (ms === undefined || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function stepSummary(step: PlanStepState): string {
  const parts: string[] = [];
  if (step.durationMs) parts.push(formatDuration(step.durationMs));
  if (step.retryCount) parts.push(`retry ${step.retryCount}`);
  if (step.subagentSessionId) parts.push(`sub ${step.subagentSessionId.slice(0, 8)}`);
  return parts.join(" · ");
}

export function PlanPanel({
  plan,
  expanded = false,
  onToggleExpand,
  onPause,
  onResume,
  onCancel,
  onRetryStep,
}: PlanPanelProps) {
  const theme = getTheme();
  const statusColor = (status: PlanState["status"]): string => {
    switch (status) {
      case "completed": return theme.success;
      case "failed": return theme.danger;
      case "paused": return theme.warning;
      case "running": return theme.accent;
      default: return theme.muted;
    }
  };
  const stepColor = (status: PlanStepState["status"]): string => {
    switch (status) {
      case "completed": return theme.success;
      case "failed": return theme.danger;
      case "running": return theme.accent;
      default: return theme.muted;
    }
  };
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  const total = plan.steps.length || 1;
  const currentStep = plan.steps.find((s) => s.id === plan.currentStepId);
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.max(0, plan.steps.findIndex((s) => s.id === plan.currentStepId)),
  );

  const visibleSteps = useMemo(() => {
    if (!expanded) return [];
    const maxRows = 9;
    const start = Math.max(0, selectedIndex - maxRows + 1);
    return plan.steps.slice(start, start + maxRows);
  }, [expanded, plan.steps, selectedIndex]);

  // Keep the selected index valid when the plan changes.
  React.useEffect(() => {
    const idx = plan.steps.findIndex((s) => s.id === plan.currentStepId);
    setSelectedIndex(idx >= 0 ? idx : 0);
  }, [plan.currentStepId, plan.steps.length]);

  useInput((input, key) => {
    if (!expanded) return;
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex((i) => Math.min(plan.steps.length - 1, i + 1));
    if (key.return && onToggleExpand) {
      // Enter on a failed step triggers retry; on others, just collapses.
      const sel = plan.steps[selectedIndex];
      if (sel?.status === "failed" && onRetryStep) {
        onRetryStep(sel.id);
      }
    }
    if (input === "p" && plan.status === "running" && onPause) onPause();
    if (input === "r" && plan.status === "paused" && onResume) onResume();
    if (input === "c" && (plan.status === "running" || plan.status === "paused") && onCancel) {
      onCancel();
    }
  });

  const selectedStep = plan.steps[selectedIndex];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={statusColor(plan.status)}
      paddingX={1}
      height={expanded ? 16 : 6}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={statusColor(plan.status)}>
          {STATUS_ICON[plan.status]} Plan: {plan.goal}
        </Text>
        <Text dimColor>
          {completed}/{total}
          {expanded ? "" : " · Ctrl+T expand"}
        </Text>
      </Box>

      {!expanded && currentStep && plan.status === "running" && (
        <Box flexDirection="row" marginTop={1}>
          <Text color="cyan">● {currentStep.description}</Text>
        </Box>
      )}

      {!expanded && plan.steps.length > 0 && (
        <Box flexDirection="row" marginTop={1} flexWrap="wrap">
          {plan.steps.map((step) => (
            <Box key={step.id} marginRight={2}>
              <Text color={stepColor(step.status)}>
                {STEP_ICON[step.status]} {step.description}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {expanded && (
        <Box flexDirection="column" marginTop={1} flexGrow={1}>
          {visibleSteps.map((step, idx) => {
            const actualIdx = Math.max(0, selectedIndex - 8) + idx;
            const isSelected = actualIdx === selectedIndex;
            const summary = stepSummary(step);
            return (
              <Box key={step.id} flexDirection="column">
                <Box flexDirection="row">
                  {isSelected ? (
                    <Text backgroundColor="cyan" color="black">
                      {STEP_ICON[step.status]} {step.description}
                    </Text>
                  ) : (
                    <Text color={stepColor(step.status)}>
                      {STEP_ICON[step.status]} {step.description}
                    </Text>
                  )}
                  {summary && (
                    <Text dimColor>
                      {" "}— {summary}
                    </Text>
                  )}
                </Box>
                {step.output && (
                  <Text color="gray" wrap="truncate-end">
                    {"  "}↳ {step.output}
                  </Text>
                )}
                {step.error && (
                  <Text color="red" wrap="truncate-end">
                    {"  "}↳ {step.error}
                  </Text>
                )}
                {step.subagentSessionId && (
                  <Box marginLeft={2}>
                    <Text color={SUBAGENT_COLOR[plan.subagents.find((a) => a.sessionId === step.subagentSessionId)?.status ?? "running"]}>
                      ↳ subagent @{step.subagentSessionId.slice(0, 8)}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {expanded && (
        <Box>
          <Text dimColor>
            ↑↓ navigate · p pause · r resume · c cancel ·{" "}
            {selectedStep?.status === "failed" ? "Enter retry" : "T collapse"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
