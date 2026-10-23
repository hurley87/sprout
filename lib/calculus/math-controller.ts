import { parseMathActionBatch, type MathActionBatch } from "./math-action";
import type { MathLearnerTurn, MathReview } from "./math-evidence";
import { parseMathInterpretationInput, type MathInterpretationInput } from "./math-interpretation-contract";
import { acceptMathBatch, applyMathBatch, createMathState, updateMathAuthority, type MathState } from "./math-state";
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
export type MathControllerSnapshot = {
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
  private visits: MathState[] = [];
  private checks: MathVersionCheck[] = [];
  private versionContexts = new Map<string, WorkingContext | null>();
  private versionBases = new Map<string, WorkingContext | null>();
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
  ) {}

  snapshot(): MathControllerSnapshot {
    return structuredClone({
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
    this.versionContexts.clear();
    this.versionBases.clear();
    this.consumed.clear();
    this.lastKey = "";
    this.disposition = "idle";
  }

  invalidate() {
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
    this.disposition = "extracting";
    this.changed();
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
      const body = await response.json();
      if (generation !== this.generation || signal.aborted || this.current !== state) return;
      if (!body?.batch || body.review !== "required") throw new Error("No reviewable proposal");
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
      this.captured = { state, turns, consumed: new Map(this.turns.map(t => [t.id, t.text.length])) };
      this.disposition = "pending-clarification";
    } catch {
      if (generation !== this.generation || abort.signal.aborted) return;
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
    )
      return false;
    // Stage contexts along with the ordered batch. A replacement transforms the
    // replaced attempt's INPUT, never the erroneous value it is correcting.
    // Undo restores the predecessor version and its retained role/base.
    const contexts = new Map(this.versionContexts),
      bases = new Map(this.versionBases);
    const checks: MathVersionCheck[] = [];
    const steps = state.steps.map(step => ({
      id: step.id,
      currentVersionId: step.currentVersionId,
      versionIds: step.versions.map(v => v.id),
    }));
    const edits = [...state.effectiveEdits];
    const original: WorkingContext = {
      expression: getCalculusPresentation(state.identity.problemId).functionExpression,
      role: "function",
    };
    const reviews: MathReview[] = pending.batch.actions.map((action, index) => {
      const operation = operations[index];
      let validation: MathValidationResult | null = null;
      if (action.kind === "append" || action.kind === "replace") {
        const latest = steps.findLast(step => step.currentVersionId !== null);
        const target = action.kind === "replace" ? steps.find(step => step.id === action.targetStepId) : undefined;
        const base =
          action.kind === "replace"
            ? target?.currentVersionId
              ? (bases.get(target.currentVersionId) ?? null)
              : null
            : latest?.currentVersionId
              ? (contexts.get(latest.currentVersionId) ?? null)
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
        const step = target ?? { id: `s${steps.length + 1}`, currentVersionId: null, versionIds: [] };
        if (action.kind === "append") steps.push(step);
        const versionId = `${step.id}v${step.versionIds.length + 1}`;
        edits.push({
          actionId: `a${state.history.length + index + 1}`,
          stepId: step.id,
          previousVersionId: step.currentVersionId,
        });
        step.versionIds.push(versionId);
        step.currentVersionId = versionId;
        bases.set(versionId, base);
        contexts.set(
          versionId,
          role
            ? { expression: action.expression.op === "equal" ? action.expression.right : action.expression, role }
            : null,
        );
        checks.push({ visitId: state.identity.visitId, versionId, operation, base, result: validation, role });
      } else if (action.kind === "undo") {
        const edit = edits.at(-1);
        if (edit?.stepId === action.targetStepId) {
          edits.pop();
          steps.find(step => step.id === edit.stepId)!.currentVersionId = edit.previousVersionId;
        }
      }
      return {
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
    });
    try {
      const acceptance = acceptMathBatch(state, pending.id, pending.batch, { turns: captured.turns, reviews });
      this.current = applyMathBatch(state, acceptance);
      this.versionContexts = contexts;
      this.versionBases = bases;
      this.checks.push(...checks);
      this.consumed = captured.consumed;
      this.invalidate();
      this.disposition = "committed";
      this.changed();
      return true;
    } catch {
      return false;
    }
  }
}
