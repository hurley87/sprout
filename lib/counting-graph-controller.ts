import { COUNTING_GRAPH, type CountingNodeId } from "./counting-graph";
import { countingTutorInstructions, COUNTING_COMPLETION_INSTRUCTIONS } from "./counting-graph-tutor";
import type { ClientCommand, ProviderEvent, OutputActivityEvent } from "./events";

export type GraphPhase =
  "awaiting source" | "awaiting render" | "teaching" | "awaiting audio drain" | "complete" | "failed" | "stopped";
export type GraphIdentity = Readonly<{ sourceId: number; visitId: number; nodeId: CountingNodeId }>;
export type GraphSnapshot = Readonly<{
  nodeId: CountingNodeId;
  visitId: number;
  sourceId?: number;
  phase: GraphPhase;
  ackOutputDrained: boolean;
  ackOutputObserved: boolean;
  failure?: string;
}>;
export interface GraphClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface GraphTransport {
  /** Must synchronously reject a send if this is no longer the active source. */
  send(sourceId: number, command: ClientCommand): boolean;
  retireSource(sourceId: number): void;
}
type Handle = { sourceId?: number; visitId?: number; state: "accepted" | "retired" };

/** Experimental PCM gate, NOT a provider playback-completion guarantee.
 * One source may own only one teaching attempt: opaque provider handles and
 * optional provider offsets cannot establish visit attribution on reused sources.
 * No model-provided node/visit/action is accepted. See docs/graph-controller.md.
 */
export class CountingGraphController {
  private state: GraphSnapshot = {
    nodeId: COUNTING_GRAPH.entry,
    visitId: 0,
    phase: "awaiting source",
    ackOutputDrained: false,
    ackOutputObserved: false,
  };
  private usedSources = new Set<number>();
  private handles = new Map<string, Handle>();
  private pending?: { id: string; identity: GraphIdentity };
  private render?: GraphIdentity;
  private activity: OutputActivityEvent["state"] = "unavailable";
  private quietTimer?: unknown;
  private failureTimer?: unknown;
  private quietGeneration = 0;
  private failureGeneration = 0;
  private commandId = 0;
  private disposed = false;
  private childTurnStarted = false;

  constructor(
    private transport: GraphTransport,
    private clock: GraphClock,
    private options: { quietMs: number; failureMs: number },
  ) {
    if (
      !Number.isFinite(options.quietMs) ||
      options.quietMs <= 0 ||
      !Number.isFinite(options.failureMs) ||
      options.failureMs <= options.quietMs
    ) {
      throw new Error("Require positive quietMs and a larger finite failureMs");
    }
  }

  get snapshot(): GraphSnapshot {
    return { ...this.state };
  }
  get pendingRender(): GraphIdentity | undefined {
    return this.render && { ...this.render };
  }
  get delegationHandles(): ReadonlyMap<string, Readonly<Handle>> {
    return new Map([...this.handles].map(([id, handle]) => [id, { ...handle }]));
  }

  /** Caller supplies a newly activated application-owned transport source.
   * The returned sink captures the local visit; never obtain this identity from GPT.
   * Render the snapshot, then confirm pendingRender before any teaching context.
   */
  startSource(sourceId: number): ((event: ProviderEvent) => void) | undefined {
    if (
      this.disposed ||
      !Number.isSafeInteger(sourceId) ||
      sourceId < 0 ||
      this.usedSources.has(sourceId) ||
      !["awaiting source", "failed"].includes(this.state.phase)
    )
      return;
    this.usedSources.add(sourceId);
    this.clearTimers();
    this.state = {
      nodeId: this.state.nodeId,
      visitId: this.state.visitId + 1,
      sourceId,
      phase: "awaiting render",
      ackOutputDrained: false,
      ackOutputObserved: false,
    };
    this.activity = "unavailable";
    this.childTurnStarted = false;
    const identity = this.identity();
    this.render = identity;
    this.armFailure(identity);
    return event => this.receive(event, identity);
  }

  confirmRender(identity: GraphIdentity): boolean {
    if (
      this.state.phase !== "awaiting render" ||
      !this.render ||
      !this.matches(identity, this.render) ||
      !this.current(identity)
    )
      return false;
    const pending = this.pending;
    this.render = undefined;
    this.clearTimers();
    // Set the phase before sending, so reentrant callbacks cannot release twice.
    this.state = { ...this.state, phase: pending ? "awaiting source" : "teaching" };
    if (!this.send(identity.sourceId, countingTutorInstructions(identity.nodeId), pending?.id ?? null)) {
      this.fail("context send failed");
      return false;
    }
    if (pending) {
      this.retirePending();
      this.transport.retireSource(identity.sourceId);
      this.state = { ...this.state, sourceId: undefined };
    } else {
      this.armFailure(identity);
    }
    return true;
  }

  stop(): void {
    if (this.disposed) return;
    this.cancel("stopped");
  }
  disconnect(): void {
    if (this.disposed || this.state.phase === "stopped" || this.state.phase === "complete") return;
    this.fail("disconnected; activate a fresh source to retry");
  }
  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private identity(): GraphIdentity {
    return { sourceId: this.state.sourceId!, visitId: this.state.visitId, nodeId: this.state.nodeId };
  }
  private matches(a: GraphIdentity, b: GraphIdentity): boolean {
    return a.sourceId === b.sourceId && a.visitId === b.visitId && a.nodeId === b.nodeId;
  }
  private current(identity: GraphIdentity): boolean {
    return !this.disposed && this.matches(identity, this.identity());
  }
  private receive(event: ProviderEvent, identity: GraphIdentity): void {
    // Even rejected opaque IDs stay retired for the lifetime of this controller.
    if (event.type === "delegation") {
      if (this.handles.has(event.id)) return;
      this.handles.set(event.id, { sourceId: event.sourceId, state: "retired" });
      if (
        !this.current(identity) ||
        event.sourceId !== identity.sourceId ||
        this.state.phase !== "teaching" ||
        !this.state.ackOutputObserved ||
        !event.id.trim()
      )
        return;
      this.handles.set(event.id, { sourceId: identity.sourceId, visitId: identity.visitId, state: "accepted" });
      this.pending = { id: event.id, identity };
      this.state = { ...this.state, phase: "awaiting audio drain" };
      this.clearQuiet(); // Never credit any quiet time before delegation acceptance.
      this.armFailure(identity);
      this.startQuiet(identity);
      return;
    }
    // The teaching-source sink also owns cancellation during its successor's
    // render wait. It cannot contribute media activity to that new visit.
    const ownsPendingRender =
      this.state.phase === "awaiting render" &&
      this.pending &&
      this.matches(identity, this.pending.identity) &&
      this.state.sourceId === identity.sourceId;
    if ((!this.current(identity) && !ownsPendingRender) || event.sourceId !== identity.sourceId) return;
    if (event.type === "session.closed" || event.type === "provider.error") {
      this.disconnect();
      return;
    }
    if (event.type === "microphone.speech_started" || event.type === "microphone.activity_started") {
      if (["awaiting audio drain", "awaiting render"].includes(this.state.phase)) {
        this.fail("child interrupted; activate a fresh source to retry");
      } else if (this.state.phase === "teaching") {
        this.childTurnStarted = true;
        this.state = { ...this.state, ackOutputObserved: false, ackOutputDrained: false };
        this.clearQuiet();
      }
      return;
    }
    if (event.type !== "output.activity" || !["teaching", "awaiting audio drain"].includes(this.state.phase)) return;
    const previous = this.activity;
    this.activity = event.state;
    if (event.state !== "quiet") {
      this.state = {
        ...this.state,
        ackOutputObserved: this.state.ackOutputObserved || (event.state === "active" && this.childTurnStarted),
        ackOutputDrained: false,
      };
      this.clearQuiet();
      return;
    }
    this.state = { ...this.state, ackOutputDrained: this.state.ackOutputObserved };
    if (previous !== "quiet") this.startQuiet(identity);
  }

  private startQuiet(identity: GraphIdentity): void {
    if (
      this.state.phase !== "awaiting audio drain" ||
      !this.pending ||
      !this.state.ackOutputObserved ||
      !this.state.ackOutputDrained ||
      this.activity !== "quiet"
    )
      return;
    const generation = ++this.quietGeneration;
    this.quietTimer = this.clock.setTimeout(() => {
      if (
        generation !== this.quietGeneration ||
        !this.current(identity) ||
        this.state.phase !== "awaiting audio drain" ||
        this.activity !== "quiet" ||
        !this.state.ackOutputObserved ||
        !this.state.ackOutputDrained ||
        !this.pending
      )
        return;
      this.advance(identity);
    }, this.options.quietMs);
  }

  private advance(identity: GraphIdentity): void {
    this.clearTimers();
    this.handles.set(this.pending!.id, { ...this.pending!.identity, state: "retired" });
    const edge = COUNTING_GRAPH.nodes[identity.nodeId].success;
    if (edge.type === "complete") {
      this.state = { ...this.state, phase: "complete", ackOutputDrained: false, ackOutputObserved: false };
      const id = this.pending!.id;
      this.retirePending();
      if (!this.send(identity.sourceId, COUNTING_COMPLETION_INSTRUCTIONS, id)) this.fail("completion send failed");
      return;
    }
    // Old scene remains current until this exact gate passes. A new local visit
    // identifies the intended rendered successor; it cannot teach on this source.
    this.state = {
      nodeId: edge.nodeId,
      visitId: this.state.visitId + 1,
      sourceId: identity.sourceId,
      phase: "awaiting render",
      ackOutputDrained: false,
      ackOutputObserved: false,
    };
    this.activity = "unavailable";
    this.childTurnStarted = false;
    this.render = this.identity();
    this.armFailure(this.render);
  }
  private send(sourceId: number, content: string, id: string | null): boolean {
    try {
      return this.transport.send(sourceId, {
        type: "session.instructions.append",
        event_id: `graph-context-${++this.commandId}`,
        content,
        delegation_id: id,
      });
    } catch {
      return false;
    }
  }
  private armFailure(identity: GraphIdentity): void {
    const generation = ++this.failureGeneration;
    if (this.failureTimer !== undefined) this.clock.clearTimeout(this.failureTimer);
    this.failureTimer = this.clock.setTimeout(() => {
      if (
        generation === this.failureGeneration &&
        this.current(identity) &&
        ["teaching", "awaiting audio drain", "awaiting render"].includes(this.state.phase)
      )
        this.fail("experimental gate timed out; activate a fresh source to retry");
    }, this.options.failureMs);
  }
  private clearQuiet(): void {
    ++this.quietGeneration;
    if (this.quietTimer !== undefined) this.clock.clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
  }
  private clearTimers(): void {
    ++this.failureGeneration;
    this.clearQuiet();
    if (this.failureTimer !== undefined) this.clock.clearTimeout(this.failureTimer);
    this.failureTimer = undefined;
  }
  private retirePending(): void {
    if (this.pending) {
      this.handles.set(this.pending.id, { ...this.pending.identity, state: "retired" });
      this.pending = undefined;
    }
  }
  private cancel(phase: "failed" | "stopped", failure?: string): void {
    this.clearTimers();
    this.retirePending();
    this.render = undefined;
    const sourceId = this.state.sourceId;
    this.state = {
      nodeId: this.state.nodeId,
      visitId: this.state.visitId + 1,
      phase,
      failure,
      ackOutputDrained: false,
      ackOutputObserved: false,
    };
    this.activity = "unavailable";
    this.childTurnStarted = false;
    if (sourceId !== undefined) this.transport.retireSource(sourceId);
  }
  private fail(reason: string): void {
    this.cancel("failed", reason);
  }
}
