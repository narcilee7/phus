import type { SessionId } from "@phus/core/types/brand.js";

export interface ManagedSessionRuntime<
  AgentEvent = unknown,
  PlanEvent = unknown,
  CompactEvent = unknown,
  PermissionRequest = unknown,
> {
  readonly sessionId: SessionId;
  hasMessages(): boolean;
  saveCheckpoint(): void;
  setToolPermissionHandler(
    handler: (request: PermissionRequest) => Promise<boolean>,
  ): void;
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
  subscribeToPlanEvents(handler: (event: PlanEvent) => void): () => void;
  subscribeToCompactEvents(handler: (event: CompactEvent) => void): () => void;
  dispose(): void;
}

export interface SessionRuntimeRegistryOptions {
  maxRuntimes?: number;
  now?: () => number;
}

interface Subscriber<Event> {
  handler: (event: Event) => void;
  unsubs: Map<SessionId, () => void>;
}

interface RuntimeEntry<Runtime> {
  runtime: Runtime;
  lastUsedAt: number;
  pending: number;
  tail: Promise<void>;
}

/** Owns one independent runtime per Session and schedules its work. */
export class SessionRuntimeRegistry<
  AgentEvent,
  PlanEvent,
  CompactEvent,
  PermissionRequest,
  Runtime extends ManagedSessionRuntime<AgentEvent, PlanEvent, CompactEvent, PermissionRequest>,
> {
  private readonly entries = new Map<SessionId, RuntimeEntry<Runtime>>();
  private readonly maxRuntimes: number;
  private readonly now: () => number;
  private selectedSessionId: SessionId | undefined;
  private permissionHandler:
    | ((request: PermissionRequest) => Promise<boolean>)
    | undefined;
  private readonly agentSubscribers = new Set<Subscriber<AgentEvent>>();
  private readonly planSubscribers = new Set<Subscriber<PlanEvent>>();
  private readonly compactSubscribers = new Set<Subscriber<CompactEvent>>();
  private disposed = false;

  constructor(
    private readonly createRuntime: (sessionId: SessionId) => Runtime,
    options: SessionRuntimeRegistryOptions = {},
  ) {
    this.maxRuntimes = Math.max(1, options.maxRuntimes ?? 8);
    this.now = options.now ?? Date.now;
  }

  getOrCreate(sessionId: SessionId): Runtime {
    this.assertOpen();
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsedAt = this.now();
      return existing.runtime;
    }

    const runtime = this.createRuntime(sessionId);
    if (runtime.sessionId !== sessionId) {
      runtime.dispose();
      throw new Error(
        `runtime factory returned ${runtime.sessionId} for requested session ${sessionId}`,
      );
    }
    const entry: RuntimeEntry<Runtime> = {
      runtime,
      lastUsedAt: this.now(),
      pending: 0,
      tail: Promise.resolve(),
    };
    this.entries.set(sessionId, entry);
    this.attachSubscribers(sessionId, runtime);
    if (this.permissionHandler) runtime.setToolPermissionHandler(this.permissionHandler);
    this.evictIfNeeded(sessionId);
    return runtime;
  }

  get(sessionId: SessionId): Runtime | undefined {
    return this.entries.get(sessionId)?.runtime;
  }

  getSelected(): Runtime | undefined {
    return this.selectedSessionId
      ? this.entries.get(this.selectedSessionId)?.runtime
      : undefined;
  }

  getSelectedSessionId(): SessionId | undefined {
    return this.selectedSessionId;
  }

  selectIfUnset(sessionId: SessionId): Runtime {
    if (!this.selectedSessionId) return this.setSelected(sessionId);
    return this.getOrCreate(this.selectedSessionId);
  }

  setSelected(sessionId: SessionId): Runtime {
    this.assertOpen();
    const target = this.getOrCreate(sessionId);
    const previousId = this.selectedSessionId;
    if (previousId && previousId !== sessionId) {
      const previous = this.entries.get(previousId)?.runtime;
      if (previous?.hasMessages()) previous.saveCheckpoint();
    }
    this.selectedSessionId = sessionId;
    const entry = this.entries.get(sessionId);
    if (entry) entry.lastUsedAt = this.now();
    this.evictIfNeeded(sessionId);
    return target;
  }

  list(): Runtime[] {
    return [...this.entries.values()]
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((entry) => entry.runtime);
  }

  async runExclusive<T>(
    sessionId: SessionId,
    run: (runtime: Runtime) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    const runtime = this.getOrCreate(sessionId);
    const entry = this.entries.get(sessionId)!;
    entry.pending++;

    const previous = entry.tail;
    let release!: () => void;
    entry.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      entry.lastUsedAt = this.now();
      return await run(runtime);
    } finally {
      entry.pending--;
      entry.lastUsedAt = this.now();
      release();
      this.evictIfNeeded();
    }
  }

  setToolPermissionHandler(
    handler: (request: PermissionRequest) => Promise<boolean>,
  ): void {
    this.permissionHandler = handler;
    for (const entry of this.entries.values()) {
      entry.runtime.setToolPermissionHandler(handler);
    }
  }

  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void {
    return this.addSubscriber(this.agentSubscribers, handler, (runtime, subscriber) =>
      runtime.subscribeToAgentEvents(subscriber));
  }

  subscribeToPlanEvents(handler: (event: PlanEvent) => void): () => void {
    return this.addSubscriber(this.planSubscribers, handler, (runtime, subscriber) =>
      runtime.subscribeToPlanEvents(subscriber));
  }

  subscribeToCompactEvents(handler: (event: CompactEvent) => void): () => void {
    return this.addSubscriber(this.compactSubscribers, handler, (runtime, subscriber) =>
      runtime.subscribeToCompactEvents(subscriber));
  }

  disposeAll(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sessionId of this.entries.keys()) this.disposeEntry(sessionId);
    this.agentSubscribers.clear();
    this.planSubscribers.clear();
    this.compactSubscribers.clear();
    this.selectedSessionId = undefined;
  }

  private addSubscriber<Event>(
    subscribers: Set<Subscriber<Event>>,
    handler: (event: Event) => void,
    subscribe: (runtime: Runtime, handler: (event: Event) => void) => () => void,
  ): () => void {
    this.assertOpen();
    const record: Subscriber<Event> = { handler, unsubs: new Map() };
    subscribers.add(record);
    for (const [sessionId, entry] of this.entries) {
      record.unsubs.set(sessionId, subscribe(entry.runtime, handler));
    }
    return () => {
      if (!subscribers.delete(record)) return;
      for (const unsubscribe of record.unsubs.values()) unsubscribe();
      record.unsubs.clear();
    };
  }

  private attachSubscribers(sessionId: SessionId, runtime: Runtime): void {
    for (const record of this.agentSubscribers) {
      record.unsubs.set(sessionId, runtime.subscribeToAgentEvents(record.handler));
    }
    for (const record of this.planSubscribers) {
      record.unsubs.set(sessionId, runtime.subscribeToPlanEvents(record.handler));
    }
    for (const record of this.compactSubscribers) {
      record.unsubs.set(sessionId, runtime.subscribeToCompactEvents(record.handler));
    }
  }

  private evictIfNeeded(protectedSessionId?: SessionId): void {
    while (this.entries.size > this.maxRuntimes) {
      const candidate = [...this.entries.entries()]
        .filter(([sessionId, entry]) =>
          sessionId !== protectedSessionId
          && sessionId !== this.selectedSessionId
          && entry.pending === 0)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      if (!candidate) return;
      const [sessionId, entry] = candidate;
      if (entry.runtime.hasMessages()) entry.runtime.saveCheckpoint();
      this.disposeEntry(sessionId);
    }
  }

  private disposeEntry(sessionId: SessionId): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    for (const subscribers of [
      this.agentSubscribers,
      this.planSubscribers,
      this.compactSubscribers,
    ]) {
      for (const record of subscribers) {
        record.unsubs.get(sessionId)?.();
        record.unsubs.delete(sessionId);
      }
    }
    entry.runtime.dispose();
    this.entries.delete(sessionId);
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("session runtime registry is disposed");
  }
}
