import { questionRecap, type QuestionOutcomeSnapshot } from "./mae386/question-outcomes";
import type { RewriteTranscript } from "./mae386/rewrite-proposal";
import { learnerNavigationIntent, parseLearnerNavigationText, isLearnerStopText } from "./conversation-progression";
import { terminalRecapComplete } from "./terminal-recap";
import { evidenceRecap } from "./evidence-recap";
import { normalizeAssessment, type ConversationAssessment, type ConversationVisit } from "./conversation-assessment";
import { BrowserTransport } from "../browser-transport";
import type { ProviderEvent, TranscriptEvent } from "../events";
import { MICROPHONE_ONSET_MS, MICROPHONE_ONSET_QUIET_MS, MICROPHONE_QUIET_MS } from "../microphone-turn";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import { currentNodeContext, type LessonDefinition } from "./lesson-definition";
import {
  answerRecoveryInstruction,
  initialTeachingContext,
  teachingInstruction,
  learnerSupportInstruction,
  missingAnswerCheckInstruction,
  supersedeAnswerCheckInstruction,
} from "./live-context";
import { SupportClarification } from "./support-clarification";
import { AnswerRecovery } from "./answer-recovery";
import { TutorStabilizationGate } from "./tutor-stabilization";
import { parseClassifierEndpointCode } from "./classifier-failure";
import { DiagnosticJournal, type LessonDiagnostic, type LessonEventCursor } from "./diagnostic-journal";
export type { LessonDiagnostic, LessonEventCursor } from "./diagnostic-journal";
import { parseLiveClassificationDiagnostic } from "./live-classification-diagnostic";
import {
  classificationSource,
  hasCurrentCompletionEvidence,
  meetsAuthoredCompletionPolicy,
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
export type LessonObservation = {
  /** Sample of the report clock, taken in the same browser read as the journal. */
  nowMs: number;
  cursor: LessonEventCursor;
  snapshot: LessonSnapshot;
  events: readonly LessonDiagnostic[];
};

export type LessonSnapshot = {
  status: "prepared" | "connecting" | "live" | "ended";
  runtime: LessonRuntimeState | null;
  display: RenderIdentity;
  transcript: string;
  recapText?: string;
  questionOutcomes?: QuestionOutcomeSnapshot;
  questionRecap?: ReturnType<typeof questionRecap>;
  error: string | null;
  awaitingSteering: boolean;
  diagnostics: readonly LessonDiagnostic[];
  assessment?: ConversationAssessment;
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
  private display: RenderIdentity;
  private error: string | null = null;
  private fragments: Fragment[] = [];
  private transcript = "";
  private revision = 0;
  private readonly conversationVisits = new Map<number, ConversationVisit>();
  private assessment: ConversationAssessment = { status: "idle", results: {} };
  private assessedConversation = "";
  private assessmentGeneration = 0;
  private order = 0;
  private providerFloorMs = 0;
  private lastChildEndMs = 0;
  private childTurnFloorMs = 0;
  private readonly seenEventIds = new Set<string>();
  private readonly journal: DiagnosticJournal;
  private classification?: { abort: AbortController; source: ClassificationSource; speaker: Speaker };
  private lastClassifiedKey?: string;
  private readonly tutorStabilization: TutorStabilizationGate;
  private readonly supportClarification: SupportClarification;
  private readonly answerRecovery: AnswerRecovery;
  private readonly terminalTranscriptRecovery: AnswerRecovery;
  private clarificationRequest?: { eventId: string; source: ClassificationSource };
  private stabilizationTimer?: ReturnType<typeof setTimeout>;
  private clockTimer?: ReturnType<typeof setTimeout>;
  private terminalTimer?: ReturnType<typeof setTimeout>;
  private terminalText?: string;
  private supportRequestedAt?: { visitId: number; revision: number };
  private missingAnswerCheck?: { eventId: string; source: ClassificationSource };
  private startupTimer?: ReturnType<typeof setTimeout>;
  private steering?: {
    eventId: string;
    source: RuntimeSource;
    timer: ReturnType<typeof setTimeout>;
    queued: Fragment[];
    support: boolean;
  };

  constructor(
    audio: HTMLAudioElement,
    private readonly changed: (snapshot: LessonSnapshot) => void,
    private readonly lessonDefinition: LessonDefinition,
  ) {
    this.journal = new DiagnosticJournal(this.runtimeId, () => this.now(), this.lessonDefinition.initialNodeId);
    if (this.lessonDefinition.nodes[this.lessonDefinition.initialNodeId].completeAfterTutorOutput)
      this.terminalText = evidenceRecap(this.lessonDefinition, null);
    this.display = {
      token: `${this.runtimeId}:initial`,
      nodeId: this.lessonDefinition.initialNodeId,
      sceneId: String(
        this.lessonDefinition.nodes[this.lessonDefinition.initialNodeId].presentation.sceneId ??
          this.lessonDefinition.initialNodeId,
      ),
    };
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
            content: this.lessonDefinition.recovery.supportClarificationInstruction,
          });
          this.log(
            "gpt_live.clarification_append",
            { eventId, content: this.lessonDefinition.recovery.supportClarificationInstruction },
            source,
          );
        } catch {
          this.supportClarification.cancel("send_failed");
          this.log("clarification.send_failed", { message: "Scene held; request budget spent." }, source);
        }
        this.publish();
      },
      (type, source, detail) => this.log(type, detail, source),
    );
    this.answerRecovery = new AnswerRecovery(
      source => this.sendAnswerRecovery(source),
      (type, source, detail) => this.log(type, detail, source),
      Object.values(this.lessonDefinition.nodes).some(node => node.concepts?.length),
      this.lessonDefinition.conversationFirst
        ? source => {
            this.dispatch({
              type: "conversation.recheck.requested",
              source,
              transcriptSnapshot: this.transcript,
              atMs: this.now(),
            });
            // Dispatch may restore an accepted close and even commit its scene.
            // Neither outcome may fall through to the recovery prompt callback.
            if (
              this.state &&
              (this.state.visitId !== source.visitId || hasCurrentCompletionEvidence(this.state, this.lessonDefinition))
            )
              return true;
            if (!this.state?.interruptedExchange?.ready) return false;
            this.log("conversation.recheck.started", null, source);
            this.scheduleClassification("missing_transcript_recheck");
            return true;
          }
        : undefined,
      this.lessonDefinition.conversationFirst === true,
    );
    // Local VAD stop is not a provider transcript boundary. Reuse the existing
    // quiet missing-transcript window, resolving terminal speech without prompts
    // or semantic classification when that bounded recovery expires.
    const resolveTerminalTranscript = (source: ClassificationSource) =>
      this.dispatch({ type: "terminal.learner.resolved", source, atMs: this.now() });
    this.terminalTranscriptRecovery = new AnswerRecovery(
      resolveTerminalTranscript,
      (type, source, detail) => this.log(`terminal.${type}`, detail, source),
      true,
      source => {
        // Resolution is a closure recheck, not a once-per-visit support prompt.
        resolveTerminalTranscript(source);
        return true;
      },
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
    this.journal.append(type, detail, { state: this.state, revision: this.revision, source, speaker });
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
      recapText: this.terminalText,
      questionOutcomes: this.state?.questionOutcomes,
      questionRecap: this.state?.questionOutcomes
        ? questionRecap(this.state.questionOutcomes, this.state.phase === "stopped")
        : undefined,
      error: this.error,
      awaitingSteering: Boolean(this.steering),
      diagnostics: this.journal.recent(),
      assessment: this.assessment,
    };
  }

  /** Read the complete journal independently of React publication; never return runtime references. */
  observe(after?: LessonEventCursor): LessonObservation {
    return this.journal.observe(after, () => this.snapshot());
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
        // Conversation closure can have short gaps between audio chunks. Use
        // the same sustained quiet boundary as tutor classification.
        quietDrainMs: this.lessonDefinition.conversationFirst
          ? Math.max(LESSON_TIMING.quietDrainMs, LESSON_TIMING.tutorClassificationQuietMs)
          : LESSON_TIMING.quietDrainMs,
        atMs: this.now(),
        lesson: this.lessonDefinition,
      });
      this.status = "connecting";
      this.log("render.confirmed", { identity, initial: true });
      this.log("runtime.created", this.state);
      this.publish();
      this.startupTimer = setTimeout(() => this.fail("GPT-Live startup timed out."), LESSON_TIMING.startupTimeoutMs);
      void this.transport
        .start(
          this.receive,
          () => this.fail("The voice connection or microphone became unavailable."),
          this.lessonDefinition.id,
        )
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
    const result = reduceLessonRuntime(before, event, this.lessonDefinition);
    this.state = result.state;
    // Provisional energy alone is not learner speech. Only an accepted turn or
    // authenticated learner text can supersede a check already sent to Live.
    if (
      before !== this.state &&
      (event.type === "child.turn.started" ||
        event.type === "child.turn.confirmed" ||
        (event.type === "transcript.updated" && event.speaker === "child"))
    )
      this.supersedeMissingAnswerCheck();
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
      switch (effect.type) {
        case "render.requested":
          this.supersedeMissingAnswerCheck();
          this.cancelClassification("node_visit_changed");
          // Install the visit boundary synchronously, before React's render/confirmation.
          this.providerFloorMs = Math.max(
            this.providerFloorMs,
            ...this.fragments.map(fragment => fragment.event.endMs),
          );
          this.fragments = [];
          this.transcript = "";
          this.log("transcript.reset", { reason: "node_visit_committed", providerFloorMs: this.providerFloorMs });
          if (
            this.lessonDefinition.id !== "mae386" &&
            effect.identity.nodeId &&
            this.lessonDefinition.nodes[effect.identity.nodeId].completeAfterTutorOutput
          )
            // Freeze before React can render or asynchronous assessment can settle.
            this.terminalText ??= evidenceRecap(this.lessonDefinition, this.state);
          this.display = effect.identity;
          break;
        case "steering.ready":
          if (this.lessonDefinition.nodes[effect.context.nodeId].assessConversationOnEntry)
            void this.assessConversation();
          this.log("transcript.reset", { reason: "node_render_confirmed" });
          this.appendSteering(effect.context, effect.renderToken);
          break;
        case "concept.revealed":
          // The reducer has already accepted this evidence into the current visit.
          // Reveal effects publish that state but do not authorize a scene transition.
          break;
        case "lesson.completed":
          this.stop("lesson_completed");
          break;
        default: {
          const exhaustive: never = effect;
          throw new Error(`Unhandled lesson runtime effect: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    this.syncTutorStabilization(event.type);
    this.scheduleClock();
    this.publish();
  }

  private scheduleClock() {
    clearTimeout(this.clockTimer);
    const terminalRendering =
      this.state?.phase === "rendering" &&
      this.state.lessonComplete &&
      this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput;
    if (
      !this.state ||
      this.status === "ended" ||
      (this.state.phase !== "active" && !terminalRendering) ||
      this.state.outputActivity !== "quiet" ||
      (!this.state.tutorOutputObserved && this.state.conversationAdvanceRequested !== "learner") ||
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
        if (this.status !== "connecting") return;
        clearTimeout(this.startupTimer);
        this.status = "live";
        this.log("session.started", { sourceId: event.sourceId });
        if (!this.appendSteering(initialTeachingContext(this.lessonDefinition), this.display.token, true)) return;
        if (!this.transport.openInput(() => this.log("microphone.input_opened")))
          this.fail("Could not open GPT-Live microphone input.");
        this.publish();
        return;
      case "microphone.activity_started":
      case "microphone.speech_started":
        if (this.status !== "live") return;
        this.log(event.type);
        if (!this.state.childSpeaking) {
          if (
            event.type === "microphone.speech_started" ||
            !this.lessonDefinition.conversationFirst ||
            this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput
          )
            this.cancelClassification("child_turn_started");
          this.childTurnFloorMs = this.lastChildEndMs;
          // Block progression immediately; missing-text recovery can later recheck conversational closure.
          this.dispatch({
            type: event.type === "microphone.activity_started" ? "child.candidate.started" : "child.turn.started",
            source,
            atMs: this.now(),
          });
        } else if (event.type === "microphone.speech_started") {
          this.cancelClassification("child_turn_confirmed");
          this.dispatch({ type: "child.turn.confirmed", source, atMs: this.now() });
        }
        return;
      case "microphone.activity_discarded":
      case "microphone.speech_stopped":
        if (this.status !== "live") return;
        this.log(event.type, event.type === "microphone.speech_stopped" ? { quietMs: event.quietMs } : null);
        if (this.state.childSpeaking) {
          if (event.type === "microphone.speech_stopped" && this.state.childCandidate) {
            this.cancelClassification("child_turn_confirmed");
            this.dispatch({ type: "child.turn.confirmed", source, atMs: this.now() });
          }
          this.dispatch({
            type:
              event.type === "microphone.activity_discarded" && this.state.childCandidate
                ? "child.candidate.discarded"
                : "child.turn.ended",
            source: runtimeSource(this.state),
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
            // Navigation uses the latest learner message in this visit, independently
            // of microphone segmentation. Missing current-turn text still cannot
            // authorize mastery classification or answer recovery for that request.
            if (
              this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput &&
              this.state.terminalLearnerPending
            )
              this.terminalTranscriptRecovery.arm(this.state, !this.steering);
            else if (!this.lessonDefinition.conversationFirst || !this.requestedNavigation())
              this.answerRecovery.arm(this.state, !this.steering);
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
        if (this.steering && this.state.phase === "active" && !(this.steering.support && event.speaker === "child")) {
          // New-scene transcripts wait for their timeline boundary. Same-node
          // support never blocks authenticated learner speech (especially Stop).
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
        // Support changes no visit or source identity. Advancing the visit floor
        // here would discard valid learner speech begun before its acknowledgment.
        if (!steering.support) this.providerFloorMs = Math.max(this.providerFloorMs, event.startMs);
        const queued = steering.queued;
        this.steering = undefined;
        this.log(steering.support ? "gpt_live.support_acknowledged" : "transcript.visit_boundary", {
          providerFloorMs: this.providerFloorMs,
        });
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
    const { event } = fragment;
    let { source } = fragment;
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
      ((!this.state.hasChildTurn && !this.state.childCandidate?.deferredTurn) ||
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
    // Valid learner text confirms provisional energy even before the detector's
    // sustained-speech callback. Bind it to the newly confirmed turn.
    if (speaker === "child" && event.delta.trim() && this.state.childCandidate?.deferredTurn) {
      this.cancelClassification("child_transcript_confirmed");
      this.dispatch({ type: "child.turn.confirmed", source, atMs: this.now() });
      source = runtimeSource(this.state);
      fragment = { ...fragment, source };
    }
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
    if (this.lessonDefinition.conversationFirst)
      this.conversationVisits.set(source.visitId, {
        nodeId: this.state!.nodeId,
        visitId: source.visitId,
        transcript: text,
      });
    this.revision++;
    this.log(
      "transcript.snapshot",
      { speaker, transcript: text, startMs: event.startMs, endMs: event.endMs },
      source,
      speaker,
    );
    const rewriteTurns: RewriteTranscript["turns"][number][] = [];
    if (this.lessonDefinition.nodes[this.state!.nodeId]?.currentRewrite) {
      let messageIndex = -1;
      let previousSpeaker = "";
      let length = 0;
      for (const message of messages.filter(message => message.text.trim())) {
        const trimmed = message.text.trim();
        if (previousSpeaker === message.speaker) length += 1;
        else {
          messageIndex++;
          length = 0;
          previousSpeaker = message.speaker;
        }
        if (message.speaker === "Child")
          rewriteTurns.push({ messageIndex, start: length, end: length + trimmed.length, childTurnId: message.turn });
        length += trimmed.length;
      }
    }
    this.dispatch({
      type: "transcript.updated",
      source,
      revision: this.revision,
      ...(this.lessonDefinition.nodes[this.state!.nodeId]?.currentRewrite
        ? { rewriteTranscript: { text, turns: rewriteTurns } }
        : {}),
      speaker,
      transcriptSnapshot: text,
      ...(speaker === "child" && this.lessonDefinition.questionGroups
        ? {
            learnerTurnText: this.fragments
              .filter(item => item.event.speaker === "child" && item.source.childTurnId === source.childTurnId)
              .map(item => item.event.delta)
              .join(""),
          }
        : {}),
      atMs: this.now(),
    });
    if (
      this.terminalText &&
      this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput &&
      speaker === "tutor"
    ) {
      const spoken = this.fragments.filter(item => item.event.speaker === "sprout").map(item => item.event);
      this.dispatch({
        type: "terminal.transcript.checked",
        source: runtimeSource(this.state),
        complete: terminalRecapComplete(this.terminalText, spoken),
        atMs: this.now(),
      });
    }
    this.scheduleClassification(`${speaker}_transcript_stabilized`);
  }

  private requestedNavigation() {
    return this.lessonDefinition.questionGroups
      ? parseLearnerNavigationText(this.state?.learnerUtterance?.text ?? "")
      : learnerNavigationIntent(this.transcript);
  }

  private scheduleClassification(trigger: string) {
    clearTimeout(this.stabilizationTimer);
    // Stop needs authenticated ended learner speech, but never waits for playback drain or Jev.
    if (
      this.lessonDefinition.questionGroups &&
      this.state?.hasChildTranscript &&
      this.state.phase === "active" &&
      !this.state.childSpeaking &&
      (!this.steering || this.steering.support) &&
      this.state.learnerUtterance?.source.childTurnId === this.state.childTurnId &&
      isLearnerStopText(this.state.learnerUtterance.text)
    ) {
      this.stop("learner_stop");
      return;
    }
    // A UI support request supplies no learner transcript revision. Hold old
    // closure observations until actual new conversation arrives instead.
    if (
      this.state &&
      this.supportRequestedAt?.visitId === this.state.visitId &&
      this.supportRequestedAt.revision === this.state.transcriptRevision
    )
      return;
    if (this.state && this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput) return;
    if (this.lessonDefinition.conversationFirst && this.state && !this.steering) {
      const source =
        this.state.phase === "active" && !this.state.childSpeaking
          ? {
              ...runtimeSource(this.state),
              nodeId: this.state.nodeId,
              transcriptRevision: this.state.transcriptRevision,
            }
          : null;
      const intent = this.requestedNavigation();
      if (source && intent) {
        // Debounce navigation too: an immediately following microphone segment
        // must get a chance to revoke it before any quiet-drain transition.
        this.stabilizationTimer = setTimeout(() => {
          if (
            !this.state ||
            this.status !== "live" ||
            this.steering ||
            this.state.childSpeaking ||
            this.state.phase !== "active" ||
            this.state.visitId !== source.visitId ||
            this.state.transcriptRevision !== source.transcriptRevision
          )
            return;
          this.dispatch({
            type: "conversation.advance.requested",
            intent,
            source,
            transcriptSnapshot: this.transcript,
            atMs: this.now(),
          });
        }, LESSON_TIMING.childSnapshotDebounceMs);
        return;
      }
    }
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
    if (this.state && this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput) {
      this.terminalTranscriptRecovery.observe(this.state, this.status === "live" && !this.steering);
      this.answerRecovery.cancel("terminal_close");
      this.supportClarification.cancel("terminal_close");
      this.tutorStabilization.cancel("terminal_close");
      return;
    }
    if (this.state) {
      const closed =
        this.lessonDefinition.conversationFirst && hasCurrentCompletionEvidence(this.state, this.lessonDefinition);
      if (closed) this.answerRecovery.cancel("conversation_closed");
      else this.answerRecovery.observe(this.state, this.status === "live" && !this.steering);
    }
    if (this.state) this.supportClarification.observe(this.state, this.status === "live" && !this.steering);
    if (this.state) this.tutorStabilization.observe(this.state, this.status === "live" && !this.steering, trigger);
  }

  private async classify(trigger: string) {
    if (
      !this.state ||
      this.status !== "live" ||
      this.steering ||
      (this.supportRequestedAt?.visitId === this.state.visitId &&
        this.supportRequestedAt.revision === this.state.transcriptRevision)
    )
      return;
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
    if (this.state.questionObservations)
      this.dispatch({ type: "question.observation", source, status: "pending", atMs: this.now() });
    let observationSettled = false;
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
          lessonId: this.lessonDefinition.id,
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
      if (proposal && !Object.hasOwn(this.lessonDefinition.nodes, proposal.nodeId))
        throw new Error("Invalid classifier node");
      const diagnostic = parseLiveClassificationDiagnostic(
        "diagnostic" in body ? body.diagnostic : undefined,
        this.lessonDefinition,
        source.nodeId,
        transcript,
      );
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
        this.dispatch({
          type: "proposal.received",
          source,
          proposal,
          transcriptSnapshot: transcript,
          atMs: this.now(),
        });
      }
      observationSettled = proposal !== null;
      // Usable evidence does not rule out a hold: a concept proposal may be
      // partial, or learner speech may have interrupted tutor confirmation.
      if (
        diagnostic?.outputs &&
        this.state &&
        !(this.lessonDefinition.conversationFirst && hasCurrentCompletionEvidence(this.state, this.lessonDefinition)) &&
        diagnostic.nodeId === source.nodeId &&
        diagnostic.transcriptRevision === source.transcriptRevision &&
        (diagnostic.outcome === "hold_scene" ||
          (diagnostic.outcome === "allow_semantic_completion_evidence" &&
            this.state.phase === "active" &&
            !hasCurrentCompletionEvidence(this.state, this.lessonDefinition)) ||
          (diagnostic.decision === "abstained" &&
            [
              "objectiveState_no_winner",
              "tutorState_no_winner",
              "objectiveState_competing_options",
              "tutorState_competing_options",
              "confirmation_without_completion",
              "no_confident_concept_observation",
            ].includes(diagnostic.reason ?? "")))
      ) {
        this.answerRecovery.armSemanticHold(
          this.state,
          this.status === "live" && !this.steering,
          source,
          !!this.lessonDefinition.nodes[source.nodeId].concepts?.length &&
            this.lessonDefinition.nodes[source.nodeId].completionPolicy !== "allow_unresolved" &&
            meetsAuthoredCompletionPolicy(this.state, this.lessonDefinition),
        );
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
      if (!abort.signal.aborted && this.status === "live" && this.state?.questionObservations)
        this.dispatch({
          type: "question.observation",
          source,
          status: observationSettled ? "settled" : "unavailable",
          atMs: this.now(),
        });
      // A failed/held recheck must still recover conversationally. Cancelled or
      // superseded responses may neither advance nor issue a stale recovery prompt.
      if (
        !abort.signal.aborted &&
        this.status === "live" &&
        this.state?.interruptedExchange?.ready &&
        JSON.stringify(classificationSource(this.state)) === JSON.stringify(source) &&
        !hasCurrentCompletionEvidence(this.state, this.lessonDefinition)
      ) {
        this.answerRecovery.armMissingFallback(this.state, !this.steering);
      }
      this.publish();
    }
  }

  private sendAnswerRecovery(source: ClassificationSource) {
    const eventId = `${this.runtimeId}:answer-recovery:${source.visitId}:${source.childTurnId}:${source.transcriptRevision}`;
    const missingAnswerCheck = this.lessonDefinition.id === "mae386" && this.state && !this.state.hasChildTranscript;
    const content = missingAnswerCheck
      ? missingAnswerCheckInstruction(eventId)
      : this.state
        ? answerRecoveryInstruction(this.lessonDefinition, this.state)
        : this.lessonDefinition.recovery.answerRecoveryInstruction;
    try {
      this.transport.send({
        type: "session.instructions.append",
        event_id: eventId,
        delegation_id: null,
        content,
      });
      this.log("gpt_live.answer_recovery_append", { eventId, content }, source);
      if (missingAnswerCheck) this.missingAnswerCheck = { eventId, source };
    } catch {
      this.log("answer_recovery.send_failed", { message: "Scene held; request budget spent." }, source);
    }
    this.publish();
  }

  private supersedeMissingAnswerCheck() {
    const check = this.missingAnswerCheck;
    if (!check || this.status !== "live") return;
    // Spend before sending: failures cannot produce an append storm on deltas.
    this.missingAnswerCheck = undefined;
    const eventId = `${check.eventId}:expired`;
    const content = supersedeAnswerCheckInstruction(check.eventId);
    try {
      this.transport.send({ type: "session.instructions.append", event_id: eventId, delegation_id: null, content });
      this.log(
        "gpt_live.answer_recovery_superseded",
        { eventId, supersededEventId: check.eventId, content },
        check.source,
      );
    } catch {
      this.log("answer_recovery.supersede_failed", { eventId, supersededEventId: check.eventId }, check.source);
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

  private appendSteering(
    context: CurrentNodeSteeringContext,
    renderToken: string,
    startLesson = false,
    request?: "help" | "repeat",
  ) {
    if (!this.state || this.status !== "live") return false;
    const eventId = request
      ? `${this.runtimeId}:support:${crypto.randomUUID()}`
      : `${this.runtimeId}:steer:${this.state.visitId}`;
    const terminal = this.lessonDefinition.nodes[context.nodeId].completeAfterTutorOutput;
    if (terminal) {
      this.terminalText ??= this.state.questionOutcomes
        ? questionRecap(this.state.questionOutcomes).spoken
        : evidenceRecap(this.lessonDefinition, this.state);
      this.terminalTimer = setTimeout(
        () =>
          this.fail(
            "The spoken recap could not be confirmed. Your recap is available on screen; start a new discussion when ready.",
          ),
        60_000,
      );
    }
    const content = request
      ? learnerSupportInstruction(context, request, this.lessonDefinition)
      : teachingInstruction(context, this.lessonDefinition, startLesson, this.terminalText);
    const source = runtimeSource(this.state);
    this.steering = {
      support: request !== undefined,
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

  /** UI support is app context, never fabricated learner transcript or assessment evidence. */
  requestSupport(request: "help" | "repeat") {
    if (
      !this.state ||
      !this.lessonDefinition.questionGroups ||
      this.state.conversationAdvanceRequested ||
      this.status !== "live" ||
      this.state.phase !== "active" ||
      this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput ||
      this.state.childSpeaking ||
      this.state.childCandidate ||
      this.steering ||
      this.state.outputActivity !== "quiet" ||
      this.state.quietSinceMs === null ||
      this.now() - this.state.quietSinceMs < this.state.quietDrainMs
    )
      return;
    this.supportRequestedAt = { visitId: this.state.visitId, revision: this.state.transcriptRevision };
    this.supersedeMissingAnswerCheck();
    this.cancelClassification("learner_support_requested");
    this.answerRecovery.cancel("learner_support_requested");
    this.log("learner.support_requested", { request });
    this.appendSteering(
      currentNodeContext(this.lessonDefinition, this.state.nodeId),
      this.display.token,
      false,
      request,
    );
    this.publish();
  }

  /** Advance along the authored edge without turning a skip into understanding evidence. */
  skipScene(scope: "subpart" | "question" = "subpart") {
    if (
      !this.state ||
      this.status !== "live" ||
      this.state.phase !== "active" ||
      this.lessonDefinition.nodes[this.state.nodeId].completeAfterTutorOutput ||
      this.state.childSpeaking ||
      this.state.childCandidate !== null ||
      this.steering !== undefined
    )
      return;
    // A skip is still an authored render/steering transition. Require the same
    // locally observed sustained quiet used by the normal transition path;
    // unavailable media cannot establish it.
    if (
      this.state.outputActivity !== "quiet" ||
      this.state.quietSinceMs === null ||
      this.now() - this.state.quietSinceMs < this.state.quietDrainMs
    )
      return;
    const source = runtimeSource(this.state);
    const edge = this.lessonDefinition.nodes[this.state.nodeId].onSuccess;
    const drainFinalObservation =
      this.state.questionObservations &&
      this.classification &&
      JSON.stringify(this.classification.source) === JSON.stringify(classificationSource(this.state)) &&
      edge.kind === "node" &&
      this.lessonDefinition.nodes[edge.nodeId].completeAfterTutorOutput;
    if (!drainFinalObservation) this.cancelClassification("scene_skipped");
    this.answerRecovery.cancel("scene_skipped");
    this.dispatch({ type: "scene.skipped", source, scope, atMs: this.now() });
  }

  /** Continue after an accepted reveal has been committed to the application presentation. */
  continueAfterPresentation() {
    const source = this.state ? classificationSource(this.state) : null;
    if (
      !this.state ||
      this.status !== "live" ||
      this.steering !== undefined ||
      !this.state.transitionReady ||
      source === null ||
      this.state.childSpeaking ||
      this.state.childCandidate !== null ||
      this.state.outputActivity !== "quiet" ||
      !this.state.tutorOutputDrained ||
      this.state.quietSinceMs === null ||
      this.now() - this.state.quietSinceMs < this.state.quietDrainMs
    )
      return;
    this.dispatch({ type: "presentation.continued", source, atMs: this.now() });
  }

  private async assessConversation() {
    if (!this.lessonDefinition.conversationFirst || !this.conversationVisits.size) return;
    const visits = [...this.conversationVisits.values()];
    const key = JSON.stringify(visits);
    if (key === this.assessedConversation) return;
    this.assessedConversation = key;
    const generation = ++this.assessmentGeneration;
    this.assessment = { status: "pending", results: {} };
    this.publish();
    try {
      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: this.lessonDefinition.id, visits }),
        signal: AbortSignal.timeout(35_000),
      });
      if (!response.ok) throw new Error("Assessment unavailable");
      const body = await response.json();
      // Revalidate the closed score schema; never trust provider text or let grading advance a scene.
      const answers = Object.fromEntries(
        Object.entries(body?.assessment?.results ?? {}).map(([id, value]) => [
          id,
          { type: "choice", ...(value as { scores?: object }).scores },
        ]),
      );
      const assessment = normalizeAssessment({ answers }, this.lessonDefinition);
      if (!assessment) throw new Error("Invalid assessment");
      if (generation !== this.assessmentGeneration) return;
      this.assessment = assessment;
      this.log("assessment.completed", { assessment, visitCount: visits.length });
    } catch {
      if (generation !== this.assessmentGeneration) return;
      this.assessment = { status: "unavailable", results: {} };
      this.log("assessment.unavailable", { message: "Conversation preserved; assessment unavailable." });
    }
    this.publish();
  }

  stop(reason = "parent_stop", disconnected = false) {
    if (this.status === "ended") return;
    this.missingAnswerCheck = undefined;
    this.cancelClassification(reason);
    this.answerRecovery.cancel(reason);
    this.terminalTranscriptRecovery.cancel(reason);
    clearTimeout(this.clockTimer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.terminalTimer);
    if (this.steering) clearTimeout(this.steering.timer);
    this.steering = undefined;
    if (this.state && this.state.phase !== "complete") {
      this.state = reduceLessonRuntime(
        this.state,
        {
          type: disconnected ? "disconnect" : "stop",
          runtimeId: this.runtimeId,
          atMs: this.now(),
        },
        this.lessonDefinition,
      ).state;
      this.display = {
        token: `${this.runtimeId}:stopped`,
        nodeId: this.state.nodeId,
        sceneId: currentNodeContext(this.lessonDefinition, this.state.nodeId).scene.id,
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
    void this.assessConversation();
    this.publish();
  }

  report() {
    return this.journal.report({
      timing: LESSON_TIMING,
      runtime: this.state,
      status: this.status,
      error: this.error,
      transcript: this.transcript,
      conversation: [...this.conversationVisits.values()],
      assessment: this.assessment,
    });
  }
}
