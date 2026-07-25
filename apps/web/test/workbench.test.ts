import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, "apps/cli/dist/phus.mjs");
const PORT = 19876;
const WS_URL = `ws://localhost:${PORT}`;

function sendControl<T>(socket: WebSocket, action: string, sessionId?: string): Promise<{ action: string; data?: T; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`control ${action} timeout`)), 5000);
    const handler = (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(String(data)) as { type?: string; action?: string; data?: T; error?: string };
        if (parsed.type === "control_response" && parsed.action === action) {
          clearTimeout(timer);
          socket.off("message", handler);
          resolve(parsed as { action: string; data?: T; error?: string });
        }
      } catch {
        // ignore non-json
      }
    };
    socket.on("message", handler);
    socket.send(JSON.stringify({ type: "control", action, sessionId }));
  });
}

describe("Web Workbench integration", () => {
  let gateway: ReturnType<typeof spawn> | undefined;

  beforeAll(async () => {
    gateway = spawn("node", [BINARY, "gateway", "--websocket", String(PORT)], {
      cwd: REPO_ROOT,
      env: { ...process.env, PHUS_HOME: ".phus", PHUS_LOG_LEVEL: "warn" },
    });

    // Wait for the WebSocket server to accept connections.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("gateway did not start in time")), 15000);
      const check = () => {
        const socket = new WebSocket(WS_URL);
        socket.on("open", () => {
          clearTimeout(timer);
          socket.close();
          resolve();
        });
        socket.on("error", () => {
          setTimeout(check, 200);
        });
      };
      check();
    });
  });

  afterAll(() => {
    if (gateway) {
      gateway.kill("SIGTERM");
    }
  });

  it("connects and can list sessions/skills/plans via control messages", async () => {
    const socket = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket did not connect")), 5000);
      socket.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on("error", reject);
    });

    const sessions = await sendControl<unknown[]>(socket, "list_sessions");
    expect(sessions.error).toBeUndefined();
    expect(Array.isArray(sessions.data)).toBe(true);

    const skills = await sendControl<unknown[]>(socket, "list_skills");
    expect(skills.error).toBeUndefined();
    expect(Array.isArray(skills.data)).toBe(true);

    const plans = await sendControl<unknown[]>(socket, "list_plans");
    expect(plans.error).toBeUndefined();
    expect(Array.isArray(plans.data)).toBe(true);

    socket.close();
  });
});
