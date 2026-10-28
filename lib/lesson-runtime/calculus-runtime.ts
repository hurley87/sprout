import { MathController } from "../calculus/math-controller";
import type { MathSourceEvent } from "../calculus/math-evidence";
import { INTERPRETATION_LIMITS } from "../calculus/math-interpretation-contract";
import { isCalculusProblemId } from "../calculus/problems";
import {
  isSpokenAffirmation,
  isSpokenAffirmationPrefix,
  isSpokenMathConfirmationPrefix,
  parseSpokenMathConfirmation,
} from "../calculus/spoken-confirmation";
import { calculusFeedbackInstruction } from "../calculus/tutor-context";
import type { TranscriptEvent } from "../events";
import { isLearnerStopText, parseLearnerNavigationText } from "./conversation-progression";
import type { LessonRuntimeState, RuntimeSource } from "./lesson-runtime-reducer";

const SETTLE_MS = 1500;

export type CalculusFragment = { event: TranscriptEvent; source: RuntimeSource; order: number };
type Operation = "differentiate" | "rewrite" | "unassessed";
type Context = {
  state: LessonRuntimeState | null;
  fragments: readonly CalculusFragment[];
  revision: number;
  order: number;
  live: boolean;
  quiet: boolean;
  steering: boolean;
  supportRequestedAt?: { visitId: number; revision: number };
};

export class CalculusRuntime {
  readonly controller: MathController;
  private reservation?: {
    id: string;
    boardRevision: number;
    visitId: number;
    turnId: number;
    startedAt: number;
    fragmentFloor: number;
  };
  private deferredTurns: Parameters<MathController["learnerRevision"]>[1] = [];
  private consumedFragments = new Set<number>();
  private timer?: ReturnType<typeof setTimeout>;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private settleSpeechEndMs: number | null = null;

  constructor(
    private readonly runtimeId: string,
    private readonly context: () => Context,
    private readonly now: () => number,
    private readonly publish: () => void,
    private readonly log: (type: string, detail: unknown) => void,
    private readonly send: (eventId: string, content: string) => void,
    private readonly nextOrder: () => number,
    private readonly stop: () => void,
    private readonly support: (request: "help" | "repeat") => void,
    private readonly schedule: () => void,
    private readonly debounceMs: number,
  ) {
    this.controller = new MathController(runtimeId, publish, log);
  }

  private groups() {
    const groups: {
      speaker: TranscriptEvent["speaker"];
      turnId: number;
      order: number;
      lastOrder: number;
      text: string;
      consumed: boolean;
    }[] = [];
    for (const fragment of this.context().fragments) {
      const consumed = this.consumedFragments.has(fragment.order);
      const previous = groups.at(-1);
      if (
        !consumed &&
        previous &&
        !previous.consumed &&
        previous.speaker === fragment.event.speaker &&
        (fragment.event.speaker !== "child" || previous.turnId === fragment.source.childTurnId)
      ) {
        previous.text += fragment.event.delta;
        previous.lastOrder = Math.max(previous.lastOrder, fragment.order);
      } else
        groups.push({
          speaker: fragment.event.speaker,
          turnId: fragment.source.childTurnId,
          order: fragment.order,
          lastOrder: fragment.order,
          text: fragment.event.delta,
          consumed,
        });
    }
    return groups;
  }

  learnerText() {
    const { state } = this.context();
    return this.groups()
      .filter(group => group.speaker === "child" && group.turnId === state?.childTurnId)
      .map(group => group.text)
      .join("");
  }

  /** `confirmed` is false for raw microphone activity, which is often noise or tutor
   * echo and is usually discarded within ~200ms. Only confirmed speech may cancel
   * in-flight interpretation; a displayed proposal is reserved from the first onset. */
  onSpeechStarted(confirmed = true) {
    if (this.settleTimer) this.decideReservation(true, this.settleSpeechEndMs, true);
    const { state, steering, order } = this.context();
    if (!state || this.reservation) return;
    const pending = this.controller.pendingProposal;
    const reserve = pending?.displayed && !steering && state.phase === "active";
    if (!reserve && !confirmed) return;
    clearTimeout(this.timer);
    if (state.childSpeaking && reserve) return;
    if (reserve && pending)
      this.reservation = {
        id: pending.id,
        boardRevision: pending.boardRevision,
        visitId: state.visitId,
        turnId: state.childTurnId + 1,
        startedAt: this.now(),
        fragmentFloor: order,
      };
    else this.controller.invalidate();
  }

  onTranscript() {
    const { revision } = this.context();
    this.deferredTurns = this.groups()
      .filter(group => group.speaker === "child" && !group.consumed)
      .map(group => ({
        id: `turn_${group.turnId}_${group.order}`,
        speaker: "learner" as const,
        text: group.text,
        order: group.lastOrder,
      }));
    const text = this.learnerText();
    if (
      this.reservation &&
      !isSpokenMathConfirmationPrefix(text, this.controller.pendingProposal?.batch.actions.length ?? 0) &&
      !isSpokenAffirmationPrefix(text)
    )
      this.reservation = undefined;
    if (!this.reservation) {
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
      this.controller.learnerRevision(revision, this.deferredTurns);
    } else if (
      this.settleTimer &&
      parseSpokenMathConfirmation(text, this.controller.pendingProposal?.batch.actions.length ?? 0)
    )
      this.decideReservation(true, this.settleSpeechEndMs, true);
  }

  onSpeechStopped(ended: boolean, localSpeechEndMs: number | null) {
    this.decideReservation(ended, localSpeechEndMs, false);
  }

  /** Transcription can trail the end-of-speech signal by a few hundred ms, so an
   * ended turn whose words so far could still become a command waits briefly. */
  private decideReservation(ended: boolean, localSpeechEndMs: number | null, settled: boolean) {
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    const reserved = this.reservation;
    const { state, fragments: allFragments, revision } = this.context();
    if (!reserved || !state) return;
    const pending = this.controller.pendingProposal;
    const fragments = allFragments.filter(
      item =>
        item.event.speaker === "child" &&
        item.source.childTurnId === state.childTurnId &&
        item.order > reserved.fragmentFloor,
    );
    const text = fragments.map(item => item.event.delta).join("");
    const count = pending?.batch.actions.length ?? 0;
    const operations = pending ? parseSpokenMathConfirmation(text, count) : null;
    const incomplete =
      pending?.id === reserved.id &&
      !operations &&
      !isSpokenAffirmation(text) &&
      (isSpokenMathConfirmationPrefix(text, count) || isSpokenAffirmationPrefix(text));
    if (ended && incomplete && !settled) {
      this.settleSpeechEndMs = localSpeechEndMs;
      this.settleTimer = setTimeout(() => this.decideReservation(true, localSpeechEndMs, true), SETTLE_MS);
      return;
    }
    this.reservation = undefined;
    const sameTurn =
      ended &&
      this.now() - reserved.startedAt <= 8000 &&
      state.visitId === reserved.visitId &&
      state.childTurnId === reserved.turnId &&
      fragments.length > 0;
    if (incomplete) {
      // No learner words, or only the start of a command (noise, tutor echo, a dropped
      // word): nothing new to interpret, so keep the displayed proposal.
      this.log("math.reservation_released", { ...reserved, text, revision });
      this.publish();
    } else if (sameTurn && pending?.id === reserved.id && !operations && isSpokenAffirmation(text)) {
      // A generic yes answers the tutor but never accepts. Keep the displayed proposal
      // and its extraction identity so the learner can still say a confirm command.
      this.log("math.spoken_affirmation_retained", { ...reserved, text, revision });
      for (const fragment of fragments) this.consumedFragments.add(fragment.order);
      this.publish();
    } else if (
      sameTurn &&
      operations &&
      this.confirmProposal(reserved.id, reserved.boardRevision, operations, "spoken")
    ) {
      this.log("math.spoken_confirmation", {
        ...reserved,
        text,
        revision,
        operations,
        fragments: structuredClone(fragments),
        localSpeechEndMs,
      });
      this.controller.consumeConfirmation(revision, this.deferredTurns);
    } else {
      const currentRevision = this.controller.snapshot().current?.identity.transcriptRevision;
      if (currentRevision !== undefined && revision > currentRevision)
        this.controller.learnerRevision(revision, this.deferredTurns);
      else this.controller.invalidate();
      this.publish();
    }
  }

  onQuiet(): boolean {
    clearTimeout(this.timer);
    const { state, quiet, supportRequestedAt } = this.context();
    if (!state || !quiet || !state.hasChildTranscript) return true;
    const text = this.learnerText();
    if (isLearnerStopText(text)) {
      this.stop();
      return true;
    }
    const support = /^(help|repeat)[.!]?$/i.exec(text.trim())?.[1]?.toLowerCase() as "help" | "repeat" | undefined;
    if (support) {
      if (supportRequestedAt?.visitId === state.visitId && supportRequestedAt.revision === state.transcriptRevision)
        return true;
      const { visitId, transcriptRevision } = state;
      this.controller.consumeTurns(this.deferredTurns);
      this.consumeFragments();
      this.support(support);
      if (!this.context().steering)
        this.timer = setTimeout(() => {
          const current = this.context().state;
          if (current?.visitId === visitId && current.transcriptRevision === transcriptRevision) this.schedule();
        }, this.debounceMs);
      return true;
    }
    if (parseLearnerNavigationText(text)) {
      this.controller.invalidate();
      return false;
    }
    const visitId = state.visitId;
    this.timer = setTimeout(() => {
      const current = this.context();
      if (!current.quiet || current.state?.visitId !== visitId) return;
      const messages = this.groups()
        .filter(group => group.speaker === "sprout")
        .map(group => ({ id: `tutor_${group.order}`, text: group.text }));
      const marker = "[Earlier tutor context omitted; recent suffix follows] ";
      const tutorContext = messages
        .filter(message => message.text.trim())
        .slice(-INTERPRETATION_LIMITS.turns)
        .map((message, index, recent) => ({
          ...message,
          text:
            message.text.length > INTERPRETATION_LIMITS.text || (index === 0 && messages.length > recent.length)
              ? marker + message.text.slice(-(INTERPRETATION_LIMITS.text - marker.length))
              : message.text,
        }));
      void this.controller.extract(tutorContext);
    }, this.debounceMs);
    return true;
  }

  onStart(nodeId: string, visitId: number) {
    if (isCalculusProblemId(nodeId)) this.controller.enter(nodeId, visitId);
  }

  onVisitChange(nodeId: string, visitId: number, outcome: "completed" | "skipped") {
    clearTimeout(this.timer);
    if (isCalculusProblemId(nodeId)) this.controller.enter(nodeId, visitId, outcome);
    else this.controller.finish(outcome);
    this.reservation = undefined;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  invalidate(cancelTimer = false) {
    this.reservation = undefined;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    this.controller.invalidate();
    if (cancelTimer) clearTimeout(this.timer);
  }

  onStop() {
    this.controller.finish("stopped");
    clearTimeout(this.timer);
    this.reservation = undefined;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  private consumeFragments() {
    for (const fragment of this.context().fragments)
      if (fragment.event.speaker === "child") this.consumedFragments.add(fragment.order);
  }

  confirmProposalDisplayed(id: string, boardRevision: number) {
    if (!this.context().live || !this.controller.confirmDisplayed(id, boardRevision)) return false;
    const feedback = this.controller.feedbackDisplay;
    if (feedback?.target === "proposal") this.confirmFeedbackDisplayed(feedback.token);
    return true;
  }

  confirmFeedbackDisplayed(token: string) {
    if (!this.context().quiet) return false;
    const snapshot = this.controller.takeFeedback(token);
    if (!snapshot) return false;
    const content = calculusFeedbackInstruction(snapshot);
    if (!content) {
      this.publish();
      return false;
    }
    const eventId = `${this.runtimeId}:math:${token}`;
    try {
      this.send(eventId, content);
      const help = !snapshot.pending && snapshot.current?.history.at(-1)?.action.kind === "help";
      this.recordSourceEvent(help ? "hint" : "neutral-probe", content);
      this.log("gpt_live.math_feedback_append", {
        eventId,
        token,
        content,
        deliveryId: snapshot.current?.history.at(-1)?.deliveryId ?? null,
      });
    } catch {
      this.log("gpt_live.math_feedback_failed", { eventId, token });
    }
    this.publish();
    return true;
  }

  recordSourceEvent(kind: MathSourceEvent["kind"], text: string) {
    const { live, state } = this.context();
    if (!live || state?.phase !== "active") return false;
    const order = this.nextOrder();
    return this.controller.recordSourceEvent({ id: `app_${order}`, order, kind, text });
  }

  confirmProposal(id: string, boardRevision: number, operations: readonly Operation[], method: "ui" | "spoken" = "ui") {
    if (!this.context().quiet || this.reservation) {
      this.log("math.confirmation_rejected", { id, boardRevision, operations, method, reason: "runtime-gate" });
      return false;
    }
    const pending = this.controller.pendingProposal;
    const token = this.controller.feedbackDisplay?.token ?? null;
    const accepted = this.controller.confirm(id, boardRevision, operations);
    this.log("math.confirmation", {
      id,
      boardRevision,
      operations,
      method,
      accepted,
      proposal: pending?.batch ?? null,
      token,
    });
    if (accepted) this.consumeFragments();
    return accepted;
  }
}
