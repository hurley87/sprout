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

/** Isolated evidence adapter. All progression authority stays in the shared reducer. */
export class CountingProposals {
  state;
  private messages: Message[] = [];
  private learnerItem?: string;
  private response?: {
    id: string;
    turnToken?: string;
    source: Scope;
    done: boolean;
    completed: boolean;
    spoken: boolean;
    calls: number;
    rejected: boolean;
    pending?: { callId: string; args: Arguments; learnerRevision?: number };
    validatedLearnerRevision?: number;
    proposal?: ConversationStateProposal;
    proposalSource?: ClassificationSource;
    transcript?: string;
    tutor?: Message;
    audioItems?: Set<string>;
  };
  private nextContext?: Context;
  private contextAcknowledged = false;
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
    this.state = reduceLessonRuntime(
      this.state,
      { ...event, atMs: performance.now() } as LessonRuntimeEvent,
      COUNTING_LESSON,
    ).state;
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
    this.learnerItem = itemId;
    // Preserve speech order even if its transcription arrives after tutor text.
    // The placeholder cannot ground a proposal until actual final text replaces it.
    if (itemId && !this.messages.some(message => message.id === itemId))
      this.messages.push({ id: itemId, speaker: "Learner", text: "", final: false });
    this.dispatch({ type: "child.turn.started", source: runtimeSource(this.state) });
    if (itemId && this.contextAcknowledged && this.nextContext && this.matches(this.nextContext.source))
      this.context = this.nextContext;
    this.nextContext = undefined;
    this.contextAcknowledged = false;
  }
  speechStopped(itemId?: string) {
    if (this.stopped || !itemId || itemId !== this.learnerItem) return;
    this.dispatch({ type: "child.turn.ended", source: runtimeSource(this.state) });
    this.settlePending();
  }
  transcript(message: Message, responseId?: string) {
    if (this.stopped) return;
    if (message.speaker === "Learner" && message.id !== this.learnerItem) return;
    const old = this.messages.find(m => m.id === message.id);
    if (old && old.speaker !== message.speaker) return;
    if (old?.final && !message.final) return;
    if (old?.text === message.text && old.final === message.final) return;
    if (
      message.speaker === "Tutor" &&
      this.response &&
      (!responseId || responseId === this.response.id) &&
      this.matches(this.response.source)
    )
      this.response.tutor = { ...message };
    if (message.speaker === "Learner") {
      this.observation = undefined;
      this.projectedAcknowledgment = undefined;
      if (message.final && /^(?:please )?(?:move on|stop|quit|finish)(?: please)?[.!]?$/i.test(message.text.trim()))
        this.endRequested = true;
      this.learnerRevision++;
      // A first final transcript may settle an early call. A correction may not
      // retroactively relabel a call that already had finalized evidence.
      if (old?.final) {
        this.rejectPending("learner transcript corrected");
        if (this.response) this.response.rejected = true;
        this.context = undefined;
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
    this.settlePending();
    this.deliver();
  }
  responseCreated(id?: string) {
    if (this.stopped || !id || this.seenResponses.has(id)) return false;
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
    this.response = {
      id,
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
      (this.state.hasChildTurn && (!this.response || !this.messages.find(m => m.id === this.learnerItem)?.final)) ||
      this.state.childSpeaking ||
      this.nextContext ||
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
    return JSON.stringify({ context_token: this.nextContext.token });
  }
  acknowledgeContext() {
    const expected = { ...this.scope(), childTurnId: this.state.childTurnId + 1 };
    if (
      this.nextContext &&
      Object.keys(expected).every(key => expected[key as keyof Scope] === this.nextContext!.source[key as keyof Scope])
    )
      this.contextAcknowledged = true;
    else this.nextContext = undefined;
  }
  drainResults(): Result[] {
    return this.results.splice(0);
  }
  expirePending() {
    this.rejectPending("final learner transcript unavailable");
  }
  private rejectPending(reason: string) {
    const r = this.response;
    if (!r?.pending) return;
    this.results.push({ call_id: r.pending.callId, status: "rejected", reason });
    r.pending = undefined;
    r.rejected = true;
    this.lastResult = `Rejected: ${reason}`;
  }
  call(event: ToolCall): void {
    if (
      this.stopped ||
      typeof event.call_id !== "string" ||
      !event.call_id ||
      event.call_id.length > 256 ||
      this.consumedCalls.has(event.call_id)
    )
      return;
    if (this.consumedCalls.size >= 256) {
      this.context = undefined;
      if (this.response) this.response.rejected = true;
      this.lastResult = "Proposal limit reached; restart the experiment";
      return;
    }
    this.consumedCalls.add(event.call_id);
    const r = this.response;
    const inResponse = !!r && event.response_id === r.id && !r.done && this.matches(r.source);
    const reject = (reason: string) => {
      if (inResponse) {
        r.rejected = true;
        this.rejectPending("additional rejected call");
      }
      this.lastResult = `Rejected: ${reason}`;
      this.results.push({ call_id: event.call_id as string, status: "rejected", reason });
    };
    if (inResponse) r.calls++;
    if (!inResponse) return reject("stale response");
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
    if (
      this.continuationUsed ||
      !this.context ||
      r.turnToken !== this.context.token ||
      !this.matches(this.context.source) ||
      args.context_token !== this.context.token ||
      args.context_token === this.usedToken ||
      r.calls !== 1
    )
      return reject("stale context");
    this.usedToken = args.context_token;
    const learner = this.messages.find(m => m.id === this.learnerItem && m.speaker === "Learner");
    r.pending = { callId: event.call_id, args, learnerRevision: learner?.final ? this.learnerRevision : undefined };
    this.lastResult = "Waiting for finalized learner evidence";
    this.settlePending();
  }
  private settlePending() {
    const r = this.response;
    const pending = r?.pending;
    if (!r || !pending) return;
    const fail = (reason: string) => this.rejectPending(reason);
    if (r.rejected || !this.context || !this.matches(this.context.source) || !this.matches(r.source))
      return fail("stale context");
    const source = classificationSource(this.state);
    const learnerIndex = this.messages.findIndex(m => m.id === this.learnerItem && m.speaker === "Learner");
    const learner = this.messages[learnerIndex];
    if (!source || !learner?.final) return;
    if (pending.learnerRevision !== undefined && pending.learnerRevision !== this.learnerRevision)
      return fail("learner transcript corrected");
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
        new RegExp(
          `\\b(${words[Number(node.quantity)]}|${node.quantity})\\b${node.quantity === 1 ? "|\\b(single|only)\\b|\\ba duck\\b" : ""}`,
          "i",
        ).test(tutorBefore))
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
    r.validatedLearnerRevision = this.learnerRevision;
    r.pending = undefined;
    this.lastResult = `Validated: ${args.answer_outcome} · ${args.support_state}`;
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
      if (
        r.audioItems?.has(tutor.id) &&
        acknowledgment.test(tutor.text.trim()) &&
        key !== this.projectedAcknowledgment
      ) {
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
  }
  confirmRender(identity: RenderIdentity): boolean {
    const before = this.state.phase;
    this.dispatch({ type: "render.confirmed", runtimeId: this.state.runtimeId, identity });
    if (before !== "rendering" || this.state.phase === "rendering") return false;
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
  get missingEligible(): boolean {
    const r = this.response;
    const learner = this.messages.find(m => m.id === this.learnerItem);
    return (
      !this.stopped &&
      this.state.phase === "active" &&
      !this.state.childSpeaking &&
      !!learner?.final &&
      (total.test(normalize(learner.text)) || help.test(learner.text)) &&
      !!r?.done &&
      r.completed &&
      !!r.turnToken &&
      this.matches(r.source) &&
      !r.pending &&
      ((r.calls === 0 && !this.continuationUsed) ||
        (this.learnerAnswerAccepted &&
          r.spoken &&
          (!this.state.acknowledgmentObserved || !this.state.tutorOutputObserved))) &&
      !this.recoveryExhausted
    );
  }
  takeMissingRecovery(): boolean {
    if (!this.missingEligible) return false;
    if (this.missingRetries >= 1 || this.continuationUsed) {
      this.recoveryExhausted = true;
      this.lastResult = "No usable report after one retry. Stop or Start to restart.";
      return false;
    }
    this.missingRetries++;
    this.continuationUsed = true;
    this.continuationRequested = true;
    this.lastResult = "No report; asking once for clarification. No success awarded.";
    return true;
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
