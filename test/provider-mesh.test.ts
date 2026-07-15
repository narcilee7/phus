// test/provider-mesh.test.ts
import { describe, expect, it, vi } from "vitest";
import { ProviderMesh, type EndpointSpec } from "../src/core/provider-mesh/index.js";

function ep(name: string, overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name,
    provider: "openai",
    modelId: "gpt-4o",
    priority: 0,
    weight: 1,
    costPerMillion: { input: 0, output: 0 },
    ...overrides,
  };
}

describe("ProviderMesh — failover", () => {
  it("returns primary endpoint on success", async () => {
    const mesh = new ProviderMesh([ep("primary"), ep("backup", { priority: 1 })]);
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await mesh.call(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    // Primary was called
    expect(fn.mock.calls[0]![0].name).toBe("primary");
  });

  it("falls back to backup on primary failure", async () => {
    const mesh = new ProviderMesh([ep("primary"), ep("backup", { priority: 1 })], { maxRetriesPerEndpoint: 1 });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("primary down"))
      .mockResolvedValueOnce("backup ok");
    const result = await mesh.call(fn);
    expect(result).toBe("backup ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries within same endpoint before failing over", async () => {
    const mesh = new ProviderMesh([ep("primary"), ep("backup", { priority: 1 })], { maxRetriesPerEndpoint: 3 });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const result = await mesh.call(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after all endpoints exhausted", async () => {
    const mesh = new ProviderMesh([ep("a"), ep("b", { priority: 1 })], { maxRetriesPerEndpoint: 1 });
    const fn = vi.fn().mockRejectedValue(new Error("all down"));
    await expect(mesh.call(fn)).rejects.toThrow("all down");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("ProviderMesh — circuit breaker", () => {
  it("opens circuit after threshold failures", async () => {
    const mesh = new ProviderMesh([ep("a")], { cbFailureThreshold: 3, maxRetriesPerEndpoint: 1 });
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    for (let i = 0; i < 3; i++) {
      await mesh.call(fn).catch(() => {});
    }
    expect(mesh.getEndpoint("a")?.circuit).toBe("open");
  });

  it("skips open-circuit endpoints", async () => {
    const mesh = new ProviderMesh([
      ep("bad", { priority: 0 }),
      ep("good", { priority: 1 }),
    ], { maxRetriesPerEndpoint: 1 });
    // Force bad's circuit open (simulating prior failures)
    mesh.getEndpoint("bad")!.circuit = "open";

    const fn = vi.fn().mockResolvedValue("good-result");
    const result = await mesh.call(fn);
    expect(result).toBe("good-result");
    // First call should have picked good (bad is open)
    expect(fn.mock.calls[0]![0].name).toBe("good");
  });

  it("success closes the circuit", async () => {
    const mesh = new ProviderMesh([ep("a")], { cbFailureThreshold: 1, cbCooldownMs: 10 });
    // Open it
    await mesh.call(vi.fn().mockRejectedValue(new Error("x"))).catch(() => {});
    expect(mesh.getEndpoint("a")?.circuit).toBe("open");
    // Wait for cooldown, then succeed
    await new Promise((r) => setTimeout(r, 15));
    const fn = vi.fn().mockResolvedValue("ok");
    await mesh.call(fn);
    expect(mesh.getEndpoint("a")?.circuit).toBe("closed");
  });
});

describe("ProviderMesh — routing strategies", () => {
  it("cost-first picks lowest cost", () => {
    const mesh = new ProviderMesh([
      ep("expensive", { priority: 0, costPerMillion: { input: 30, output: 60 } }),
      ep("cheap", { priority: 99, costPerMillion: { input: 0.5, output: 1 } }),
    ], { strategy: "cost-first" });
    const picked = mesh.pickEndpoint();
    expect(picked?.spec.name).toBe("cheap");
  });

  it("latency-first picks lowest latency", () => {
    const mesh = new ProviderMesh([
      ep("slow", { priority: 0 }),
      ep("fast", { priority: 99 }),
    ], { strategy: "latency-first" });
    // Feed latencies
    mesh.getEndpoint("slow")!.latencies = [2000, 2500];
    mesh.getEndpoint("fast")!.latencies = [50, 80];
    expect(mesh.pickEndpoint()?.spec.name).toBe("fast");
  });

  it("weighted distributes over many calls", () => {
    const mesh = new ProviderMesh([
      ep("a", { weight: 1 }),
      ep("b", { weight: 9 }),
    ], { strategy: "weighted" });
    let aCount = 0, bCount = 0;
    for (let i = 0; i < 1000; i++) {
      const picked = mesh.pickEndpoint();
      if (picked?.spec.name === "a") aCount++; else bCount++;
    }
    // b should win ~90% of the time
    expect(bCount).toBeGreaterThan(aCount * 3);
  });
});

describe("ProviderMesh — record success/failure", () => {
  it("tracks success count + latency", async () => {
    const mesh = new ProviderMesh([ep("a")]);
    const fn = vi.fn().mockResolvedValue("ok");
    await mesh.call(fn);
    await mesh.call(fn);
    const s = mesh.getEndpoint("a")!;
    expect(s.totalSuccess).toBe(2);
    expect(s.totalFailure).toBe(0);
    expect(s.latencies.length).toBe(2);
  });

  it("tracks failure count", async () => {
    const mesh = new ProviderMesh([ep("a")], { maxRetriesPerEndpoint: 1 });
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await mesh.call(fn).catch(() => {});
    const s = mesh.getEndpoint("a")!;
    expect(s.totalFailure).toBe(1);
  });
});

describe("ProviderMesh — stats", () => {
  it("returns aggregate stats", () => {
    const mesh = new ProviderMesh([ep("a"), ep("b")]);
    mesh.getEndpoint("a")!.latencies = [100, 200];
    const stats = mesh.stats();
    expect(stats.endpoints).toHaveLength(2);
    expect(stats.endpoints[0]?.avgLatencyMs).toBe(150);
  });
});
