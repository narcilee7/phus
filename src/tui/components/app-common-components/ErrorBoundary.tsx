// src/tui/components/ErrorBoundary.tsx
// React error boundary for the TUI. Catches render-time exceptions,
// surfaces a user-friendly panel with the error message + stack trace,
// and offers a /reload hint via the status bar.

import React from "react";
import { Box, Text, useInput } from "ink";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional callback invoked when the user wants to recover by
   *  remounting the wrapped subtree. */
  onRecover?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  stack: string | undefined;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, stack: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, stack: error.stack };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface the error to the structured log as well so it can be
    // diagnosed after the fact via `phus logs --level error`.
    try {
      // eslint-disable-next-line no-console
      console.error("tui.render_error", { message: error.message, stack: error.stack, info });
    } catch {
      /* logging is best-effort */
    }
  }

  render() {
    if (this.state.error) {
      return <ErrorPanel error={this.state.error} stack={this.state.stack} onRecover={this.props.onRecover} />;
    }
    return this.props.children;
  }
}

function ErrorPanel({
  error,
  stack,
  onRecover,
}: {
  error: Error;
  stack?: string;
  onRecover?: () => void;
}) {
  useInput((input, key) => {
    if (key.return && onRecover) onRecover();
  });
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="red">⚠ TUI crashed</Text>
      <Box marginTop={1}>
        <Text>{error.message || String(error)}</Text>
      </Box>
      {stack && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>stack trace:</Text>
          <Text dimColor wrap="wrap">{stack.split("\n").slice(0, 6).join("\n")}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to /reload (or Ctrl+C to quit)</Text>
      </Box>
    </Box>
  );
}
