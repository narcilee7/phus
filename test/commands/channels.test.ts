// test/commands/channels.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildChannelFromConfig, collectChannels } from "../../src/commands/channels.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";
import type { ChannelConfig } from "../../src/infra/config/schema.js";
import { HookRegistry } from "../../src/core/runtime/hook.js";

describe("buildChannelFromConfig", () => {
  it("creates a websocket channel", async () => {
    const ch = await buildChannelFromConfig({ type: "websocket", port: 3001 });
    expect(ch?.name).toBe("websocket");
  });

  it("creates an sse channel", async () => {
    const ch = await buildChannelFromConfig({ type: "sse", port: 3002 });
    expect(ch?.name).toBe("sse");
  });

  it("creates a telegram channel", async () => {
    const ch = await buildChannelFromConfig({ type: "telegram", token: "t" });
    expect(ch?.name).toBe("telegram");
  });

  it("returns undefined for unknown type", async () => {
    const ch = await buildChannelFromConfig({ type: "unknown" as any });
    expect(ch).toBeUndefined();
  });
});

describe("collectChannels", () => {
  beforeEach(() => {
    delete process.env.TELEGRAM_TOKEN;
  });

  it("uses CLI flags over YAML config for the same channel type", async () => {
    const agent = makeMockAgent();
    const configChannels: ChannelConfig[] = [{ type: "websocket", port: 1111 }];
    const channels = await collectChannels(agent, { websocket: "2222" }, configChannels);

    const names = channels.map((c) => c.name);
    expect(names).toContain("websocket");
    expect(names.filter((n) => n === "websocket")).toHaveLength(1);

    // CLI-created channel wins; listen on it to confirm the port.
    const ws = channels.find((c) => c.name === "websocket")!;
    await ws.listen(makeMockAgent() as unknown as PhusAgent);
    expect(ws.status()?.details?.port).toBe(2222);
    await ws.close();
  });

  it("merges YAML config channels when no CLI flag overlaps", async () => {
    const agent = makeMockAgent();
    const configChannels: ChannelConfig[] = [
      { type: "sse", port: 3002 },
      { type: "telegram", token: "${TELEGRAM_TOKEN}" },
    ];
    const channels = await collectChannels(agent, {}, configChannels);
    expect(channels.map((c) => c.name).sort()).toEqual(["sse", "telegram"]);
  });

  it("includes plugin-provided channels", async () => {
    const agent = makeMockAgent();
    agent.hooks.register(
      "provide_channels",
      async () => [{ name: "plugin-channel", listen: vi.fn(), send: vi.fn() }],
      { mode: "broadcast" },
    );
    const channels = await collectChannels(agent, {});
    expect(channels.map((c) => c.name)).toContain("plugin-channel");
  });

  it("deduplicates by channel name", async () => {
    const agent = makeMockAgent();
    agent.hooks.register(
      "provide_channels",
      async () => [{ name: "sse", listen: vi.fn(), send: vi.fn() }],
      { mode: "broadcast" },
    );
    const channels = await collectChannels(agent, { sse: "4000" });
    expect(channels.filter((c) => c.name === "sse")).toHaveLength(1);
  });
});

function makeMockAgent(): PhusAgent {
  return {
    tape: {} as any,
    skills: {} as any,
    hooks: new HookRegistry(),
  } as unknown as PhusAgent;
}
