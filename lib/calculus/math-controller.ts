import { parseMathActionBatch, type MathActionBatch } from "./math-action";
import type { MathLearnerTurn, MathSourceEvent } from "./math-evidence";
import { parseMathInterpretationInput, type MathInterpretationInput } from "./math-interpretation-contract";
import {
  commitMathBatch,
  createMathState,
  updateMathAuthority,
  type MathBatchReview,
  type MathState,
  type MathVersionValidation,
} from "./math-state";
import { validateMathExpression, type MathValidationContext, type MathValidationResult } from "./math-validator";
import { getCalculusPresentation, type CalculusProblemId } from "./problems";

export type MathPendingProposal = {
  readonly id: string;
  readonly batch: MathActionBatch;
  readonly status: "awaiting-learner-confirmation";
  readonly boardRevision: number;
  readonly displayed: boolean;
};
type WorkingContext = NonNullable<MathValidationContext["current"]>;
type MathVersionCheck = {
  readonly visitId: string;
  readonly versionId: string;
  readonly operation: "differentiate" | "rewrite" | "unassessed";
  readonly base: WorkingContext | null;
  readonly result: MathValidationResult | null;
  readonly role: WorkingContext["role"] | null;
};
export type MathFeedbackDisplay = {
  readonly token: string;
  readonly target: "proposal" | "board";
  readonly boardRevision: number;
};
export type MathControllerSnapshot = {
  readonly feedback: MathFeedbackDisplay | null;
  readonly checks: readonly MathVersionCheck[];
  readonly visits: readonly MathState[];
  readonly current: MathState | null;
  readonly pending: MathPendingProposal | null;
  readonly disposition: "idle" | "extracting" | "pending-clarification" | "unavailable" | "committed";
};

/** No transport or transcript owner. Only the enclosing runtime supplies authenticated turns.
 * A provider proposal NEVER establishes faithfulness. Commit requires a separate,
 * explicit learner confirmation of the exact displayed batch via confirm().
 */
export class MathController {
  private feedback: MathFeedbackDisplay | null = null;
  private feedbackSequence = 0;
  private visits: MathState[] = [];
  private checks: MathVersionCheck[] = [];
  private current: MathState | null = null;
  private pending: MathPendingProposal | null = null;
  private disposition: MathControllerSnapshot["disposition"] = "idle";
  private request?: AbortController;
  private generation = 0;
  private lastKey = "";
  private turns: readonly MathLearnerTurn[] = [];
  private consumed = new Map<string, number>();
  private captured?: { state: MathState; turns: readonly MathLearnerTurn[]; consumed: Map<string, number> };

  constructor(
    private readonly runtimeId: string,
    private readonly changed: () => void,
    private readonly observe: (type: string, detail: unknown) => void = () => {},
  ) {}

  snapshot(): MathControllerSnapshot {
    return structuredClone({
      feedback: this.feedback,
      checks: this.checks,
      visits: this.visits,
      current: this.current,
      pending: this.pending,
      disposition: this.disposition,
    });
  }

  enter(problemId: CalculusProblemId, visitId: number, previousStatus: "completed" | "skipped" = "completed") {
    this.finish(previousStatus);
    this.current = createMathState({
      runtimeId: this.runtimeId,
      problemId,
      visitId: `visit_${visitId}`,
      transcriptRevision: 0,
      baseBoardRevision: 0,
    });
    this.turns = [];
    this.consumed.clear();
    this.lastKey = "";
    this.disposition = "idle";
  }

  invalidate() {
    if (this.pending) this.observe("math.proposal_revoked", { id: this.pending.id, batch: this.pending.batch });
    this.feedback = null;
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    this.pending = null;
    this.captured = undefined;
    this.disposition = "idle";
  }

  finish(status: "completed" | "skipped" | "stopped") {
    this.invalidate();
    if (this.current?.status === "active") {
      this.current = updateMathAuthority(this.current, { kind: "lifecycle", status });
      this.visits.push(this.current);
    }
  }

  learnerRevision(revision: number, turns: readonly MathLearnerTurn[]) {
    if (this.current?.status !== "active") return;
    this.invalidate();
    this.turns = structuredClone(turns);
    this.current = updateMathAuthority(this.current, { kind: "learner-revision", transcriptRevision: revision });
  }

  /** Consumed confirmation text remains in the runtime transcript, never extraction.
   * Advance authority only after acceptance; the accepted board gets fresh feedback. */
  consumeTurns(turns: readonly MathLearnerTurn[]) {
    this.consumed = new Map(turns.map(turn => [turn.id, turn.text.length]));
  }

  consumeConfirmation(revision: number, turns: readonly MathLearnerTurn[]) {
    this.learnerRevision(revision, turns);
    this.consumeTurns(turns);
    this.disposition = "committed";
    this.prepareFeedback("board");
    this.changed();
  }

  /** App-classified provenance only; never semantic evidence from tutor text.
   * Tutor-only events preserve learner authority, including in-flight extraction.
   */
  recordSourceEvent(event: MathSourceEvent): boolean {
    if (this.current?.status !== "active") return false;
    this.current = updateMathAuthority(this.current, { kind: "source-event", event });
    if (this.captured) this.captured = { ...this.captured, state: this.current };
    this.changed();
    return true;
  }

  private prepareFeedback(target: MathFeedbackDisplay["target"]) {
    this.feedback = {
      token: `${this.runtimeId}:math-feedback:${++this.feedbackSequence}`,
      target,
      boardRevision: this.current!.identity.baseBoardRevision,
    };
  }

  /** Consume once after the exact view commits; no provider acknowledgment gate. */
  takeFeedback(token: string): MathControllerSnapshot | null {
    if (!this.feedback || this.feedback.token !== token || this.current?.status !== "active") return null;
    if (this.feedback.target === "proposal" && !this.pending?.displayed) return null;
    const snapshot = this.snapshot();
    this.observe("math.feedback_displayed", {
      ...this.feedback,
      deliveryId: this.current.history.at(-1)?.deliveryId ?? null,
    });
    this.feedback = null;
    return snapshot;
  }

  async extract(tutorContext: MathInterpretationInput["tutorContext"]) {
    const state = this.current;
    if (!state || state.status !== "active" || !this.turns.length) return;
    const key = JSON.stringify(state.identity);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const consumed = new Map(this.consumed);
    const turns = this.turns.flatMap(turn => {
      const offset = consumed.get(turn.id) ?? 0;
      const text = turn.text.slice(offset);
      return text.trim() ? [{ ...turn, id: `${turn.id}_from_${offset}`, text }] : [];
    });
    if (!turns.length) return;
    const abort = new AbortController();
    this.request = abort;
    const generation = this.generation;
    const requestId = crypto.randomUUID();
    this.observe("math.interpretation_started", { requestId, turns, before: state });
    this.disposition = "extracting";
    this.changed();
    let failure: "unavailable" | "malformed" | "rejected" = "unavailable";
    try {
      const input = parseMathInterpretationInput({
        identity: state.identity,
        learnerTurns: turns.map(({ id, text }) => ({ id, text })),
        tutorContext,
        board: state.steps.flatMap(step => {
          const version = step.versions.find(v => v.id === step.currentVersionId);
          return version ? [{ id: step.id, expression: version.expression }] : [];
        }),
        latestUndoableStepId: state.effectiveEdits.at(-1)?.stepId ?? null,
      });
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]);
      const response = await fetch("/api/math-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok) throw new Error("Interpretation unavailable");
      failure = "malformed";
      const body = await response.json();
      if (generation !== this.generation || signal.aborted) {
        this.observe("math.interpretation_ended", { requestId, disposition: "stale", proposal: body?.batch ?? null });
        return;
      }
      if (!body?.batch || body.review !== "required") throw new Error("No reviewable proposal");
      this.observe("math.interpretation_result", { requestId, proposal: body.batch });
      failure = "rejected";
      const batch = parseMathActionBatch(body.batch, {
        identity: state.identity,
        turns,
        logicalStepIds: input.board.map(step => step.id),
        latestUndoableStepId: input.latestUndoableStepId,
      });
      // Validate chronological sources across the entire batch as well as within actions.
      let previousOrder = -1,
        previousEnd = -1;
      for (const action of batch.actions)
        for (const source of action.sources) {
          const order = turns.find(t => t.id === source.turnId)!.order;
          if (order < previousOrder || (order === previousOrder && source.start < previousEnd))
            throw new Error("Unordered or reused sources");
          previousOrder = order;
          previousEnd = source.end;
        }
      this.pending = {
        id: crypto.randomUUID(),
        batch,
        status: "awaiting-learner-confirmation",
        boardRevision: state.identity.baseBoardRevision,
        displayed: false,
      };
      this.observe("math.interpretation_ended", {
        requestId,
        disposition: "proposed",
        proposal: batch,
        id: this.pending.id,
      });
      this.captured = { state: this.current!, turns, consumed: new Map(this.turns.map(t => [t.id, t.text.length])) };
      this.disposition = "pending-clarification";
      this.prepareFeedback("proposal");
    } catch {
      const stale = generation !== this.generation || abort.signal.aborted;
      this.observe("math.interpretation_ended", {
        requestId,
        disposition: stale ? "stale" : failure,
      });
      if (stale) return;
      this.disposition = "unavailable";
    } finally {
      if (generation === this.generation) {
        this.request = undefined;
        this.changed();
      }
    }
  }

  /** Future board UI must display every action/expression/target and source, then ask
   * the learner whether this is what they intended. Never call from a model result,
   * display-commit callback, tutor praise, or generic "yes" transcript detection.
   * Each board action also needs the learner-confirmed operation relative to the
   * current input. Uncertain operations/roles stay unchecked. Replacements retain
   * their original input; appends use the latest effective line including within
   * batches. An unknown role cannot silently become a function or derivative.
   */
  confirmDisplayed(id: string, boardRevision: number): boolean {
    if (
      !this.pending ||
      this.pending.id !== id ||
      this.pending.boardRevision !== boardRevision ||
      this.captured?.state !== this.current
    )
      return false;
    if (!this.pending.displayed)
      this.observe("math.proposal_displayed", { id, boardRevision, token: this.feedback?.token ?? null });
    this.pending = { ...this.pending, displayed: true };
    this.changed();
    return true;
  }

  confirm(
    id: string,
    boardRevision: number,
    operations: readonly ("differentiate" | "rewrite" | "unassessed")[],
  ): boolean {
    const pending = this.pending,
      captured = this.captured,
      state = this.current;
    if (
      !pending ||
      !pending.displayed ||
      pending.boardRevision !== boardRevision ||
      pending.id !== id ||
      !captured ||
      captured.state !== state ||
      state?.status !== "active" ||
      operations.length !== pending.batch.actions.length ||
      operations.some(operation => !["differentiate", "rewrite", "unassessed"].includes(operation))
    ) {
      this.observe("math.confirmation_rejected", { id, boardRevision, operations });
      return false;
    }
    const checks: MathVersionCheck[] = [];
    const original: WorkingContext = {
      expression: getCalculusPresentation(state.identity.problemId).functionExpression,
      role: "function",
    };
    const review: MathBatchReview = (action, index, board, versionId) => {
      const operation = operations[index];
      let validation: MathValidationResult | null = null;
      let versionValidation: MathVersionValidation | undefined;
      if ((action.kind === "append" || action.kind === "replace") && versionId) {
        const source =
          action.kind === "replace"
            ? board.steps.find(step => step.id === action.targetStepId)
            : board.steps.findLast(step => step.currentVersionId !== null);
        const version = source?.versions.find(version => version.id === source.currentVersionId);
        const base =
          action.kind === "replace"
            ? (version?.validation?.base ?? null)
            : source
              ? (version?.validation?.context ?? null)
              : original;
        validation =
          operation !== "unassessed" && base
            ? validateMathExpression(action.expression, {
                problemId: state.identity.problemId,
                operation,
                current: base,
              })
            : null;
        const role =
          operation === "unassessed" || !base ? null : operation === "differentiate" ? "derivative" : base.role;
        versionValidation = {
          base,
          context: role
            ? { expression: action.expression.op === "equal" ? action.expression.right : action.expression, role }
            : null,
        };
        checks.push({ visitId: state.identity.visitId, versionId, operation, base, result: validation, role });
      }
      return {
        validation: versionValidation,
        faithful: true, // Only this explicit learner-confirmation API grants fidelity.
        independenceEstablished: false,
        mathematicallyComplete: validation?.completeDerivative ?? false,
        assessment: {
          disposition: validation?.correctness === "unsupported" ? "unresolved" : "accepted",
          correctness: validation?.correctness ?? "unchecked",
          reasoning: action.kind === "strategy" ? "strategy-only" : "unassessed",
          assistance: "unknown",
        },
      };
    };
    try {
      this.current = commitMathBatch(state, pending.batch, { turns: captured.turns, review, deliveryId: pending.id });
      this.checks.push(...checks);
      this.consumed = captured.consumed;
      this.observe("math.committed", {
        id,
        batch: pending.batch,
        before: state,
        after: this.current,
        checks,
        operations,
      });
      this.pending = null;
      this.invalidate();
      this.disposition = "committed";
      this.prepareFeedback("board");
      this.changed();
      return true;
    } catch {
      this.observe("math.confirmation_rejected", { id, boardRevision, operations, reason: "application-rejected" });
      return false;
    }
  }
}
