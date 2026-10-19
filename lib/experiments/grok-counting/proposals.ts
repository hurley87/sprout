import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type ClassificationSource,
  type LessonRuntimeEvent,
  type RenderIdentity,
} from "@/lib/lesson-runtime/lesson-runtime-reducer";
import type { ConversationStateProposal } from "@/lib/lesson-runtime/conversation-state-classifier";

export const OUTCOME_TOOL = {
  type: "function",
  name: "report_counting_answer",
  description:
    "Report the latest settled learner answer using the application token reserved for this learner turn and the ENTIRE verbatim learner utterance. Never report mastery. Do not call without a context token. Never treat assent, a tutor answer, an echo, help, stop or move-on as success. Call at most once per learner turn, and acknowledge a settled correct answer for the current scene, then pause. Use only the token configured before that turn; never reuse it for another turn.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      context_token: { type: "string" },
      answer_outcome: { type: "string", enum: ["none", "correct", "incorrect", "unclear"] },
      support_state: { type: "string", enum: ["none", "needs_help"] },
      supporting_text: { type: "string", maxLength: 2000 },
    },
    required: ["context_token", "answer_outcome", "support_state", "supporting_text"],
  },
};
export type RecoveryReason = "missing-report" | "missing-acknowledgment" | "missing-acknowledgment-audio";
export type ToolCall = { call_id?: unknown; name?: unknown; arguments?: unknown; response_id?: unknown };
type Scope = Omit<ClassificationSource, "transcriptRevision">;
type Context = { token: string; source: Scope };
type Arguments = {
  context_token: string;
  answer_outcome: ConversationStateProposal["answerOutcome"];
  support_state: ConversationStateProposal["supportState"];
  supporting_text: string;
};
type Result = { call_id: string; status: "accepted" | "rejected"; reason: string };
type AdapterEvent = LessonRuntimeEvent extends infer E ? (E extends { atMs: number } ? Omit<E, "atMs"> : never) : never;
type Message = { id: string; speaker: "Learner" | "Tutor"; text: string; final: boolean };
const normalize = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ");
const help = /\b(help|don'?t know|do not know|can'?t|cannot|not sure)\b/i;
const navigation = /\b(stop|quit|move on|next|done|finish|finished)\b/i;
// Deliberately narrow current-scene grammar; unknown paraphrases abstain.
const total =
  /^(?:(?:i see|there is|there are|it is|it's) )?(one|1|two|2|three|3|four|4|five|5|six|6|seven|7|eight|8|nine|9|ten|10)(?: (ducks?|butterfl(?:y|ies)))?$/;

// Recognize bounded answer-giving constructions for this scene, not articles or
// isolated counting-method words ("one at a time", "only look at the duck").
function tutorAnswerCue(text: string, quantity: number, object: unknown): boolean {
  const number = `(?:${["zero", "one", "two", "three"][quantity]}|${quantity}${quantity === 1 ? "|single" : ""})`;
  const noun = object === "duck" ? "ducks?" : "butterfl(?:y|ies)";
  const answer = `${number}(?: ${noun})?`;
  const boundary = `(?=$|[.,!?;:"']| (?:on the screen|in the picture|in total|altogether)\\b)`;
  const statedAnswer = `(?:${number} ${noun}\\b(?! at a time\\b)|${number}${boundary})`;
  const supplied = new RegExp(
    `\\b(?:there (?:is|are)|i (?:see|counted)|you counted|we counted|it is|it's|the (?:answer|total|count) is|say|repeat|answer with) (?:exactly |just |only )?${statedAnswer}`,
    "i",
  );
  const ambiguous = new RegExp(
    `\\b(?:maybe|perhaps|is there|are there|is it|could it be|do you see) (?:exactly |just |only )?${statedAnswer}`,
    "i",
  );
  const standalone = new RegExp(`^(?:(?:yes|correct|that's right)[, ]+)?${answer}${boundary}`, "i");
  const explicitSingle =
    quantity === 1 && new RegExp(`\\b(?:only|just) (?:a |one |1 )${noun}\\b|\\ba single ${noun}\\b`, "i").test(text);
  return (
    supplied.test(text) ||
    ambiguous.test(text) ||
    explicitSingle ||
    text.split(/[.!?;]/).some(clause => standalone.test(clause.trim()))
  );
}

export type CorrelationCode =
  | "context.issued"
  | "context.acknowledged"
  | "context.claimed"
  | "turn.item_id.missing"
  | "turn.stop_id.missing"
  | "turn.stop_id.mismatch"
  | "turn.reservation.missing"
  | "turn.configuration.unacknowledged"
  | "turn.identity.mismatch"
  | "scope.identity.mismatch"
  | "transcript.provisional"
  | "transcript.provisional.replaced"
  | "transcript.settled.replaced"
  | "transcript.final.corrected"
  | "response.id.missing"
  | "response.id.duplicate"
  | "response.bound"
  | "response.before_turn_start"
  | "response.before_turn_end"
  | "response.turn.unbound"
  | "call.id.missing"
  | "call.id.duplicate"
  | "call.response_id.missing"
  | "call.response_id.mismatch"
  | "call.response.missing"
  | "call.after_response_done"
  | "call.token.mismatch"
  | "call.token.reused"
  | "call.response_token.mismatch"
  | "call.continuation.disallowed"
  | "call.multiple.disallowed"
  | "call.context.missing";
export type CorrelationDiagnostic = {
  sequence: number;
  stage: "context" | "speech.started" | "speech.stopped" | "transcript.final" | "response.created" | "tool.call";
  code: CorrelationCode;
  visit: number;
  turn: number;
  revision: number;
};

// Additive to the original 64-entry correlation trace. No caption or wire IDs.
export const DECISION_TIMELINE_LIMIT = 256;
type RejectionReason =
  | "superseded learner turn"
  | "learner transcript corrected"
  | "superseded response"
  | "final learner transcript unavailable"
  | "additional rejected call"
  | "stale response"
  | "unknown tool"
  | "malformed arguments"
  | "stale context"
  | "unmatched learner evidence"
  | "unresolved help"
  | "unsupported help judgment"
  | "unsupported settled answer"
  | "unsupported incorrect answer"
  | "unsupported no-attempt judgment"
  | "unsupported unclear judgment"
  | "reducer rejected proposal"
  | "cancelled response";
export type ContinuationReason = RecoveryReason | "accepted-tool-only" | "rejected-tool-only";
export type DecisionReason =
  | CorrelationCode
  | RejectionReason
  | ContinuationReason
  | "current-turn"
  | "settled"
  | "revised"
  | "provisional"
  | "correct"
  | "incorrect"
  | "none"
  | "unclear"
  | "recognized"
  | "abstained"
  | "awaiting-evidence"
  | "awaiting-learner"
  | "awaiting-report"
  | "awaiting-learner-evidence"
  | "learner-answer-not-correct"
  | "awaiting-response-completion"
  | "invalidated-evidence"
  | "awaiting-tutor"
  | "awaiting-acknowledgment-audio"
  | "playback-active"
  | "quiet-period"
  | "acknowledgment-and-audio"
  | "local-playback"
  | "playback-cleared"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "superseded-response"
  | "scene-transition"
  | "user-stop"
  | "learner-request"
  | "connection-failure"
  | "continuation-never-started"
  | "continuation-incomplete";
export type DecisionEvent =
  | "learner.turn.started"
  | "learner.turn.ended"
  | "learner.transcript"
  | "proposal.received"
  | "proposal.validated"
  | "proposal.rejected"
  | "learner.answer.accepted"
  | "response.started"
  | "response.completed"
  | "response.cancelled"
  | "correlation.checked"
  | "acknowledgment.evaluated"
  | "audio.started"
  | "audio.drained"
  | "audio.cleared"
  | "recovery.requested"
  | "recovery.exhausted"
  | "continuation.requested"
  | "continuation.started"
  | "continuation.completed"
  | "continuation.cancelled"
  | "continuation.timed-out"
  | "transition.eligible"
  | "transition.blocked"
  | "render.requested"
  | "render.confirmed"
  | "lesson.completed"
  | "lesson.stopped"
  | "lesson.failed";
export type PlaybackIdentity = { response: number | null; item: number };
export type DecisionEntry = {
  sequence: number;
  atMs: number;
  type: DecisionEvent;
  reason: DecisionReason;
  node: string;
  visit: number;
  turn: number;
  revision: number;
  response: number | null;
  item: number | null;
  correlation: "bound" | "unbound" | "none";
  state: {
    phase: CountingProposals["state"]["phase"];
    learnerAccepted: boolean;
    answerAccepted: boolean;
    acknowledgmentRecognized: boolean;
    acknowledgmentObserved: boolean;
    audioObserved: boolean;
    audioDrained: boolean;
    output: CountingProposals["state"]["outputActivity"];
    continuationUsed: boolean;
    continuationRequested: boolean;
    proposalOutcome: ConversationStateProposal["answerOutcome"] | null;
    proposalSupport: ConversationStateProposal["supportState"] | null;
  };
};

/** Isolated evidence adapter. All progression authority stays in the shared reducer. */
export class CountingProposals {
  state;
  private messages: Message[] = [];
  private learner?: { itemId?: string; vadStopped: boolean; validated: boolean };
  private response?: {
    id: string;
    sequence: number;
    items: Map<string, number>;
    acknowledgmentEvaluation?: string;
    turnToken?: string;
    bindingFailure?: CorrelationCode;
    source: Scope;
    done: boolean;
    completed: boolean;
    spoken: boolean;
    calls: number;
    rejected: boolean;
    pending?: { callId: string; args: Arguments };
    validatedLearnerRevision?: number;
    proposal?: ConversationStateProposal;
    proposalSource?: ClassificationSource;
    transcript?: string;
    tutor?: Message;
    audioItems?: Set<string>;
    acknowledgmentRecognized?: boolean;
  };
  private nextContext?: Context;
  private contextAcknowledged = false;
  private contextFailure?: CorrelationCode;
  private diagnostics: CorrelationDiagnostic[] = [];
  private diagnosticSequence = 0;
  get correlationDiagnostics(): CorrelationDiagnostic[] {
    return this.diagnostics.map(entry => ({ ...entry }));
  }
  private diagnose(code: CorrelationCode, stage: CorrelationDiagnostic["stage"]) {
    // Closed codes + application counters only. Never retain opaque provider IDs,
    // tokens, arguments, captions, credentials or PCM in this bounded trace.
    this.diagnostics.push({
      sequence: ++this.diagnosticSequence,
      code,
      stage,
      visit: this.state.visitId,
      turn: this.state.childTurnId,
      revision: this.state.transcriptRevision,
    });
    if (this.diagnostics.length > 64) this.diagnostics.shift();
    this.recordDecision("correlation.checked", code);
  }
  private timeline: DecisionEntry[] = [];
  private timelineSequence = 0;
  private timelineOrigin = performance.now();
  private responseSequence = 0;
  private blockedDecision?: string;
  get decisionTimeline(): DecisionEntry[] {
    return this.timeline.map(entry => ({ ...entry, state: { ...entry.state } }));
  }
  /** Closed metadata only; transport uses the same experiment-local diagnostics. */
  recordDecision(type: DecisionEvent, reason: DecisionReason, audio?: PlaybackIdentity) {
    const r = this.response;
    this.timeline.push({
      sequence: ++this.timelineSequence,
      atMs: Math.max(this.timeline.at(-1)?.atMs ?? 0, Math.round(performance.now() - this.timelineOrigin)),
      type,
      reason,
      node: this.state.nodeId,
      visit: this.state.visitId,
      turn: this.state.childTurnId,
      revision: this.state.transcriptRevision,
      response: audio ? audio.response : (r?.sequence ?? null),
      item: audio?.item ?? null,
      correlation: !r
        ? "none"
        : (!audio || audio.response === r.sequence) && r.turnToken && this.matches(r.source)
          ? "bound"
          : "unbound",
      state: {
        phase: this.state.phase,
        learnerAccepted: this.learnerAnswerAccepted,
        answerAccepted: this.state.answerAccepted,
        acknowledgmentRecognized: r?.acknowledgmentRecognized === true,
        acknowledgmentObserved: this.state.acknowledgmentObserved,
        audioObserved: this.state.tutorOutputObserved,
        audioDrained: this.state.tutorOutputDrained,
        output: this.state.outputActivity,
        continuationUsed: this.continuationUsed,
        continuationRequested: this.continuationRequested,
        proposalOutcome: r?.proposal?.answerOutcome ?? null,
        proposalSupport: r?.proposal?.supportState ?? null,
      },
    });
    if (this.timeline.length > DECISION_TIMELINE_LIMIT) this.timeline.shift();
  }
  playbackIdentity(itemId: string): PlaybackIdentity {
    const r = this.response;
    if (!r) return { response: null, item: 0 };
    if (!r.items.has(itemId)) r.items.set(itemId, r.items.size + 1);
    return { response: r.sequence, item: r.items.get(itemId)! };
  }
  get responseBound(): boolean {
    return !!this.response?.turnToken && this.matches(this.response.source);
  }
  private scopeFailure(source: Scope): CorrelationCode {
    return source.childTurnId !== this.state.childTurnId ? "turn.identity.mismatch" : "scope.identity.mismatch";
  }
  get hasReservedContext(): boolean {
    const expected = { ...this.scope(), childTurnId: this.state.childTurnId + 1 };
    return (
      !!this.nextContext &&
      Object.keys(expected).every(key => expected[key as keyof Scope] === this.nextContext!.source[key as keyof Scope])
    );
  }
  private learnerRevision = 0;
  private observation?: { source: Scope; learnerRevision: number; outcome: ConversationStateProposal["answerOutcome"] };
  private continuationUsed = false;
  private continuationRequested = false;
  private results: Result[] = [];
  private seenResponses = new Set<string>();
  private consumedCalls = new Set<string>();
  private context?: Context;
  private usedToken?: string;
  private seenLearnerItems = new Set<string>();
  private stopped = false;
  private projectedAcknowledgment?: string;
  private missingRetries = 0;
  recoveryExhausted = false;
  endRequested = false;
  lastResult = "No proposal";
  constructor(private readonly connectionId = crypto.randomUUID()) {
    this.state = createLessonRuntime(connectionId, { lesson: COUNTING_LESSON });
  }
  private dispatch(event: AdapterEvent) {
    const before = this.state;
    const result = reduceLessonRuntime(
      before,
      { ...event, atMs: performance.now() } as LessonRuntimeEvent,
      COUNTING_LESSON,
    );
    if (before.phase === "active" && result.state.phase === "rendering")
      this.recordDecision("transition.eligible", "acknowledgment-and-audio");
    this.state = result.state;
    if (before.phase !== "rendering" && this.state.phase === "rendering")
      this.recordDecision("render.requested", "acknowledgment-and-audio");
  }

  private scope(): Scope {
    return { ...runtimeSource(this.state), nodeId: this.state.nodeId };
  }
  private matches(source: Scope): boolean {
    const current = this.scope();
    return Object.keys(source).every(key => source[key as keyof Scope] === current[key as keyof Scope]);
  }
  get learnerAnswerAccepted(): boolean {
    return (
      !!this.observation &&
      this.matches(this.observation.source) &&
      this.observation.learnerRevision === this.learnerRevision &&
      this.observation.outcome === "correct" &&
      !this.stopped
    );
  }
  get hasPending(): boolean {
    return !!this.response?.pending;
  }
  speechStarted(itemId?: string) {
    if (this.stopped || (itemId && this.seenLearnerItems.has(itemId))) return;
    if (itemId) this.seenLearnerItems.add(itemId);
    this.rejectPending("superseded learner turn");
    this.context = undefined;
    this.observation = undefined;
    this.projectedAcknowledgment = undefined;
    this.response = undefined;
    this.continuationRequested = false;
    this.continuationUsed = false;
    this.recoveryExhausted = false;
    this.learner = { itemId, vadStopped: false, validated: false };
    // Preserve speech order even if its transcription arrives after tutor text.
    // The placeholder cannot ground a proposal until actual final text replaces it.
    if (itemId && !this.messages.some(message => message.id === itemId))
      this.messages.push({ id: itemId, speaker: "Learner", text: "", final: false });
    this.dispatch({ type: "child.turn.started", source: runtimeSource(this.state) });
    this.recordDecision("learner.turn.started", "current-turn");
    if (!itemId) this.contextFailure = "turn.item_id.missing";
    else if (!this.nextContext) this.contextFailure = "turn.reservation.missing";
    else if (!this.contextAcknowledged) this.contextFailure = "turn.configuration.unacknowledged";
    else if (!this.matches(this.nextContext.source)) this.contextFailure = this.scopeFailure(this.nextContext.source);
    else {
      this.context = this.nextContext;
      this.contextFailure = undefined;
    }
    this.diagnose(this.contextFailure ?? "context.claimed", "speech.started");
    this.nextContext = undefined;
    this.contextAcknowledged = false;
  }
  speechStopped(itemId?: string) {
    if (this.stopped) return;
    if (!itemId || itemId !== this.learner?.itemId) {
      this.diagnose(!itemId ? "turn.stop_id.missing" : "turn.stop_id.mismatch", "speech.stopped");
      return;
    }
    if (!this.learner || this.learner.vadStopped) return;
    this.learner.vadStopped = true;
    this.dispatch({ type: "child.turn.ended", source: runtimeSource(this.state) });
    this.recordDecision("learner.turn.ended", "current-turn");
    if (this.messages.find(m => m.id === itemId)?.final) this.recordDecision("learner.transcript", "settled");
    this.settlePending();
  }
  transcript(message: Message, responseId?: string) {
    if (this.stopped) return;
    if (message.speaker === "Learner" && message.id !== this.learner?.itemId) return;
    const old = this.messages.find(m => m.id === message.id);
    const wasFinal = old?.final === true;
    if (old && old.speaker !== message.speaker) return;
    if (old?.final && !message.final) return;
    if (old?.text === message.text && old.final === message.final) return;
    if (
      message.speaker === "Tutor" &&
      this.response &&
      (!responseId || responseId === this.response.id) &&
      this.matches(this.response.source)
    ) {
      this.response.tutor = { ...message };
      this.response.acknowledgmentRecognized = undefined;
    }
    if (message.speaker === "Learner") {
      this.observation = undefined;
      this.projectedAcknowledgment = undefined;
      if (message.final && /^(?:please )?(?:move on|stop|quit|finish)(?: please)?[.!]?$/i.test(message.text.trim()))
        this.endRequested = true;
      this.learnerRevision++;
      // A provider "completed" before VAD stop is provisional. Until a proposal
      // actually validates, same-item replacements retain the original turn token
      // and are checked afresh against the tool's entire supporting text. VAD stop
      // makes the latest completed text eligible; it cannot bind an early response.
      // Once validated (even before response.done), a correction must revoke it,
      // including when a continuation has since replaced this.response.
      if (old?.final && this.learner?.validated) {
        this.contextFailure = "transcript.final.corrected";
        this.diagnose(this.contextFailure, "transcript.final");
        this.rejectPending("learner transcript corrected");
        if (this.response) this.response.rejected = true;
        this.context = undefined;
      } else if (message.final) {
        if (!this.learner?.vadStopped)
          this.diagnose(old?.final ? "transcript.provisional.replaced" : "transcript.provisional", "transcript.final");
        else if (old?.final) this.diagnose("transcript.settled.replaced", "transcript.final");
      }
    }
    if (old) Object.assign(old, message);
    else this.messages.push({ ...message });
    this.dispatch({
      type: "transcript.updated",
      source: runtimeSource(this.state),
      revision: this.state.transcriptRevision + 1,
      speaker: message.speaker === "Learner" ? "child" : "tutor",
    });
    if (message.speaker === "Learner" && message.final)
      this.recordDecision(
        "learner.transcript",
        !this.learner?.vadStopped ? "provisional" : wasFinal ? "revised" : "settled",
      );
    this.settlePending();
    this.deliver();
  }
  responseCreated(id?: string) {
    if (this.stopped) return false;
    if (!id || this.seenResponses.has(id)) {
      this.diagnose(!id ? "response.id.missing" : "response.id.duplicate", "response.created");
      return false;
    }
    this.rejectPending("superseded response");
    this.seenResponses.add(id);
    if (this.state.acknowledgmentObserved) {
      this.projectedAcknowledgment = undefined;
      this.dispatch({
        type: "transcript.updated",
        source: runtimeSource(this.state),
        revision: this.state.transcriptRevision + 1,
        speaker: "tutor",
      });
    }
    const bindingFailure = !this.state.hasChildTurn
      ? "response.before_turn_start"
      : this.state.childSpeaking
        ? "response.before_turn_end"
        : !this.context
          ? (this.contextFailure ?? "response.turn.unbound")
          : !this.matches(this.context.source)
            ? this.scopeFailure(this.context.source)
            : undefined;
    this.response = {
      id,
      sequence: ++this.responseSequence,
      items: new Map(),
      bindingFailure,
      turnToken:
        !this.state.childSpeaking && this.context && this.matches(this.context.source) ? this.context.token : undefined,
      source: this.scope(),
      done: false,
      completed: false,
      spoken: false,
      calls: 0,
      rejected: false,
    };
    this.continuationRequested = false;
    this.diagnose(bindingFailure ?? "response.bound", "response.created");
    this.recordDecision("response.started", bindingFailure ?? "current-turn");
    return true;
  }
  spoken(id?: string) {
    if (id && this.response?.id === id) this.response.spoken = true;
  }
  /** Reserve the NEXT learner turn before audio is admitted, never during a response. */
  issueContext(): string | undefined {
    if (
      this.stopped ||
      this.recoveryExhausted ||
      this.state.phase !== "active" ||
      this.learnerAnswerAccepted ||
      (this.state.hasChildTurn && (!this.response || !this.messages.find(m => m.id === this.learner?.itemId)?.final)) ||
      this.state.childSpeaking ||
      this.hasReservedContext ||
      this.hasPending ||
      this.continuationRequested ||
      (this.response && !this.response.done)
    )
      return;
    this.nextContext = {
      token: crypto.randomUUID(),
      source: { ...this.scope(), childTurnId: this.state.childTurnId + 1 },
    };
    this.contextAcknowledged = false;
    this.diagnose("context.issued", "context");
    return JSON.stringify({ context_token: this.nextContext.token });
  }
  acknowledgeContext() {
    const expected = { ...this.scope(), childTurnId: this.state.childTurnId + 1 };
    if (
      this.nextContext &&
      Object.keys(expected).every(key => expected[key as keyof Scope] === this.nextContext!.source[key as keyof Scope])
    ) {
      if (!this.contextAcknowledged) this.diagnose("context.acknowledged", "context");
      this.contextAcknowledged = true;
    } else this.nextContext = undefined;
  }
  drainResults(): Result[] {
    return this.results.splice(0);
  }
  expirePending() {
    this.rejectPending("final learner transcript unavailable");
  }
  private rejectPending(reason: RejectionReason) {
    const r = this.response;
    if (!r?.pending) return;
    this.results.push({ call_id: r.pending.callId, status: "rejected", reason });
    r.pending = undefined;
    r.rejected = true;
    this.lastResult = `Rejected: ${reason}`;
    this.recordDecision("proposal.rejected", reason);
  }
  call(event: ToolCall): void {
    if (this.stopped) return;
    this.recordDecision("proposal.received", "awaiting-evidence");
    if (typeof event.call_id !== "string" || !event.call_id || event.call_id.length > 256) {
      this.diagnose("call.id.missing", "tool.call");
      return;
    }
    if (this.consumedCalls.has(event.call_id)) {
      this.diagnose("call.id.duplicate", "tool.call");
      return;
    }
    if (this.consumedCalls.size >= 256) {
      this.context = undefined;
      if (this.response) this.response.rejected = true;
      this.lastResult = "Proposal limit reached; restart the experiment";
      return;
    }
    this.consumedCalls.add(event.call_id);
    const r = this.response;
    const inResponse = !!r && event.response_id === r.id && !r.done && this.matches(r.source);
    const reject = (reason: RejectionReason, diagnostic?: CorrelationCode) => {
      if (diagnostic) this.diagnose(diagnostic, "tool.call");
      if (inResponse) {
        r.rejected = true;
        this.rejectPending("additional rejected call");
      }
      this.lastResult = `Rejected: ${reason}`;
      this.recordDecision("proposal.rejected", diagnostic ?? reason);
      this.results.push({ call_id: event.call_id as string, status: "rejected", reason });
    };
    if (inResponse) r.calls++;
    if (!inResponse)
      return reject(
        "stale response",
        typeof event.response_id !== "string" || !event.response_id
          ? "call.response_id.missing"
          : !r
            ? "call.response.missing"
            : event.response_id !== r.id
              ? "call.response_id.mismatch"
              : r.done
                ? "call.after_response_done"
                : this.scopeFailure(r.source),
      );
    if (event.name !== OUTCOME_TOOL.name) return reject("unknown tool");
    if (typeof event.arguments !== "string" || event.arguments.length > 4096) return reject("malformed arguments");
    let args: Arguments;
    try {
      args = JSON.parse(event.arguments);
    } catch {
      return reject("malformed arguments");
    }
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).sort().join(",") !== "answer_outcome,context_token,support_state,supporting_text" ||
      !["none", "correct", "incorrect", "unclear"].includes(args.answer_outcome) ||
      !["none", "needs_help"].includes(args.support_state) ||
      typeof args.supporting_text !== "string" ||
      args.supporting_text.length > 2000
    )
      return reject("malformed arguments");
    const failure: CorrelationCode | undefined = this.continuationUsed
      ? "call.continuation.disallowed"
      : !this.context
        ? (this.contextFailure ?? "call.context.missing")
        : !this.matches(this.context.source)
          ? this.scopeFailure(this.context.source)
          : !r.turnToken
            ? (r.bindingFailure ?? "response.turn.unbound")
            : r.turnToken !== this.context.token
              ? "call.response_token.mismatch"
              : args.context_token !== this.context.token
                ? "call.token.mismatch"
                : args.context_token === this.usedToken
                  ? "call.token.reused"
                  : r.calls !== 1
                    ? "call.multiple.disallowed"
                    : undefined;
    if (failure) return reject("stale context", failure);
    this.usedToken = args.context_token;
    r.pending = { callId: event.call_id, args };
    this.lastResult = "Waiting for finalized learner evidence";
    this.settlePending();
  }
  private settlePending() {
    const r = this.response;
    const pending = r?.pending;
    if (!r || !pending) return;
    const fail = (reason: RejectionReason) => this.rejectPending(reason);
    if (r.rejected || !this.context || !this.matches(this.context.source) || !this.matches(r.source))
      return fail("stale context");
    const source = classificationSource(this.state);
    const learnerIndex = this.messages.findIndex(m => m.id === this.learner?.itemId && m.speaker === "Learner");
    const learner = this.messages[learnerIndex];
    if (!source || !this.learner?.vadStopped || !learner?.final) return;
    const args = pending.args;
    if (args.supporting_text !== learner.text || !learner.text.trim()) return fail("unmatched learner evidence");
    const tutorBefore =
      this.messages
        .slice(0, learnerIndex)
        .filter(m => m.speaker === "Tutor")
        .at(-1)?.text ?? "";
    const text = normalize(learner.text);
    const match = total.exec(text);
    const count = match?.[1];
    const node = COUNTING_LESSON.nodes[this.state.nodeId].presentation;
    const words = ["zero", "one", "two", "three"];
    const objectMatches =
      !match?.[2] || (node.object === "duck" ? /^ducks?$/.test(match[2]) : /^butterfl(y|ies)$/.test(match[2]));
    const correct = objectMatches && (count === words[Number(node.quantity)] || count === String(node.quantity));
    if (args.support_state === "none" && help.test(text)) return fail("unresolved help");
    if (args.support_state === "needs_help" && !help.test(text)) return fail("unsupported help judgment");
    if (
      args.answer_outcome === "correct" &&
      (!correct ||
        args.support_state !== "none" ||
        navigation.test(text) ||
        tutorAnswerCue(tutorBefore, Number(node.quantity), node.object))
    )
      return fail("unsupported settled answer");
    if (args.answer_outcome === "incorrect" && (!count || correct || help.test(text)))
      return fail("unsupported incorrect answer");
    if (args.answer_outcome === "none" && count) return fail("unsupported no-attempt judgment");
    if (args.answer_outcome === "unclear" && count) return fail("unsupported unclear judgment");
    r.proposal = {
      nodeId: source.nodeId,
      transcriptRevision: source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: args.answer_outcome,
      supportState: args.support_state,
      tutorState: "unknown",
    };
    r.proposalSource = source;
    r.transcript = this.messages.map(m => `${m.speaker === "Learner" ? "Child" : "Tutor"}: ${m.text}`).join("\n");
    const validation = reduceLessonRuntime(
      this.state,
      {
        type: "proposal.received",
        source,
        proposal: r.proposal,
        transcriptSnapshot: r.transcript,
        atMs: performance.now(),
      },
      COUNTING_LESSON,
    );
    if (validation.state.consumedRevision !== source.transcriptRevision) return fail("reducer rejected proposal");
    this.missingRetries = 0;
    this.learner.validated = true;
    r.validatedLearnerRevision = this.learnerRevision;
    r.pending = undefined;
    this.lastResult = `Validated: ${args.answer_outcome} · ${args.support_state}`;
    this.recordDecision("proposal.validated", args.answer_outcome);
    this.results.push({
      call_id: pending.callId,
      status: "accepted",
      reason:
        "proposal grounded; application still requires current tutor acknowledgment, playback drain and render confirmation",
    });
    this.deliver();
  }
  private deliver() {
    const r = this.response;
    if (!r?.done || !r.completed || r.rejected || r.calls !== 1 || !r.proposal || !r.proposalSource || this.observation)
      return;
    const source = classificationSource(this.state);
    if (!source || !this.matches(r.source) || r.validatedLearnerRevision !== this.learnerRevision) return;
    // Tutor revisions may supersede conversation state before delivery. The
    // grounded learner observation remains diagnostic, never transition authority.
    if (source.transcriptRevision === r.proposalSource.transcriptRevision) {
      this.dispatch({
        type: "proposal.received",
        source: r.proposalSource,
        proposal: r.proposal,
        transcriptSnapshot: r.transcript,
      });
      if (this.state.consumedRevision !== source.transcriptRevision) return;
    }
    this.observation = { source: r.source, learnerRevision: this.learnerRevision, outcome: r.proposal.answerOutcome };
    this.lastResult = `Accepted: ${r.proposal.answerOutcome} · ${r.proposal.supportState}`;
    if (this.learnerAnswerAccepted) this.recordDecision("learner.answer.accepted", "correct");
  }
  responseDone(id?: string, status?: string) {
    const r = this.response;
    if (!id || r?.id !== id || r.done) return;
    r.done = true;
    r.completed = status === "completed";
    if (!r.completed) {
      this.observation = undefined;
      this.rejectPending("cancelled response");
      r.rejected = true;
    }
    this.deliver();
    this.recordDecision(
      r.completed ? "response.completed" : "response.cancelled",
      r.completed ? "completed" : "cancelled",
    );
    return true;
  }
  /** One continuation total per learner turn, including any rejected-tool recovery. */
  takeContinuation(): "accepted" | "recovery" | undefined {
    const r = this.response;
    if (
      this.stopped ||
      !r?.done ||
      !r.completed ||
      r.spoken ||
      r.calls === 0 ||
      r.pending ||
      !this.matches(r.source) ||
      this.state.childSpeaking ||
      this.continuationUsed
    )
      return;
    this.continuationUsed = true;
    this.continuationRequested = true;
    return r.rejected || !r.proposal ? "recovery" : "accepted";
  }
  /** Revalidate the exact ordered exchange, never infer acknowledgment from a tool. */
  tick() {
    if (this.stopped || this.state.phase !== "active") return;
    const r = this.response;
    const tutor = r?.tutor;
    if (this.learnerAnswerAccepted && r && (!r.done || !tutor?.final)) this.recordAcknowledgment("awaiting-evidence");
    if (this.learnerAnswerAccepted && r?.done && r.completed && !r.rejected && this.matches(r.source) && tutor?.final) {
      const node = COUNTING_LESSON.nodes[this.state.nodeId].presentation;
      const number = ["zero", "one", "two", "three"][Number(node.quantity)];
      const object = node.object === "duck" ? "ducks?" : "butterfl(?:y|ies)";
      // Full utterance recognition is intentionally conservative. Generic praise,
      // questions, hints and a count supplied before the learner do not qualify.
      const acknowledgment = new RegExp(
        `^(?:(?:yes|correct|that's right|that is right|well done|great)[,! .]+)?(?:there (?:is|are) |you (?:saw|counted) )?(?:${number}|${node.quantity}) ${object}[.!]*$`,
        "i",
      );
      const key = JSON.stringify([this.learnerRevision, tutor.id, tutor.text]);
      r.acknowledgmentRecognized = acknowledgment.test(tutor.text.trim());
      this.recordAcknowledgment(r.acknowledgmentRecognized ? "recognized" : "abstained");
      if (r.audioItems?.has(tutor.id) && r.acknowledgmentRecognized && key !== this.projectedAcknowledgment) {
        this.projectedAcknowledgment = key;
        if (!this.state.tutorOutputObserved) {
          // Retain the response-correlated real playback onset when its learner
          // final arrived late. Conservatively begin fresh quiet after projection.
          const wasQuiet = this.state.outputActivity === "quiet";
          // Replay the real post-interruption quiet -> onset boundary when the
          // reducer saw it before finalized learner text made it eligible.
          if (!wasQuiet) this.dispatch({ type: "output.activity", source: runtimeSource(this.state), state: "quiet" });
          this.dispatch({ type: "output.activity", source: runtimeSource(this.state), state: "active" });
          if (wasQuiet) this.dispatch({ type: "output.activity", source: runtimeSource(this.state), state: "quiet" });
        }
        // Provider finals can arrive out of order. Re-project the actual final
        // tutor message after finalized learner evidence into the reducer's
        // ordered snapshot; this is a new validation, not retagging an old call.
        this.dispatch({
          type: "transcript.updated",
          source: runtimeSource(this.state),
          revision: this.state.transcriptRevision + 1,
          speaker: "tutor",
        });
        const source = classificationSource(this.state);
        if (source)
          this.dispatch({
            type: "proposal.received",
            source,
            proposal: {
              nodeId: source.nodeId,
              transcriptRevision: source.transcriptRevision,
              childActivity: "unknown",
              answerOutcome: "correct",
              supportState: "none",
              tutorState: "acknowledging",
            },
            transcriptSnapshot: this.messages
              .map(m => `${m.speaker === "Learner" ? "Child" : "Tutor"}: ${m.text}`)
              .join("\n"),
          });
      }
    }
    this.dispatch({ type: "clock.tick", source: runtimeSource(this.state) });
    if (this.state.phase === "active") {
      const reason: DecisionReason =
        this.state.childSpeaking || !this.state.hasChildTurn
          ? "awaiting-learner"
          : !this.learnerAnswerAccepted
            ? r?.pending || !this.messages.find(m => m.id === this.learner?.itemId)?.final
              ? "awaiting-learner-evidence"
              : r?.proposal
                ? r.rejected
                  ? "invalidated-evidence"
                  : r.proposal.answerOutcome === "correct"
                    ? "awaiting-response-completion"
                    : "learner-answer-not-correct"
                : "awaiting-report"
            : !r?.acknowledgmentRecognized
              ? "awaiting-tutor"
              : !this.state.acknowledgmentObserved
                ? "awaiting-acknowledgment-audio"
                : this.state.outputActivity !== "quiet"
                  ? "playback-active"
                  : "quiet-period";
      const key = JSON.stringify([this.state.visitId, this.state.childTurnId, reason]);
      if (key !== this.blockedDecision) {
        this.blockedDecision = key;
        this.recordDecision("transition.blocked", reason);
      }
    }
  }
  private recordAcknowledgment(reason: "recognized" | "abstained" | "awaiting-evidence") {
    const r = this.response;
    if (r && r.acknowledgmentEvaluation !== reason) {
      r.acknowledgmentEvaluation = reason;
      this.recordDecision("acknowledgment.evaluated", reason, r.tutor ? this.playbackIdentity(r.tutor.id) : undefined);
    }
  }
  confirmRender(identity: RenderIdentity): boolean {
    const before = this.state.phase;
    this.dispatch({ type: "render.confirmed", runtimeId: this.state.runtimeId, identity });
    if (before !== "rendering" || this.state.phase === "rendering") return false;
    this.recordDecision("render.confirmed", "acknowledgment-and-audio");
    if (this.state.phase === "complete") this.recordDecision("lesson.completed", "completed");
    this.nextContext = undefined;
    this.context = undefined;
    this.response = undefined;
    this.observation = undefined;
    this.projectedAcknowledgment = undefined;
    this.continuationUsed = false;
    this.continuationRequested = false;
    this.missingRetries = 0;
    return true;
  }
  /** Only settled, current responses can request recovery; playback is drained by transport. */
  get recoveryReason(): RecoveryReason | undefined {
    const r = this.response;
    const learner = this.messages.find(m => m.id === this.learner?.itemId);
    if (
      this.stopped ||
      this.recoveryExhausted ||
      this.continuationRequested ||
      this.state.phase !== "active" ||
      this.state.childSpeaking ||
      !learner?.final ||
      !r?.done ||
      !r.completed ||
      !r.turnToken ||
      !this.matches(r.source) ||
      r.pending
    )
      return;
    if (this.learnerAnswerAccepted) {
      // Tool-only output gets its usual continuation before timed recovery.
      if (!r.spoken && !this.continuationUsed) return;
      if (!r.acknowledgmentRecognized) return "missing-acknowledgment";
      if (!r.tutor || !r.audioItems?.has(r.tutor.id) || !this.state.tutorOutputObserved)
        return "missing-acknowledgment-audio";
      return;
    }
    if (r.calls === 0 && !this.continuationUsed && (total.test(normalize(learner.text)) || help.test(learner.text)))
      return "missing-report";
  }
  takeRecovery(): RecoveryReason | undefined {
    const reason = this.recoveryReason;
    if (!reason) return;
    if (this.continuationUsed || (reason === "missing-report" && this.missingRetries >= 1)) {
      this.recoveryExhausted = true;
      this.recordDecision("recovery.exhausted", reason);
      // Preserve lastResult and the validated observation for acknowledgment failures.
      if (reason === "missing-report") this.lastResult = "No usable counting report after one retry.";
      return;
    }
    if (reason === "missing-report") {
      this.missingRetries++;
      this.lastResult = "No report; asking once for clarification. No success awarded.";
    }
    this.continuationUsed = true;
    this.continuationRequested = true;
    this.recordDecision("recovery.requested", reason);
    return reason;
  }
  output(active: boolean, itemId?: string) {
    if (
      active &&
      itemId &&
      this.response?.turnToken &&
      this.matches(this.response.source) &&
      !this.state.childSpeaking
    ) {
      this.response.audioItems ??= new Set();
      this.response.audioItems.add(itemId);
    }
    this.dispatch({ type: "output.activity", source: runtimeSource(this.state), state: active ? "active" : "quiet" });
  }
  stop() {
    this.stopped = true;
    this.context = undefined;
    this.nextContext = undefined;
    this.observation = undefined;
    this.results = [];
    this.response = undefined;
    this.dispatch({ type: "stop", runtimeId: this.state.runtimeId });
  }
}
