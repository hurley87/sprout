import { BrowserTransport } from "../browser-transport";
import type { ProviderEvent, TranscriptEvent } from "../events";
import { MICROPHONE_ONSET_MS, MICROPHONE_ONSET_QUIET_MS, MICROPHONE_QUIET_MS } from "../microphone-turn";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import { COUNTING_LESSON_GRAPH, INITIAL_COUNTING_NODE_ID } from "./counting-lesson";
import { initialTeachingContext, teachingInstruction } from "./live-context";
import { SupportClarification, SUPPORT_CLARIFICATION_INSTRUCTION } from "./support-clarification";
import { TutorStabilizationGate } from "./tutor-stabilization";
import { parseClassifierEndpointCode } from "./classifier-failure";
import { CLASSIFIER_VERSION } from "./conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "./live-classification-diagnostic";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type ClassificationSource,
  type CurrentNodeSteeringContext,
  type LessonRuntimeEvent,
  type LessonRuntimeState,
  type RenderIdentity,
  type RuntimeSource,
} from "./lesson-runtime-reducer";

/** Explicit lesson policy, not a provider turn boundary or calibrated setting. */
export const LESSON_TIMING = {
  childSnapshotDebounceMs: 300,
  // PCM observation samples every 50 ms. Require sustained quiet beyond a brief pause.
  tutorTranscriptStableMs: 600,
  tutorClassificationQuietMs: 500,
  quietDrainMs: 250,
  clockTickMs: 50,
  classifierTimeoutMs: 10_000,
  steeringAckTimeoutMs: 10_000,
  startupTimeoutMs: 30_000,
  microphoneOnsetMs: MICROPHONE_ONSET_MS,
  microphoneOnsetQuietMs: MICROPHONE_ONSET_QUIET_MS,
  microphoneQuietMs: MICROPHONE_QUIET_MS,
} as const;

type Speaker = "child" | "tutor" | "unknown";
type Fragment = { event: TranscriptEvent; source: RuntimeSource; order: number };
export type LessonDiagnostic = {
  timestamp: string;
  atMs: number;
  type: string;
  runtimeId: string;
  visitId: number | null;
  childTurnId: number | null;
  nodeId: string;
  transcriptRevision: number;
  transcriptSpeaker: Speaker;
  classifierVersion?: typeof CLASSIFIER_VERSION;
  detail: unknown;
};
export type LessonEventCursor = { runtimeId: string; offset: number };
export type LessonObservation = {
  cursor: LessonEventCursor;
  snapshot: LessonSnapshot;
  events: readonly LessonDiagnostic[];
};

export type LessonSnapshot = {
  status: "prepared" | "connecting" | "live" | "ended";
  runtime: LessonRuntimeState | null;
  display: RenderIdentity;
  transcript: string;
  error: string | null;
  awaitingSteering: boolean;
  diagnostics: readonly LessonDiagnostic[];
};

function eventDiagnosticSource(event: LessonRuntimeEvent, before: LessonRuntimeState): ClassificationSource {
  return {
    nodeId: before.nodeId,
    transcriptRevision: before.transcriptRevision,
    ...("source" in event ? event.source : runtimeSource(before)),
  };
}

/** Live lesson wiring and current-attempt diagnostics. */
export class LessonRuntime {
  private readonly runtimeId = crypto.randomUUID();
  private readonly createdAt = performance.now();
  private readonly transport: BrowserTransport;
  private state: LessonRuntimeState | null = null;
  private status: LessonSnapshot["status"] = "prepared";
  private display: RenderIdentity = {
    token: `${this.runtimeId}:initial`,
    nodeId: INITIAL_COUNTING_NODE_ID,
    sceneId: COUNTING_LESSON_GRAPH[INITIAL_COUNTING_NODE_ID].sceneId,
  };
  private error: string | null = null;
  private fragments: Fragment[] = [];
  private transcript = "";
  private revision = 0;
  private order = 0;
  private providerFloorMs = 0;
  private lastChildEndMs = 0;
  private childTurnFloorMs = 0;
  private readonly seenEventIds = new Set<string>();
  private readonly events: LessonDiagnostic[] = [];
  private classification?: { abort: AbortController; source: ClassificationSource; speaker: Speaker };
  private lastClassifiedKey?: string;
  private readonly tutorStabilization: TutorStabilizationGate;
  private readonly supportClarification: SupportClarification;
  private clarificationRequest?: { eventId: string; source: ClassificationSource };
  private stabilizationTimer?: ReturnType<typeof setTimeout>;
  private clockTimer?: ReturnType<typeof setTimeout>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private steering?: {
    eventId: string;
    source: RuntimeSource;
    timer: ReturnType<typeof setTimeout>;
    queued: Fragment[];
  };

  constructor(
    audio: HTMLAudioElement,
    private readonly changed: (snapshot: LessonSnapshot) => void,
  ) {
    this.tutorStabilization = new TutorStabilizationGate(
      {
        tutorTranscriptStableMs: LESSON_TIMING.tutorTranscriptStableMs,
        tutorClassificationQuietMs: LESSON_TIMING.tutorClassificationQuietMs,
      },
      () => this.now(),
      () => void this.classify("tutor_utterance_stable"),
      event => {
        this.log(event.type, event, event.source, "tutor");
        this.publish();
      },
    );
    this.supportClarification = new SupportClarification(
      source => {
        const eventId = `${this.runtimeId}:clarify:${source.visitId}:${source.childTurnId}:${source.transcriptRevision}`;
        this.clarificationRequest = { eventId, source };
        try {
          this.transport.send({
            type: "session.instructions.append",
            event_id: eventId,
            delegation_id: null,
            content: SUPPORT_CLARIFICATION_INSTRUCTION,
          });
          this.log("gpt_live.clarification_append", { eventId, content: SUPPORT_CLARIFICATION_INSTRUCTION }, source);
        } catch {
          this.supportClarification.cancel("send_failed");
          this.log("clarification.send_failed", { message: "Scene held; request budget spent." }, source);
        }
        this.publish();
      },
      (type, source, detail) => this.log(type, detail, source),
    );
    this.transport = new BrowserTransport(audio, true);
    this.transport.setMicrophoneDiagnosticSink(event => {
      if (this.status === "ended") return;
      this.log(event.type, event.detail);
      // Measurements are exported, but do not rerender the page every VAD frame/window.
    });
    this.log("lesson.prepared", { timing: LESSON_TIMING });
  }

  private now() {
    return performance.now() - this.createdAt;
  }
  private log(type: string, detail: unknown = null, source?: ClassificationSource | RuntimeSource, speaker?: Speaker) {
    this.events.push({
      timestamp: new Date().toISOString(),
      atMs: this.now(),
      type,
      ...(type.startsWith("classifier.") ? { classifierVersion: CLASSIFIER_VERSION } : {}),
      runtimeId: source?.runtimeId ?? this.runtimeId,
      visitId: source?.visitId ?? this.state?.visitId ?? null,
      childTurnId: source?.childTurnId ?? this.state?.childTurnId ?? null,
      nodeId: source && "nodeId" in source ? source.nodeId : (this.state?.nodeId ?? INITIAL_COUNTING_NODE_ID),
      transcriptRevision: source && "transcriptRevision" in source ? source.transcriptRevision : this.revision,
      transcriptSpeaker: speaker ?? this.state?.transcriptSource ?? "unknown",
      detail,
    });
  }

  private publish() {
    this.changed(this.snapshot());
  }

  snapshot(): LessonSnapshot {
    return {
      status: this.status,
      runtime: this.state,
      display: this.display,
      transcript: this.transcript,
      error: this.error,
      awaitingSteering: Boolean(this.steering),
      diagnostics: this.events.slice(-100),
    };
  }

  /** Read the complete journal independently of React publication; never return runtime references. */
  observe(after?: LessonEventCursor): LessonObservation {
    if (
      after &&
      (after.runtimeId !== this.runtimeId ||
        !Number.isSafeInteger(after.offset) ||
        after.offset < 0 ||
        after.offset > this.events.length)
    )
      throw new Error("Lesson observation cursor does not belong to this runtime journal");
    return structuredClone({
      cursor: { runtimeId: this.runtimeId, offset: this.events.length },
      snapshot: this.snapshot(),
      events: this.events.slice(after?.offset ?? 0),
    });
  }

  /** Called from React's committed scene, never from render.requested handling. */
  confirmRendered(identity: RenderIdentity) {
    if (
      this.status === "ended" ||
      identity.token !== this.display.token ||
      identity.nodeId !== this.display.nodeId ||
      identity.sceneId !== this.display.sceneId
    )
      return;
    if (this.status === "prepared") {
      this.state = createLessonRuntime(this.runtimeId, {
        quietDrainMs: LESSON_TIMING.quietDrainMs,
        atMs: this.now(),
      });
      this.status = "connecting";
      this.log("render.confirmed", { identity, initial: true });
      this.log("runtime.created", this.state);
      this.publish();
      this.startupTimer = setTimeout(() => this.fail("GPT-Live startup timed out."), LESSON_TIMING.startupTimeoutMs);
      void this.transport
        .start(this.receive, () => this.fail("The voice connection or microphone became unavailable."))
        .catch(() => this.fail("Could not start GPT-Live. Check microphone access and local server configuration."));
      return;
    }
    if (this.state?.phase !== "rendering") return;
    this.log("render.confirmed", { identity });
    this.dispatch({ type: "render.confirmed", runtimeId: this.runtimeId, identity, atMs: this.now() });
  }

  private dispatch(event: LessonRuntimeEvent) {
    if (!this.state || this.status === "ended") return;
    const before = this.state;
    const result = reduceLessonRuntime(before, event);
    this.state = result.state;
    if (event.type !== "clock.tick")
      this.log(
        `runtime.event.${event.type}`,
        { event, accepted: before !== result.state },
        eventDiagnosticSource(event, before),
        event.type === "transcript.updated" ? event.speaker : before.transcriptSource,
      );
    if (JSON.stringify({ ...before, nowMs: 0 }) !== JSON.stringify({ ...this.state, nowMs: 0 })) {
      this.log("runtime.changed", { trigger: event.type, before, after: this.state });
    }
    if (this.state.phase === "stopped") {
      this.fail(
        "The runtime stopped during an unconfirmed scene change. Export diagnostics and start a fresh attempt.",
      );
      return;
    }
    for (const effect of result.effects) {
      this.log(effect.type, effect);
      if (effect.type === "render.requested") {
        this.cancelClassification("node_visit_changed");
        // Install the visit boundary synchronously, before React's render/confirmation.
        this.providerFloorMs = Math.max(this.providerFloorMs, ...this.fragments.map(fragment => fragment.event.endMs));
        this.fragments = [];
        this.transcript = "";
        this.log("transcript.reset", { reason: "node_visit_committed", providerFloorMs: this.providerFloorMs });
        this.display = effect.identity;
      } else if (effect.type === "steering.ready") {
        this.log("transcript.reset", { reason: "node_render_confirmed" });
        this.appendSteering(effect.context, effect.renderToken);
      } else {
        this.stop("lesson_completed");
      }
    }
    this.syncTutorStabilization(event.type);
    this.scheduleClock();
    this.publish();
  }

  private scheduleClock() {
    clearTimeout(this.clockTimer);
    if (
      !this.state ||
      this.status === "ended" ||
      this.state.phase !== "active" ||
      this.state.outputActivity !== "quiet" ||
      !this.state.tutorOutputObserved ||
      this.state.tutorOutputDrained ||
      this.state.childSpeaking
    )
      return;
    this.clockTimer = setTimeout(() => {
      if (this.state) this.dispatch({ type: "clock.tick", source: runtimeSource(this.state), atMs: this.now() });
    }, LESSON_TIMING.clockTickMs);
  }

  private receive = (event: ProviderEvent) => {
    if (this.status === "ended" || !this.state) return;
    if (event.sourceId !== undefined && event.sourceId !== this.transport.activeSourceId) return;
    if (event.eventId) {
      if (this.seenEventIds.has(event.eventId)) return;
      this.seenEventIds.add(event.eventId);
    }
    const source = runtimeSource(this.state);
    switch (event.type) {
      case "session.started":
        clearTimeout(this.startupTimer);
        this.status = "live";
        this.log("session.started", { sourceId: event.sourceId });
        if (!this.appendSteering(initialTeachingContext(), this.display.token)) return;
        if (!this.transport.openInput(() => this.log("microphone.input_opened")))
          this.fail("Could not open GPT-Live microphone input.");
        this.publish();
        return;
      case "microphone.activity_started":
      case "microphone.speech_started":
        if (this.status !== "live") return;
        this.log(event.type);
        if (!this.state.childSpeaking) {
          this.cancelClassification("child_turn_started");
          this.childTurnFloorMs = this.lastChildEndMs;
          // Block progression immediately; only a discarded candidate can revalidate prior eligibility.
          this.dispatch({
            type: event.type === "microphone.activity_started" ? "child.candidate.started" : "child.turn.started",
            source,
            atMs: this.now(),
          });
        } else if (event.type === "microphone.speech_started") {
          this.dispatch({ type: "child.turn.confirmed", source, atMs: this.now() });
        }
        return;
      case "microphone.activity_discarded":
      case "microphone.speech_stopped":
        if (this.status !== "live") return;
        this.log(event.type, event.type === "microphone.speech_stopped" ? { quietMs: event.quietMs } : null);
        if (this.state.childSpeaking) {
          if (event.type === "microphone.speech_stopped" && this.state.childCandidate)
            this.dispatch({ type: "child.turn.confirmed", source, atMs: this.now() });
          this.dispatch({
            type:
              event.type === "microphone.activity_discarded" && this.state.childCandidate
                ? "child.candidate.discarded"
                : "child.turn.ended",
            source,
            atMs: this.now(),
          });
          if (
            event.type === "microphone.speech_stopped" &&
            this.state.phase === "active" &&
            !this.state.hasChildTranscript
          ) {
            const latestChild = this.fragments.findLast(fragment => fragment.event.speaker === "child");
            // Report missing evidence at turn end, not missing speech. A late matching
            // transcript may still arrive; neither this diagnostic nor old text grants eligibility.
            this.log("classifier.blocked", {
              reason: "missing_current_turn_child_transcript",
              trigger: event.type,
              outputActivity: this.state.outputActivity,
              latestChildTranscript: latestChild
                ? { source: latestChild.source, startMs: latestChild.event.startMs, endMs: latestChild.event.endMs }
                : null,
            });
          }
          this.scheduleClassification(event.type);
        }
        return;
      case "output.activity":
        this.log("output.activity", { state: event.state }, source);
        this.dispatch({ type: "output.activity", source, state: event.state, atMs: this.now() });
        return;
      case "transcript": {
        const fragment = { event, source, order: ++this.order };
        if (this.steering && this.state.phase === "active") {
          // Wait for the matching append's provider-timeline boundary, not packet arrival time.
          this.steering.queued.push(fragment);
          if (this.steering.queued.length > 256)
            this.fail("Too many transcript fragments pending steering confirmation.");
          return;
        }
        this.observeTranscript(fragment);
        return;
      }
      case "context.appended": {
        this.log("gpt_live.context_appended", event);
        const clarification = this.clarificationRequest;
        if (
          clarification &&
          event.name === "session.instructions.appended" &&
          event.clientEventId === clarification.eventId
        ) {
          this.supportClarification.acknowledge(
            this.state,
            this.status === "live" && !this.steering,
            clarification.source,
          );
          return;
        }
        const steering = this.steering;
        if (
          !steering ||
          event.name !== "session.instructions.appended" ||
          event.clientEventId !== steering.eventId ||
          steering.source.visitId !== this.state.visitId
        )
          return;
        if (typeof event.startMs !== "number" || !Number.isFinite(event.startMs) || event.startMs < 0) {
          this.fail(
            "Steering acknowledgment had no usable timeline boundary; transcript isolation cannot be confirmed.",
          );
          return;
        }
        clearTimeout(steering.timer);
        this.providerFloorMs = Math.max(this.providerFloorMs, event.startMs);
        const queued = steering.queued;
        this.steering = undefined;
        this.log("transcript.visit_boundary", { providerFloorMs: this.providerFloorMs });
        for (const fragment of queued) this.observeTranscript(fragment);
        this.scheduleClassification("steering_acknowledged");
        this.publish();
        return;
      }
      case "provider.error":
        this.log("gpt_live.error", { code: event.code, clientEventId: event.clientEventId });
        this.fail("GPT-Live reported an error. Export diagnostics and start a fresh attempt.");
        return;
      case "session.closed":
        this.stop("session_closed", true);
        return;
    }
  };

  private observeTranscript(fragment: Fragment) {
    if (!this.state || this.status !== "live") return;
    const { event, source } = fragment;
    const speaker = event.speaker === "child" ? "child" : "tutor";
    if (this.state.phase === "rendering") {
      // A new child revision interrupts an unconfirmed render even before a VAD turn is bound.
      if (
        speaker === "child" &&
        event.delta.trim() &&
        Number.isFinite(event.startMs) &&
        event.startMs >= this.providerFloorMs
      )
        this.dispatch({
          type: "transcript.updated",
          source,
          revision: ++this.revision,
          speaker,
          atMs: this.now(),
        });
      else this.log("transcript.ignored", { reason: "render_in_progress", speaker }, source, speaker);
      return;
    }
    let rejection: string | undefined;
    if (!Number.isFinite(event.startMs) || !Number.isFinite(event.endMs) || event.endMs < event.startMs)
      rejection = "invalid_interval";
    else if (event.startMs < this.providerFloorMs) rejection = "previous_visit_interval";
    else if (source.visitId !== this.state.visitId) rejection = "previous_visit_source";
    else if (
      speaker === "child" &&
      (!this.state.hasChildTurn ||
        source.childTurnId !== this.state.childTurnId ||
        event.startMs < this.childTurnFloorMs)
    )
      rejection = "no_matching_child_turn";
    if (rejection) {
      this.log(
        "transcript.ignored",
        { reason: rejection, speaker, startMs: event.startMs, endMs: event.endMs },
        source,
      );
      this.publish();
      return;
    }
    if (!event.delta) return;
    if (this.state.phase !== "active") return;
    this.fragments.push(fragment);
    // Order by provider interval; late delivery must not put an earlier child answer after its acknowledgment.
    this.fragments.sort((a, b) => a.event.startMs - b.event.startMs || a.order - b.order);
    const messages: { speaker: string; turn: number; text: string }[] = [];
    for (const item of this.fragments) {
      const label = item.event.speaker === "child" ? "Child" : "Tutor";
      const previous = messages.at(-1);
      if (previous?.speaker === label && previous.turn === item.source.childTurnId) previous.text += item.event.delta;
      else messages.push({ speaker: label, turn: item.source.childTurnId, text: item.event.delta });
    }
    const text = messages
      .filter(message => message.text.trim())
      .map(message => `${message.speaker}: ${message.text.trim()}`)
      .join("\n");
    if (text.length > 12_000) {
      this.fail("This node's transcript reached the lesson limit. Export and restart.");
      return;
    }
    if (speaker === "child") this.lastChildEndMs = Math.max(this.lastChildEndMs, event.endMs);
    if (text === this.transcript) return;
    this.cancelClassification("newer_transcript_snapshot");
    this.transcript = text;
    this.revision++;
    this.log(
      "transcript.snapshot",
      { speaker, transcript: text, startMs: event.startMs, endMs: event.endMs },
      source,
      speaker,
    );
    this.dispatch({
      type: "transcript.updated",
      source,
      revision: this.revision,
      speaker,
      atMs: this.now(),
    });
    this.scheduleClassification(`${speaker}_transcript_stabilized`);
  }

  private scheduleClassification(trigger: string) {
    clearTimeout(this.stabilizationTimer);
    if (!this.state || this.status !== "live" || this.steering) return;
    if (this.state.transcriptSource === "tutor") {
      this.syncTutorStabilization(trigger);
      return;
    }
    if (!classificationSource(this.state)) return;
    const delayMs = LESSON_TIMING.childSnapshotDebounceMs;
    this.log("classifier.scheduled", { trigger, delayMs });
    this.stabilizationTimer = setTimeout(() => void this.classify(trigger), delayMs);
    this.publish();
  }

  private syncTutorStabilization(trigger: string) {
    if (this.state) this.supportClarification.observe(this.state, this.status === "live" && !this.steering);
    if (this.state) this.tutorStabilization.observe(this.state, this.status === "live" && !this.steering, trigger);
  }

  private async classify(trigger: string) {
    if (!this.state || this.status !== "live" || this.steering) return;
    // These two values are captured together, once, before any async work.
    const source = classificationSource(this.state);
    const transcript = this.transcript;
    const speaker = this.state.transcriptSource;
    if (!source || !transcript) return;
    const key = JSON.stringify(source);
    if (this.lastClassifiedKey === key) return;
    this.lastClassifiedKey = key;
    const abort = new AbortController();
    this.classification = { abort, source, speaker };
    this.log("classifier.started", { trigger, transcript }, source, speaker);
    this.publish();
    const startedAtMs = this.now();
    const timeout = AbortSignal.timeout(LESSON_TIMING.classifierTimeoutMs);
    const signal = AbortSignal.any([abort.signal, timeout]);
    let category: "network" | "http" | "invalid_json" | "invalid_schema" = "network";
    let httpStatus: number | null = null;
    let endpointCode: ReturnType<typeof parseClassifierEndpointCode> = null;
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: source.nodeId,
          transcriptRevision: source.transcriptRevision,
          transcript,
        }),
        signal,
      });
      httpStatus = response.status;
      if (abort.signal.aborted || this.status !== "live") return;
      // Classify HTTP failures before parsing: Next can return an HTML 404/500.
      if (!response.ok) {
        category = "http";
        endpointCode = parseClassifierEndpointCode(await response.json().catch(() => null));
        throw new Error("Classification endpoint unavailable");
      }
      category = "invalid_json";
      const body: unknown = await response.json();
      if (abort.signal.aborted || this.status !== "live") return;
      if (timeout.aborted) throw new Error("Classification timed out");
      category = "invalid_schema";
      if (!body || typeof body !== "object" || !("proposal" in body)) throw new Error("Invalid classifier response");
      const proposal = body.proposal === null ? null : parseConversationStateProposal(body.proposal);
      if (body.proposal !== null && !proposal) throw new Error("Invalid classifier proposal");
      const diagnostic = parseLiveClassificationDiagnostic("diagnostic" in body ? body.diagnostic : undefined);
      this.log(
        diagnostic ? "classifier.mapping" : "classifier.mapping_unavailable",
        diagnostic ?? { reason: "diagnostic_missing_or_invalid" },
        source,
        speaker,
      );
      this.log(
        proposal
          ? "classifier.result"
          : diagnostic?.decision === "accepted"
            ? "classifier.held"
            : "classifier.abstained",
        { proposal, elapsedMs: this.now() - startedAtMs },
        source,
        speaker,
      );
      if (proposal) {
        this.supportClarification.cancel("proposal_received");
        this.dispatch({ type: "proposal.received", source, proposal, atMs: this.now() });
      }
    } catch {
      if (!abort.signal.aborted && this.status === "live")
        this.log(
          "classifier.error",
          {
            message: "Classification failed; scene held.",
            category: timeout.aborted ? "timeout" : category,
            httpStatus,
            endpointCode,
            elapsedMs: this.now() - startedAtMs,
          },
          source,
          speaker,
        );
    } finally {
      if (this.classification?.abort === abort) this.classification = undefined;
      this.publish();
    }
  }

  private cancelClassification(reason: string) {
    this.supportClarification.cancel(reason);
    clearTimeout(this.stabilizationTimer);
    this.tutorStabilization.cancel(reason);
    if (!this.classification) return;
    this.classification.abort.abort();
    this.log("classifier.cancelled", { reason }, this.classification.source, this.classification.speaker);
    this.classification = undefined;
  }

  private appendSteering(context: CurrentNodeSteeringContext, renderToken: string) {
    if (!this.state || this.status !== "live") return false;
    const eventId = `${this.runtimeId}:steer:${this.state.visitId}`;
    const content = teachingInstruction(context);
    const source = runtimeSource(this.state);
    this.steering = {
      eventId,
      source,
      queued: [],
      timer: setTimeout(
        () => this.fail("GPT-Live steering acknowledgment timed out. Export diagnostics and restart."),
        LESSON_TIMING.steeringAckTimeoutMs,
      ),
    };
    try {
      this.transport.send({ type: "session.instructions.append", event_id: eventId, delegation_id: null, content });
      this.log("gpt_live.steering_append", { eventId, renderToken, context, content }, source);
      return true;
    } catch {
      this.fail("GPT-Live steering could not be sent.");
      return false;
    }
  }

  private fail(message: string) {
    if (this.status === "ended") return;
    this.error = message;
    this.log("error", { message });
    this.stop("failure", true);
  }

  stop(reason = "parent_stop", disconnected = false) {
    if (this.status === "ended") return;
    this.cancelClassification(reason);
    clearTimeout(this.clockTimer);
    clearTimeout(this.startupTimer);
    if (this.steering) clearTimeout(this.steering.timer);
    this.steering = undefined;
    if (this.state && this.state.phase !== "complete") {
      this.state = reduceLessonRuntime(this.state, {
        type: disconnected ? "disconnect" : "stop",
        runtimeId: this.runtimeId,
        atMs: this.now(),
      }).state;
      this.display = {
        token: `${this.runtimeId}:stopped`,
        nodeId: this.state.nodeId,
        sceneId: COUNTING_LESSON_GRAPH[this.state.nodeId].sceneId,
      };
    }
    this.status = "ended";
    this.log("lesson.ended", { reason, runtime: this.state });
    // Request provider close when possible, then release all local resources immediately.
    try {
      this.transport.send({ type: "session.close", event_id: `${this.runtimeId}:close` });
    } catch {
      /* Already disconnected. */
    }
    this.transport.close();
    this.publish();
  }

  report() {
    return {
      product: "sprout",
      classifierVersion: CLASSIFIER_VERSION,
      version: 1,
      runtimeId: this.runtimeId,
      clock: "browser.performance.now-relative-to-attempt",
      timing: LESSON_TIMING,
      runtime: this.state,
      status: this.status,
      error: this.error,
      transcript: this.transcript,
      events: [...this.events],
    };
  }
}
