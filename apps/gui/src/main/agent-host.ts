// apps/gui/src/main/agent-host.ts
// Owns one PhusAgent in-process and bridges every facade call to the
// renderer over IPC. The renderer never imports `@root/*`; everything goes
// through this class.
//
// Lifecycle:
//   const host = new AgentHost(getWindow);
//   await host.start();              // creates PhusAgent, subscribes events
//   await host.turn(envelope);       // from renderer
//   await host.dispose();            // on app quit
//
// Permission flow:
//   - setToolPermissionHandler receives ToolPermissionRequest from the agent
//   - We mint a requestId, webContents.send('permission:request', ...)
//   - The renderer shows a modal and calls phus.permissionResponse(...)
//   - We resolve the original promise with the boolean

import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import {
  PhusAgent,
  type ToolPermissionRequest,
  type PlanEvent,
} from "@root/bridge/pi-agent.js";
import type { PhusAgentHandle } from "@root/bridge/lifecycle.js";
import type { Envelope, Outbound } from "@root/types/channel/index.js";
import { loadConfig, resetConfigCache } from "@root/infra/config/index.js";
import type { SessionId } from "@root/types/brand.js";
import { asOptionalSessionId } from "@root/types/brand.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { IpcChannels } from "../shared/ipc-channels.js";
import type {
  EnvelopePayload,
  OutboundMsg,
  PermissionRequestPayload,
  PermissionResponsePayload,
} from "../shared/ipc-schema.js";

type WindowGetter = () => BrowserWindow | null;

/** In-process ChannelAdapter whose `send` forwards Outbound[] to the
 *  renderer. `listen` is never called — the agent only needs `send`. */
class IpcChannel {
  readonly name = "gui-ipc";

  constructor(private readonly getWindow: WindowGetter) {}

  // The agent's turn() invokes channel.send(outbounds) at the end of the
  // Bub chain. We forward them verbatim to the renderer via broadcast.
  async send(outbounds: Outbound[]): Promise<void> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    const msg: OutboundMsg = { outbounds };
    win.webContents.send(IpcChannels.Outbound, msg);
  }

  // ChannelAdapter.listen is part of the interface but unused by the GUI
  // (the agent doesn't subscribe to messages back through the channel).
  listen(): void {
    /* no-op */
  }
}

export class AgentHost {
  private handle: PhusAgentHandle | null = null;
  private readonly channel = new IpcChannel(() => this.window);
  private window: BrowserWindow | null = null;
  private readonly pendingPermissions = new Map<string, (allow: boolean) => void>();

  /** Set the active window. Called from main/index.ts after window creation. */
  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /** Create PhusAgent, subscribe to events, register permission handler. */
  async start(): Promise<void> {
    if (this.handle) throw new Error("[phus-gui] AgentHost already started");

    const config = loadConfig();
    this.handle = await PhusAgent.create({ config });

    // Wire the permission handler — every dangerous tool call blocks here
    // until the renderer responds.
    this.handle.agent.setToolPermissionHandler((req: ToolPermissionRequest) =>
      this.bridgePermission(req),
    );

    // Forward every AgentEvent to the renderer. Renderer uses eventToAction
    // to dispatch state changes (text deltas, tool calls, tool results, …).
    this.handle.agent.subscribeToAgentEvents((event: AgentEvent) => {
      const win = this.window;
      if (!win || win.isDestroyed()) return;
      win.webContents.send(IpcChannels.AgentEvent, { event });
    });

    // Forward PlanEvents (PlanRunner / PhusAgent emit them via the
    // planEventHandlers set). Renderer mirrors the TUI PlanPanel.
    this.handle.agent.subscribeToPlanEvents((event: PlanEvent) => {
      const win = this.window;
      if (!win || win.isDestroyed()) return;
      win.webContents.send(IpcChannels.PlanEvent, { event });
    });
  }

  /** Restart after bootstrap. Disposes the current handle and creates a
   *  fresh one (config has been mutated by the BootstrapWizard). */
  async restart(): Promise<void> {
    await this.dispose();
    resetConfigCache();
    await this.start();
  }

  async dispose(): Promise<void> {
    if (!this.handle) return;
    // Reject any in-flight permission requests — the renderer is going away.
    for (const resolve of this.pendingPermissions.values()) resolve(false);
    this.pendingPermissions.clear();
    const h = this.handle;
    this.handle = null;
    await h.dispose();
  }

  // ─── Turn lifecycle (called by main IPC handlers) ──────────────────────

  async turn(envelope: EnvelopePayload): Promise<void> {
    if (!this.handle) throw new Error("[phus-gui] AgentHost not started");
    // Narrow EnvelopePayload (TypeBox validated) into the Envelope shape
    // PhusAgent.turn() expects. The shape is identical at runtime.
    const env = envelope as unknown as Envelope;
    await this.handle.agent.turn(env, this.channel);
  }

  abort(): void {
    this.handle?.agent.abort();
  }

  interrupt(): void {
    this.handle?.agent.interrupt();
  }

  async waitForIdle(): Promise<void> {
    await this.handle?.agent.waitForIdle();
  }

  /** Minimal slash-command dispatcher. Full src/tui/commands.ts parity
   *  needs a UI-state object that lives in the renderer, so v1 only handles
   *  commands with a clean facade equivalent. Unknown commands route back
   *  to the renderer via an outbound system-info entry. */
  async runSlash(command: string): Promise<void> {
    if (!this.handle) throw new Error("[phus-gui] AgentHost not started");
    const trimmed = command.replace(/^[,/]/, "").trim();
    const [name, ...rest] = trimmed.split(/\s+/);
    const agent = this.handle.agent;
    switch (name) {
      case "":
      case "help":
        return this.sendSystemInfo(HELP_TEXT);
      case "clear":
      case "new":
        await agent.clearConversation();
        return this.sendSystemInfo("✓ conversation cleared");
      case "model":
        if (rest.length === 0) {
          return this.sendSystemInfo(`model: ${agent.getModelLabel()}`);
        }
        await agent.setModel(rest.join(" "));
        return this.sendSystemInfo(`✓ model set to ${agent.getModelLabel()}`);
      case "think":
      case "thinking": {
        if (rest.length === 0) {
          return this.sendSystemInfo(`thinking: ${agent.getThinkingLevel()}`);
        }
        const level = rest[0]!;
        agent.setThinkingLevel(level);
        return this.sendSystemInfo(`✓ thinking level: ${level}`);
      }
      case "interrupt":
      case "abort":
        agent.abort();
        return this.sendSystemInfo("✓ interrupted current turn");
      case "undo": {
        const sid = agent.getCurrentSessionId();
        if (!sid) return this.sendSystemInfo("no active session");
        await agent.restoreCheckpoint(sid);
        return this.sendSystemInfo("✓ restored from checkpoint");
      }
      case "checkpoint": {
        const sid = agent.getCurrentSessionId();
        if (!sid) return this.sendSystemInfo("no active session");
        if (rest[0] === "list") {
          const list = agent.listCheckpoints(sid);
          return this.sendSystemInfo(
            list.length === 0
              ? "(no checkpoints)"
              : list.map((c) => `• ts=${c.ts} @ ${new Date(c.ts).toISOString()}`).join("\n"),
          );
        }
        agent.saveCheckpoint(sid);
        return this.sendSystemInfo("✓ checkpoint saved");
      }
      case "compact":
        await agent.compactCurrentSession();
        return this.sendSystemInfo("✓ session compacted");
      case "reload":
      case "reload-skills":
        await agent.reloadSkills();
        return this.sendSystemInfo("✓ skills reloaded");
      case "skills":
      case "hooks":
      case "tape":
      case "policy":
      case "context":
      case "diagnostics":
        // Renderer pulls rich state via dedicated IPC channels.
        return this.sendSystemInfo(`/${name} — refreshing side-panel`);
      default:
        return this.sendSystemInfo(
          `unknown /${name ?? ""} — type /help (Phase 6 adds full TUI parity)`,
        );
    }
  }

  private sendSystemInfo(text: string): void {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    const msg: OutboundMsg = {
      outbounds: [
        {
          to: "gui:user",
          content: text,
          type: "text",
          channel: "gui",
        },
      ],
    };
    win.webContents.send(IpcChannels.Outbound, msg);
  }

  // ─── Permission flow (bidirectional bridge) ────────────────────────────

  /** Called by PhusAgent.setToolPermissionHandler. Sends a permission-request
   *  to the renderer and awaits the matching permission-response. */
  private bridgePermission(req: ToolPermissionRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const win = this.window;
      if (!win || win.isDestroyed()) {
        resolve(false);
        return;
      }
      const requestId = randomUUID();
      this.pendingPermissions.set(requestId, resolve);

      const payload: PermissionRequestPayload = {
        requestId,
        toolName: req.toolName,
        args: req.args,
        toolCallId: req.toolCallId,
      };
      win.webContents.send(IpcChannels.PermissionRequest, payload);
    });
  }

  /** Called by main IPC handler when renderer responds to a permission
   *  prompt. Resolves the original bridgePermission() promise. */
  resolvePermission(response: PermissionResponsePayload): void {
    const resolve = this.pendingPermissions.get(response.requestId);
    if (!resolve) return;
    this.pendingPermissions.delete(response.requestId);
    resolve(response.allow);
  }

  // ─── Read-side facade thin wrappers ────────────────────────────────────

  getDiagnostics() {
    return this.handle?.agent.getDiagnostics();
  }
  getHookReport() {
    return this.handle?.agent.getHookReport();
  }
  getAllSkills() {
    return [...(this.handle?.agent.getAllSkills() ?? [])];
  }
  getPolicy() {
    return [...(this.handle?.agent.getPolicy() ?? [])];
  }
  getTapeStats() {
    return this.handle?.agent.getTapeStats() ?? { totalEntries: 0, sessions: {} };
  }
  getTapeSummary(sessionId: string | undefined, limit: number): string {
    return this.handle?.agent.getTapeSummary(asOptionalSessionId(sessionId), limit) ?? "";
  }
  getAutonomyGate() {
    return this.handle?.agent.getAutonomyGate();
  }
  getMemoryStore() {
    return this.handle?.agent.getMemoryStore();
  }
  getMemoryBytes(): number {
    return this.handle?.agent.getMemoryBytes() ?? 0;
  }
  getSkillDrafts() {
    return [...(this.handle?.agent.getSkillDrafts() ?? [])];
  }
  getModelLabel(): string {
    return this.handle?.agent.getModelLabel() ?? "unknown";
  }
  getThinkingLevel(): string {
    return this.handle?.agent.getThinkingLevel() ?? "off";
  }
  getMessageCount(): number {
    return this.handle?.agent.getMessageCount() ?? 0;
  }
  getTurnCount(): number {
    return this.handle?.agent.getTurnCount() ?? 0;
  }
  getTapeTotalEntries(): number {
    return this.handle?.agent.getTapeTotalEntries() ?? 0;
  }
  getSessionCount(): number {
    return this.handle?.agent.getSessionCount() ?? 0;
  }
  getSkillCount(): number {
    return this.handle?.agent.getSkillCount() ?? 0;
  }
  getCurrentSessionId(): string | undefined {
    return this.handle?.agent.getCurrentSessionId();
  }
  getCurrentModel() {
    return this.handle?.agent.getCurrentModel() ?? { provider: "", id: "" };
  }

  async setModel(modelId: string, provider?: string): Promise<void> {
    await this.handle?.agent.setModel(modelId, provider);
  }
  setThinkingLevel(level: string): void {
    this.handle?.agent.setThinkingLevel(level);
  }
  async reloadSkills(): Promise<void> {
    await this.handle?.agent.reloadSkills();
  }
  async clearConversation(): Promise<void> {
    await this.handle?.agent.clearConversation();
  }
  async compactCurrentSession(): Promise<string> {
    return (await this.handle?.agent.compactCurrentSession()) ?? "";
  }
  saveCheckpoint(sessionId: SessionId): void {
    this.handle?.agent.saveCheckpoint(sessionId);
  }
  listCheckpoints(sessionId: SessionId) {
    return this.handle?.agent.listCheckpoints(sessionId) ?? [];
  }
  async restoreCheckpoint(sessionId: SessionId): Promise<void> {
    await this.handle?.agent.restoreCheckpoint(sessionId);
  }
  promoteSkillDraft(name: string): boolean {
    return this.handle?.agent.promoteSkillDraft(name) ?? false;
  }
  archiveSkillDraft(name: string): boolean {
    return this.handle?.agent.archiveSkillDraft(name) ?? false;
  }
  pauseActivePlan(): string | undefined {
    return this.handle?.agent.pauseActivePlan();
  }
  async resumeActivePlan(): Promise<string | undefined> {
    return this.handle?.agent.resumeActivePlan();
  }
  cancelActivePlan(): string | undefined {
    return this.handle?.agent.cancelActivePlan();
  }
  retryStep(planId: string, stepId: string): boolean {
    return this.handle?.agent.retryStep(planId, stepId) ?? false;
  }
  async reflect(sessionId: string, task: string) {
    if (!this.handle) throw new Error("[phus-gui] AgentHost not started");
    return this.handle.agent.reflect(asOptionalSessionId(sessionId)!, task);
  }
  async suggestStartup(): Promise<string> {
    return (await this.handle?.agent.suggestStartup()) ?? "";
  }
  getPlanRunner() {
    return this.handle?.agent.getPlanRunner();
  }
  getPlanStore() {
    return this.handle?.agent.getPlanStore();
  }

  /** Used by main IPC handlers to check liveness without exposing the
   *  whole facade. */
  isReady(): boolean {
    return this.handle !== null;
  }
}

const HELP_TEXT = `Available slash commands:
  /help              show this help
  /clear             clear current conversation
  /new               alias for /clear
  /model [id]        show or change the active model
  /think [level]     show or change thinking level
  /interrupt         abort the in-flight turn
  /undo              restore from last checkpoint
  /checkpoint        save a checkpoint
  /checkpoint list   list checkpoints
  /compact           compact current session
  /reload            reload skills from disk
  /skills, /hooks, /tape, /policy, /context, /diagnostics
                    open the corresponding side-panel`;

// Export the singleton so main/index.ts can wire window + IPC handlers.
export const agentHost = new AgentHost();
