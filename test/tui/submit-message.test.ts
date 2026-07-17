// test/tui/submit-message.test.ts
// Regression for the duplicated-text bug introduced when `submit-message`
// was extracted out of App.tsx: the channel factory must receive a live
// `getItems` reader so `tuiChannel.send()` can short-circuit when the
// streaming events already produced an assistant message.

import { describe, expect, it, vi } from "vitest";
import { submitMessage } from "../../src/tui/handler/submit-message.js";
import { initialState, type AppAction, type AppState, type ChatItem } from "../../src/tui/state/state.js";
import type { ChannelAdapter } from "../../src/channels/base.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

// ─── Mock agent ─────────────────────────────────────────────────

function makeAgent(turnImpl?: (channel: ChannelAdapter) => Promise<void>): PhusAgent {
  return {
    turn: vi.fn(async (_envelope, channel) => {
      if (turnImpl) await turnImpl(channel);
    }),
  } as unknown as PhusAgent;
}

// ─── Helpers ───────────────────────────────────────────────────

function captureDispatch() {
  const dispatched: AppAction[] = [];
  const dispatch = (a: AppAction) => dispatched.push(a);
  return { dispatch, dispatched };
}

// ─── Tests ─────────────────────────────────────────────────────

describe("submitMessage — channel wiring", () => {
  it("passes both dispatch and getItems into the channel factory", async () => {
    const agent = makeAgent();
    const { dispatch } = captureDispatch();
    const setInput = vi.fn();

    /** Captures how the channel factory was invoked. */
    const factory = vi.fn(
      (_d: unknown, _g: unknown): ChannelAdapter => ({
        name: "spy",
        listen: () => {},
        send: async () => {},
      }),
    );

    await submitMessage("hello", {
      agent,
      state: initialState,
      dispatch,
      setInput,
      channel: factory,
      getItems: () => [],
      clearChat: vi.fn(),
    });

    expect(factory).toHaveBeenCalledTimes(1);
    const [_dispatchArg, getItemsArg] = factory.mock.calls[0] as [
      unknown,
      () => ChatItem[],
    ];
    expect(typeof getItemsArg).toBe("function");
  });

  it("forwards live items through getItems so channel.send can reconcile", async () => {
    const items: { live: ChatItem[] } = {
      live: [
        // Pretend the streaming events already wrote an assistant
        // message — this is the case that triggered the bug.
        { id: "a1", kind: "assistant", ts: 1, text: "streamed", isStreaming: true },
      ],
    };
    const sent: Array<{ items: ChatItem[] }> = [];

    const factory: (d: (a: AppAction) => void, g: () => ChatItem[]) => ChannelAdapter = (
      _d,
      getItems,
    ) => ({
      name: "spy",
      listen: () => {},
      async send(_outbounds) {
        sent.push({ items: getItems() });
      },
    });

    // The mock agent must actually invoke the channel — the whole point
    // of this test is that the items reach send via getItems.
    const agent = makeAgent(async (channel) => {
      await channel.send([
        { type: "text", content: "x", to: "u", channel: "tui" } as never,
      ]);
    });
    const { dispatch } = captureDispatch();

    await submitMessage("ping", {
      agent,
      state: initialState,
      dispatch,
      setInput: vi.fn(),
      channel: factory,
      getItems: () => items.live,
      clearChat: vi.fn(),
    });

    // The key invariant: when `agent.turn` calls `channel.send`, the
    // channel must see the assistant message that streaming events
    // produced. Without this, tuiChannel would have appended a duplicate.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.items).toEqual([
      { id: "a1", kind: "assistant", ts: 1, text: "streamed", isStreaming: true },
    ]);
  });

  it("trims busy guard before talking to the agent", async () => {
    const turn = vi.fn(async () => {});
    const agent = { turn } as unknown as PhusAgent;
    const { dispatch } = captureDispatch();
    const setInput = vi.fn();

    await submitMessage("anything", {
      agent,
      state: { ...initialState, busy: true } as AppState,
      dispatch,
      setInput,
      channel: () => ({ name: "noop", listen: () => {}, send: async () => {} }),
      getItems: () => [],
      clearChat: vi.fn(),
    });

    expect(turn).not.toHaveBeenCalled();
  });

  it("short-circuits slash commands without sending a turn", async () => {
    const turn = vi.fn(async () => {});
    const agent = { turn } as unknown as PhusAgent;
    const { dispatch } = captureDispatch();
    const setInput = vi.fn();

    // /quit returns the "quit" sentinel — turn must NOT be invoked.
    const result = await submitMessage("/quit", {
      agent,
      state: initialState,
      dispatch,
      setInput,
      channel: () => ({ name: "noop", listen: () => {}, send: async () => {} }),
      getItems: () => [],
      clearChat: vi.fn(),
    });

    expect(result).toBe("quit");
    expect(turn).not.toHaveBeenCalled();
  });
});
