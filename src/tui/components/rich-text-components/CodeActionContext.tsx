// src/tui/components/CodeActionContext.tsx
// Context that wires CodeBlock action buttons to the application.

import { createContext, useContext } from "react";

export type CodeBlockAction =
  | { type: "copy"; code: string }
  | { type: "run"; language: string; code: string }
  | { type: "insert"; code: string };

interface CodeActionContextValue {
  onAction: (action: CodeBlockAction) => void;
}

export const CodeActionContext = createContext<CodeActionContextValue | undefined>(undefined);

export function useCodeAction() {
  return useContext(CodeActionContext);
}
