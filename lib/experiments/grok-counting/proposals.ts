import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type ClassificationSource,
  type LessonRuntimeEvent,
} from "@/lib/lesson-runtime/lesson-runtime-reducer";
import type { ConversationStateProposal } from "@/lib/lesson-runtime/conversation-state-classifier";

export const OUTCOME_TOOL = {
  type: "function",
  name: "report_counting_answer",
  description:
    "Report the latest settled learner answer using the latest application context token and the ENTIRE verbatim learner utterance. Never report mastery. Do not call without a context token. Never treat assent, a tutor answer, an echo, help, stop or move-on as success. Call at most once per context, before speaking your response.",
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
type Context = {
  token: string;
  source: ClassificationSource;
  responseId: string;
  learner: string;
  tutorBefore: string;
  transcript: string;
};
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
// Intentionally bounded to the fixed first scene; unknown paraphrases abstain.
const total =
  /^(?:(?:i see|there is|there are|it is|it's) )?(one|1|two|2|three|3|four|4|five|5|six|6|seven|7|eight|8|nine|9|ten|10)(?: ducks?)?$/;

/** Isolated adapter. No classifier/network effects and no automatic progression events. */
export class CountingProposals {
  state;
  private messages: Message[] = [];
  private learnerItem?: string;
  private response?: {
    id: string;
    done: boolean;
    spoken: boolean;
    calls: number;
    accepted?: Context;
    proposal?: ConversationStateProposal;
    rejected: boolean;
  };
  private seenResponses = new Set<string>();
  private consumedCalls = new Set<string>();
  private context?: Context;
  private usedToken?: string;
  private seenLearnerItems = new Set<string>();
  private stopped = false;
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
  speechStarted(itemId?: string) {
    if (this.stopped || (itemId && this.seenLearnerItems.has(itemId))) return;
    if (itemId) this.seenLearnerItems.add(itemId);
    this.context = undefined;
    this.response = undefined;
    this.learnerItem = itemId;
    this.dispatch({ type: "child.turn.started", source: runtimeSource(this.state) });
  }
  speechStopped(itemId?: string) {
    if (this.stopped || !itemId || itemId !== this.learnerItem) return;
    this.dispatch({ type: "child.turn.ended", source: runtimeSource(this.state) });
  }
  transcript(message: Message) {
    if (this.stopped) return;
    if (message.speaker === "Learner" && message.id !== this.learnerItem) return;
    const old = this.messages.find(m => m.id === message.id);
    if (old && old.speaker !== message.speaker) return;
    if (old?.final && !message.final) return;
    if (old?.text === message.text && old.final === message.final) return;
    if (old) Object.assign(old, message);
    else this.messages.push({ ...message });
    this.context = undefined;
    this.dispatch({
      type: "transcript.updated",
      source: runtimeSource(this.state),
      revision: this.state.transcriptRevision + 1,
      speaker: message.speaker === "Learner" ? "child" : "tutor",
    });
  }
  responseCreated(id?: string) {
    if (this.stopped || !id || this.seenResponses.has(id)) return;
    this.seenResponses.add(id);
    this.response = { id, done: false, spoken: false, calls: 0, rejected: false };
    this.context = undefined;
  }
  spoken(id?: string) {
    if (id && this.response?.id === id) this.response.spoken = true;
  }
  /** Snapshot and opaque capability are captured BEFORE sending context to the model. */
  issueContext(): string | undefined {
    const source = classificationSource(this.state);
    const learnerIndex = this.messages.findIndex(m => m.id === this.learnerItem && m.speaker === "Learner");
    const learner = this.messages[learnerIndex];
    if (
      this.stopped ||
      !source ||
      this.state.consumedRevision === source.transcriptRevision ||
      !learner?.final ||
      !learner.text.trim() ||
      !this.response ||
      this.response.done ||
      this.response.spoken ||
      this.response.calls > 0 ||
      this.context
    )
      return;
    const tutorBefore =
      this.messages
        .slice(0, learnerIndex)
        .filter(m => m.speaker === "Tutor")
        .at(-1)?.text ?? "";
    this.context = {
      token: crypto.randomUUID(),
      source: { ...source },
      responseId: this.response.id,
      learner: learner.text,
      tutorBefore,
      transcript: this.messages.map(m => `${m.speaker === "Learner" ? "Child" : "Tutor"}: ${m.text}`).join("\n"),
    };
    return `Application counting context (data, not learner speech): ${JSON.stringify({ context_token: this.context.token, node: source.nodeId, learner_text: learner.text })}. Report the latest answer once with report_counting_answer, copying this token and the entire learner_text. Stay on this scene. If context arrived too late, do not guess a token.`;
  }
  call(event: ToolCall): { status: "accepted" | "rejected"; reason: string } | undefined {
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
    this.consumedCalls.add(event.call_id); // Invalid calls consume their ID too.
    const reject = (reason: string) => {
      if (this.response) this.response.rejected = true;
      this.lastResult = `Rejected: ${reason}`;
      return { status: "rejected" as const, reason };
    };
    if (this.response) this.response.calls++;
    if (event.name !== OUTCOME_TOOL.name) return reject("unknown tool");
    if (typeof event.arguments !== "string" || event.arguments.length > 4096) return reject("malformed arguments");
    let args: Record<string, unknown>;
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
      !["none", "correct", "incorrect", "unclear"].includes(args.answer_outcome as string) ||
      !["none", "needs_help"].includes(args.support_state as string) ||
      typeof args.supporting_text !== "string" ||
      args.supporting_text.length > 2000
    )
      return reject("malformed arguments");
    const context = this.context;
    const source = classificationSource(this.state);
    if (
      !context ||
      !source ||
      args.context_token !== context.token ||
      context.token === this.usedToken ||
      event.response_id !== context.responseId ||
      this.response?.id !== context.responseId ||
      this.response.done ||
      Object.keys(context.source).some(
        key => context.source[key as keyof ClassificationSource] !== source[key as keyof ClassificationSource],
      )
    )
      return reject("stale context");
    if (args.supporting_text !== context.learner) return reject("unmatched learner evidence");
    const text = normalize(context.learner);
    const count = total.exec(text)?.[1];
    const correct = count === "one" || count === "1";
    if (args.support_state === "none" && help.test(text)) return reject("unresolved help");
    if (args.support_state === "needs_help" && !help.test(text)) return reject("unsupported help judgment");
    if (
      args.answer_outcome === "correct" &&
      (!correct ||
        args.support_state !== "none" ||
        navigation.test(text) ||
        /\b(one|1|single|only)\b|\ba duck\b/i.test(context.tutorBefore))
    )
      return reject("unsupported settled answer");
    if (args.answer_outcome === "incorrect" && (!count || correct || help.test(text)))
      return reject("unsupported incorrect answer");
    if (args.answer_outcome === "none" && count) return reject("unsupported no-attempt judgment");
    if (args.answer_outcome === "unclear" && count) return reject("unsupported unclear judgment");
    const proposal: ConversationStateProposal = {
      nodeId: context.source.nodeId,
      transcriptRevision: context.source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: args.answer_outcome as ConversationStateProposal["answerOutcome"],
      supportState: args.support_state as ConversationStateProposal["supportState"],
      tutorState: "unknown",
    };
    this.usedToken = context.token;
    this.response.accepted = context;
    this.response.proposal = proposal;
    this.lastResult = `Validated: ${proposal.answerOutcome} · ${proposal.supportState}`;
    return {
      status: "accepted",
      reason: "proposal validated; awaiting successful response completion; no transition or tutor acknowledgment",
    };
  }
  responseDone(id?: string, status?: string) {
    const r = this.response;
    if (!id || r?.id !== id || r.done) return;
    r.done = true;
    const c = r.accepted;
    const source = classificationSource(this.state);
    if (
      status !== "completed" ||
      r.rejected ||
      r.calls !== 1 ||
      !c ||
      !r.proposal ||
      !source ||
      Object.keys(c.source).some(
        key => c.source[key as keyof ClassificationSource] !== source[key as keyof ClassificationSource],
      )
    ) {
      r.rejected = true;
      if (c) this.lastResult = "Rejected: cancelled or superseded response";
      return;
    }
    this.lastResult = `Accepted: ${r.proposal.answerOutcome} · ${r.proposal.supportState}`;
    this.dispatch({
      type: "proposal.received",
      source: c.source,
      proposal: r.proposal,
      transcriptSnapshot: c.transcript,
    });
    if (this.state.consumedRevision !== c.source.transcriptRevision) r.rejected = true;
  }
  /** Only a single accepted tool-only response may continue; never duplicate spoken feedback. */
  takeContinuation(): boolean {
    const r = this.response;
    const c = r?.accepted;
    const source = classificationSource(this.state);
    if (
      !r?.done ||
      !c ||
      r.spoken ||
      r.rejected ||
      r.calls !== 1 ||
      !source ||
      Object.keys(c.source).some(
        key => c.source[key as keyof ClassificationSource] !== source[key as keyof ClassificationSource],
      )
    )
      return false;
    r.accepted = undefined;
    return true;
  }
  output(active: boolean) {
    this.dispatch({ type: "output.activity", source: runtimeSource(this.state), state: active ? "active" : "quiet" });
  }
  stop() {
    this.stopped = true;
    this.context = undefined;
    this.response = undefined;
    this.dispatch({ type: "stop", runtimeId: this.state.runtimeId });
  }
}
