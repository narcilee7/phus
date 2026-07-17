// apps/gui/src/renderer/src/App.tsx
// Phase 1 — minimal chat loop.
//   - Subscribes to AgentEvent / PlanEvent / Outbound / PermissionRequest
//   - Pushes events through eventToAction / planEventToAction
//   - Renders ChatItem list with @tanstack/react-virtual
//   - Plain <input> + Enter to submit; slash commands route to runSlash
//   - Permission modal (very basic: Y / N / always)
//   - Bootstrap/Key wizard banners; full form lives in Phase 2

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { JSX } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  appReducer,
  initialState,
  type AppState,
  type ChatItem,
  type PermissionRequest,
} from "./state/reducer.js";
import { eventToAction, planEventToAction } from "./events/event-to-action.js";
import { phus } from "./ipc/types.js";
import {
  useAgentEvents,
  useMainError,
  useOutbound,
  usePermissionRequest,
  usePlanEvents,
  useWizardShow,
} from "./ipc/hooks.js";
import type {
  BootstrapStatusPayload,
  PermissionRequestPayload,
} from "../../shared/ipc-schema.js";

interface WizardState {
  kind: "bootstrap" | "key";
  status: BootstrapStatusPayload;
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // ─── Subscribe to all push channels (mount-once) ────────────────────
  useAgentEvents(
    useCallback((msg: { event: unknown }) => {
      const action = eventToAction(msg.event);
      if (action) dispatch(action);
    }, []),
  );
  usePlanEvents(
    useCallback((msg: { event: unknown }) => {
      const action = planEventToAction(msg.event);
      if (action) dispatch(action);
    }, []),
  );
  useOutbound(
    useCallback(
      ({ outbounds }) => {
        for (const o of outbounds) {
          if (o.type === "text" && o.content) {
            // Outbound from the Bub chain is the agent's final reply text;
            // render as a system info entry so it doesn't get confused with
            // the streamed assistant message. Streaming deltas already came
            // through AgentEvent text_delta.
            dispatch({ type: "add_system", text: o.content, level: "info" });
          }
        }
      },
      [],
    ),
  );
  usePermissionRequest(
    useCallback((req: PermissionRequestPayload) => {
      const local: PermissionRequest = {
        id: req.requestId,
        toolName: req.toolName,
        args: req.args,
        toolCallId: req.toolCallId,
      };
      dispatch({ type: "push_permission", request: local });
    }, []),
  );
  useWizardShow(
    useCallback((msg: { kind: "bootstrap" | "key"; status: BootstrapStatusPayload }) => {
      setWizard({ kind: msg.kind, status: msg.status });
    }, []),
  );
  useMainError(
    useCallback((msg: { message: string }) => {
      setBootError(msg.message);
    }, []),
  );

  // ─── Initial bootstrap fetch ────────────────────────────────────────
  useEffect(() => {
    void phus.getBootstrapStatus().then((status) => {
      if (status.needsBootstrap) {
        setWizard({ kind: "bootstrap", status });
      } else if (status.needsKey) {
        setWizard({ kind: "key", status });
      }
    });
  }, []);

  // ─── Input handlers ────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed.startsWith("/") || trimmed.startsWith(",")) {
        dispatch({ type: "add_user", text: trimmed });
        dispatch({ type: "set_busy", busy: true });
        void phus
          .runSlash(trimmed)
          .catch((err: unknown) =>
            dispatch({
              type: "add_system",
              text: `slash error: ${err instanceof Error ? err.message : String(err)}`,
              level: "error",
            }),
          )
          .finally(() => dispatch({ type: "set_busy", busy: false }));
        return;
      }
      dispatch({ type: "add_user", text: trimmed });
      dispatch({ type: "set_busy", busy: true });
      const envelope = {
        id: crypto.randomUUID(),
        from: "gui:user",
        content: trimmed,
        type: "text" as const,
        channel: "gui",
        metadata: { chatId: "gui" },
        ts: Date.now(),
      };
      void phus
        .turn(envelope)
        .catch((err: unknown) =>
          dispatch({
            type: "add_system",
            text: `turn error: ${err instanceof Error ? err.message : String(err)}`,
            level: "error",
          }),
        )
        .finally(() => {
          dispatch({ type: "set_busy", busy: false });
          dispatch({ type: "finalize_streaming" });
        });
    },
    [],
  );

  const handlePermissionResponse = useCallback(
    (id: string, allow: boolean, remember: "once" | "session" | "always" = "once") => {
      void phus.resolvePermission({ requestId: id, allow, scope: remember });
      dispatch({ type: "resolve_permission", id, allow, remember });
    },
    [],
  );

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <Header busy={state.busy} />
      <ChatList items={state.items} />

      <InputBar onSubmit={handleSubmit} disabled={state.busy} />
      <StatusBar state={state} />

      {state.permissionQueue.length > 0 && (
        <PermissionModal
          request={state.permissionQueue[0]!}
          onRespond={handlePermissionResponse}
        />
      )}

      {wizard && (
        <WizardBanner
          kind={wizard.kind}
          status={wizard.status}
          onDismiss={() => setWizard(null)}
        />
      )}

      {bootError && (
        <div className="border-t border-danger bg-bg-elevated p-3 text-sm text-danger">
          fatal: {bootError}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Header({ busy }: { busy: boolean }): JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-elevated px-4 py-2">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${busy ? "bg-pending animate-pulse" : "bg-success"}`} />
        <span className="font-semibold tracking-tight">Phus</span>
        <span className="text-fg-muted text-xs">Electron GUI · v0.1.0</span>
      </div>
    </header>
  );
}

function ChatList({ items }: { items: ChatItem[] }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-auto px-4 py-3">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ChatRow item={item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatRow({ item }: { item: ChatItem }): JSX.Element | null {
  switch (item.kind) {
    case "user":
      return (
        <div className="my-1 flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="my-2">
          {item.reasoning ? (
            <div className="text-fg-muted mb-1 text-xs italic">
              thinking: {item.reasoning}
              {item.isStreaming ? "…" : ""}
            </div>
          ) : null}
          {item.text ? (
            <div className="text-fg text-sm whitespace-pre-wrap">
              {item.text}
              {item.isStreaming ? "▍" : ""}
            </div>
          ) : null}
        </div>
      );
    case "system":
      return (
        <div
          className={`my-1 text-xs ${
            item.level === "error"
              ? "text-danger"
              : item.level === "warn"
                ? "text-warn"
                : "text-fg-muted"
          }`}
        >
          {item.text}
        </div>
      );
    case "tool_call":
      return (
        <div className="text-fg-muted my-1 font-mono text-xs">
          ⚙ {item.toolName}({JSON.stringify(item.args).slice(0, 60)})
          {item.result !== undefined
            ? ` → ${item.isError ? "✗" : "✓"} ${JSON.stringify(item.result).slice(0, 80)}`
            : " …"}
        </div>
      );
    case "tool_result":
      return null;
    default:
      return null;
  }
}

function InputBar({
  onSubmit,
  disabled,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
}): JSX.Element {
  const [text, setText] = useState("");
  const submit = useCallback(() => {
    if (!text.trim()) return;
    onSubmit(text);
    setText("");
  }, [onSubmit, text]);
  return (
    <div className="border-t border-border bg-bg-elevated p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? "agent is thinking…" : "type a message, / for commands"}
          className="bg-bg flex-1 rounded border border-border px-3 py-1.5 text-sm outline-none focus:border-accent"
          autoFocus
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="bg-accent text-accent-fg rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function StatusBar({ state }: { state: AppState }): JSX.Element {
  const [model, setModel] = useState<string>("…");
  useEffect(() => {
    void phus.getModelLabel().then(setModel);
  }, [state.busy, state.items.length]);
  return (
    <footer className="text-fg-muted flex items-center justify-between border-t border-border bg-bg-elevated px-3 py-1 font-mono text-xs">
      <span>{model}</span>
      <span>{state.busy ? "busy" : "idle"} · {state.items.length} items</span>
    </footer>
  );
}

function PermissionModal({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (id: string, allow: boolean, remember?: "once" | "session" | "always") => void;
}): JSX.Element {
  const [remember, setRemember] = useState<"once" | "session" | "always">("once");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-lg border border-warn bg-bg-elevated p-5 shadow-xl">
        <div className="text-warn text-xs font-semibold tracking-wider uppercase">
          Permission required
        </div>
        <div className="mt-2 font-mono text-sm">
          {request.toolName}
          {request.preview ? (
            <pre className="bg-bg mt-2 max-h-40 overflow-auto rounded border border-border p-2 text-xs">
              {request.preview}
            </pre>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="remember"
              checked={remember === "once"}
              onChange={() => setRemember("once")}
            />
            Once
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="remember"
              checked={remember === "session"}
              onChange={() => setRemember("session")}
            />
            This session
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="remember"
              checked={remember === "always"}
              onChange={() => setRemember("always")}
            />
            Always (this tool)
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => onRespond(request.id, false, "once")}
            className="border-border rounded border px-3 py-1 text-sm hover:bg-bg"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(request.id, true, remember)}
            className="bg-accent text-accent-fg rounded px-3 py-1 text-sm"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

function WizardBanner({
  kind,
  status,
  onDismiss,
}: {
  kind: "bootstrap" | "key";
  status: BootstrapStatusPayload;
  onDismiss: () => void;
}): JSX.Element {
  const title = kind === "bootstrap" ? "First-time setup" : "API key required";
  const body = useMemo(() => {
    if (kind === "bootstrap") {
      return "No phus.config.yaml found. Run `phus bootstrap` in a terminal, or fill in the wizard (Phase 2).";
    }
    return `No API key for profile "${status.profileName ?? "?"}" / provider "${status.provider ?? "?"}". Set ${
      status.suggestedEnvVar ?? "ANTHROPIC_API_KEY"
    } in your environment, or use the key wizard.`;
  }, [kind, status]);

  return (
    <div className="border-t border-warn bg-bg-elevated p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-warn font-semibold">{title}</div>
          <div className="text-fg-muted mt-1 text-xs">{body}</div>
        </div>
        <button
          onClick={onDismiss}
          className="border-border rounded border px-2 py-1 text-xs hover:bg-bg"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}