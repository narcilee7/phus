// src/tui/App.tsx
// TUI root. Composes the layout, wires event subscriptions through
// dedicated hooks (see ./hooks/), and renders the providers + panels.
// All command dispatch lives in ./handler/commands/; all event →
// action mapping in ./transform/events.ts.

import React, { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { Box, useApp } from "ink";
import type { PhusAgent } from "@/bridge/pi-agent.js";

import { appReducer, initialState, type RememberChoice } from "@/tui/state/state.js";
import { Header } from "@/tui/components/app-common-components/Header.js";
import { ChatViewport } from "@/tui/components/chat-components/ChatViewport.js";
import { TodoPill } from "@/tui/components/todo-components/TodoPill.js";
import { PlanPanel } from "@/tui/components/agent-components/PlanPanel.js";
import { InputBox } from "@/tui/components/input-components/InputBox.js";
import { TuiLayoutProvider, useTuiLayout } from "@/tui/context/tui-layout-context";
import { PermissionPanel } from "@/tui/components/permission-components/PermissionPanel.js";
import { CommandPalette, type PaletteAction } from "@/tui/components/command-components/CommandPalette.js";
import { StatusBar } from "@/tui/components/app-common-components/StatusBar.js";
import { FileTree } from "@/tui/components/file-components/FileTree.js";
import { SessionTree } from "@/tui/components/session-components/SessionTree.js";
import { tuiChannel } from "@/tui/channel.js";
import { extractMentions } from "@/tui/handler/mentions/mentions.js";
import { CodeActionContext } from "@/tui/components/rich-text-components/CodeActionContext.js";
import { DiffReviewContext } from "@/tui/components/diff-components/DiffReviewContext.js";
import { TuiFocusContext, type FocusKind } from "@/tui/context/tui-focus-context.js";
import { ErrorBoundary } from "@/tui/components/app-common-components/ErrorBoundary.js";

import {
  HEADER_ROWS,
  INPUT_ROWS,
  STATUS_ROWS,
  PLAN_ROWS_COLLAPSED,
  PLAN_ROWS_EXPANDED,
  TODO_ROWS,
  PERMISSION_ROWS,
  PALETTE_ROWS,
  MIN_CHAT_HEIGHT,
  MIN_SIDEBAR_HEIGHT,
} from "@/tui/constants.js";
import { useAgentEvents, type FileSnapshot } from "@/tui/hooks/useAgentEvents.js";
import { usePlanEvents } from "@/tui/hooks/usePlanEvents.js";
import { useStatusStats } from "@/tui/hooks/useStatusStats.js";
import { useTerminalSize } from "@/tui/hooks/useTerminalSize.js";
import { useUndoHint } from "@/tui/hooks/useUndoHint.js";
import { useSidebarRequest } from "@/tui/hooks/useSidebarRequest.js";
import { useToolPermissionGate } from "@/tui/hooks/useToolPermissionGate.js";
import { useAppShortcuts } from "@/tui/hooks/useAppShortcuts.js";
import { useQuitOnRequest } from "@/tui/hooks/useQuitOnRequest.js";
import { computeStatusHint } from "@/tui/handler/status-hint.js";
import { planActions } from "@/tui/handler/plan-actions.js";
import { useCodeActionHandler } from "@/tui/handler/code-actions-runtime.js";
import { useDiffReviewHandler } from "@/tui/handler/diff-review-actions.js";
import { submitMessage } from "@/tui/handler/submit-message.js";

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
  modelLabel: string;
}

export function App({ agent, sessionId, modelLabel }: AppProps) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <ErrorBoundary onRecover={() => setReloadKey((k) => k + 1)}>
      <TuiLayoutProvider>
        <AppInner key={reloadKey} agent={agent} sessionId={sessionId} modelLabel={modelLabel} />
      </TuiLayoutProvider>
    </ErrorBoundary>
  );
}

type SidebarView = "files" | "sessions";

interface FocusState {
  id: string | null;
  kind: FocusKind | null;
}

function AppInner({ agent, sessionId, modelLabel }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { bottomOverlayRows } = useTuiLayout();
  const [input, setInput] = useState("");
  const setInputRef = useRef(setInput);
  setInputRef.current = setInput;
  const setInputUpdater = useCallback(
    (updater: (prev: string) => string) => setInput((prev) => updater(prev)),
    [],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [planExpanded, setPlanExpanded] = useState(false);
  const [focus, setFocus] = useState<FocusState>({ id: null, kind: null });
  const lastWriteTs = useUndoHint(state.items);
  const stats = useStatusStats(agent);
  const { rows: terminalRows } = useTerminalSize();

  // Refs let event handlers read the latest items / plan without forcing
  // the subscription to re-bind on every change.
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
  const planRef = useRef(state.plan);
  planRef.current = state.plan;
  const fileSnapshots = useRef(new Map<string, FileSnapshot>());

  // ─── Event subscriptions ────────────────────────────────────────
  useAgentEvents(agent, dispatch, fileSnapshots);
  usePlanEvents(agent, dispatch, planRef);
  useSidebarRequest(state.sidebarRequest, dispatch, setSidebarView, setSidebarOpen);
  useToolPermissionGate(agent, state, dispatch);
  useQuitOnRequest(state.quitRequested, dispatch, exit);

  // ─── Bound handlers ──────────────────────────────────────────────
  const planHandlers = useMemo(
    () => planActions(agent, dispatch, state.plan),
    [agent, dispatch, state.plan],
  );
  const handleCodeAction = useCodeActionHandler(dispatch, setInputUpdater);
  const handleDiffReviewAction = useDiffReviewHandler(dispatch, setInputUpdater);

  // ─── Submit ──────────────────────────────────────────────────────
  const submit = useCallback(
    async (text: string) => {
      const result = await submitMessage(text, {
        agent,
        state,
        dispatch,
        setInput: setInputUpdater,
        channel: (d, getItems) =>
          tuiChannel(d, () => ({ items: getItems() })),
        getItems: () => itemsRef.current,
        clearChat: () => dispatch({ type: "clear_items" }),
      });
      if (result === "quit") {
        // Don't call exit() from inside an async chain — ink's cleanup
        // may not flush. Instead dispatch a state flag and let
        // useQuitOnRequest invoke exit() during the next commit.
        dispatch({ type: "request_quit" });
      }
    },
    [agent, state, dispatch, setInputUpdater, exit],
  );

  // ─── Layout heights ─────────────────────────────────────────────
  // Reserve rows for every bottom UI element so dynamic overlays don't
  // cover the chat viewport. Computed each render from current state.
  const PLAN_ROWS = state.plan ? (planExpanded ? PLAN_ROWS_EXPANDED : PLAN_ROWS_COLLAPSED) : 0;
  const TODO_ROWS_ACTIVE =
    state.busy || state.items.some((it) => it.kind === "tool_call" && it.isError === undefined)
      ? TODO_ROWS
      : 0;
  const PERMISSION_ROWS_ACTIVE = state.permissionQueue[0] ? PERMISSION_ROWS : 0;
  const PALETTE_ROWS_ACTIVE = paletteOpen ? PALETTE_ROWS : 0;
  const bottomRows =
    INPUT_ROWS +
    STATUS_ROWS +
    PLAN_ROWS +
    TODO_ROWS_ACTIVE +
    PERMISSION_ROWS_ACTIVE +
    PALETTE_ROWS_ACTIVE +
    bottomOverlayRows;
  const chatHeight = Math.max(MIN_CHAT_HEIGHT, terminalRows - HEADER_ROWS - bottomRows);
  const sidebarHeight = Math.max(MIN_SIDEBAR_HEIGHT, terminalRows - HEADER_ROWS);
  const chatHeightRef = useRef(chatHeight);
  chatHeightRef.current = chatHeight;

  // ─── Keyboard shortcuts ──────────────────────────────────────────
  useAppShortcuts({
    agent,
    state,
    dispatch,
    exit,
    paletteOpen,
    setPaletteOpen,
    sidebarOpen,
    setSidebarOpen,
    interactiveFocused: focus.id !== null,
    clearInteractiveFocus: () => setFocus({ id: null, kind: null }),
    chatHeightRef,
    togglePlanExpanded: () => setPlanExpanded((e) => !e),
  });

  const statusHint = computeStatusHint({
    paletteOpen,
    focusedKind: focus.kind,
    permissionQueue: state.permissionQueue,
    sidebarView,
    lastWriteTs,
  });

  // ─── Render ──────────────────────────────────────────────────────
  const tuiFocusValue = useMemo(
    () => ({
      focusedId: focus.id,
      focusedKind: focus.kind,
      setFocused: (id: string | null, kind?: FocusKind) => {
        setFocus(id === null ? { id: null, kind: null } : { id, kind: kind ?? null });
      },
    }),
    [focus.id, focus.kind],
  );

  return (
    <TuiFocusContext.Provider value={tuiFocusValue}>
      <CodeActionContext.Provider value={{ onAction: handleCodeAction }}>
        <DiffReviewContext.Provider value={{ onAction: handleDiffReviewAction }}>
          <Box flexDirection="column" height={terminalRows} overflow="hidden">
            <Header
              model={modelLabel}
              session={sessionId}
              stats={stats}
              lastOp={state.lastOp}
            />
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
              {sidebarOpen && sidebarView === "files" && (
                <Box width={34}>
                  <FileTree
                    height={sidebarHeight}
                    onInsert={(value: string) => {
                      setInput((prev) => prev + value);
                      setSidebarOpen(false);
                    }}
                    onPreview={(text: string) =>
                      dispatch({ type: "add_system", text, level: "info" })
                    }
                    onClose={() => setSidebarOpen(false)}
                  />
                </Box>
              )}
              {sidebarOpen && sidebarView === "sessions" && (
                <Box width={42}>
                  <SessionTree
                    currentSessionId={sessionId}
                    subagents={state.plan?.subagents}
                    plan={state.plan}
                    height={sidebarHeight}
                    onFocusSubagent={(sid) => {
                      dispatch({
                        type: "add_system",
                        text: `↳ subagent session ${sid.slice(0, 8)} (read-only)`,
                        level: "info",
                      });
                    }}
                    onClose={() => setSidebarOpen(false)}
                  />
                </Box>
              )}
              <Box flexDirection="column" flexGrow={1} overflow="hidden">
                <Box flexGrow={1} overflow="hidden">
                  <ChatViewport
                    items={state.items}
                    busy={state.busy}
                    scrollOffset={state.scroll.offset}
                    hasNew={state.scroll.hasNew}
                    lastOp={state.lastOp}
                    fileSnapshots={fileSnapshots.current}
                    height={chatHeight}
                  />
                </Box>
                {state.plan && (
                  <PlanPanel
                    plan={state.plan}
                    expanded={planExpanded}
                    onToggleExpand={() => setPlanExpanded((e) => !e)}
                    onPause={planHandlers.pause}
                    onResume={planHandlers.resume}
                    onCancel={planHandlers.cancel}
                    onRetryStep={planHandlers.retryStep}
                  />
                )}
                <TodoPill items={state.items} busy={state.busy} lastOp={state.lastOp} />
                {state.permissionQueue[0] && !paletteOpen && !sidebarOpen && (
                  <PermissionPanel
                    request={state.permissionQueue[0]}
                    onResolve={(allow: boolean, remember: RememberChoice) =>
                      dispatch({ type: "resolve_permission", allow, remember })
                    }
                  />
                )}
                {paletteOpen && (
                  <CommandPalette
                    agent={agent}
                    onSelect={(value: string, action: PaletteAction) => {
                      setPaletteOpen(false);
                      if (action === "insert") {
                        setInput((prev) => prev + value);
                      } else {
                        void submit(value);
                      }
                    }}
                    onClose={() => setPaletteOpen(false)}
                  />
                )}
                <StatusBar modelLabel={modelLabel} skills={stats.skills} entries={stats.entries} hint={statusHint} />
                <InputBox
                  value={input}
                  busy={state.busy}
                  showHint={state.showHint}
                  onChange={setInput}
                  onSubmit={submit}
                  isActive={
                    state.permissionQueue.length === 0 &&
                    !paletteOpen &&
                    !sidebarOpen &&
                    focus.id === null
                  }
                  agent={agent}
                  mentions={extractMentions(input)
                    .filter((m) => m.type === "file")
                    .map((m) => ({ path: m.target, size: 0 }))}
                />
              </Box>
            </Box>
          </Box>
        </DiffReviewContext.Provider>
      </CodeActionContext.Provider>
    </TuiFocusContext.Provider>
  );
}
