import { parseMathActionBatch, type MathActionBatch, type MathIdentity, type MathProposal } from "./math-action";
import { exactObject, type MathExpression } from "./math-expression";
import { isCalculusProblemId } from "./problems";
import {
  collectMathEvidence,
  type MathEvidence,
  type MathLearnerTurn,
  type MathReview,
  type MathSourceEvent,
} from "./math-evidence";

export interface MathVersion {
  readonly id: string;
  readonly actionId: string;
  readonly predecessorId: string | null;
  readonly expression: MathExpression;
  readonly evidence: MathEvidence;
}
export interface MathStep {
  readonly id: string;
  readonly currentVersionId: string | null;
  readonly versions: readonly MathVersion[];
}
export interface MathHistoryEntry {
  readonly id: string;
  readonly deliveryId: string;
  readonly action: MathProposal;
  readonly evidence: MathEvidence;
  readonly stepId: string | null;
  readonly versionId: string | null;
  /** Undo is a withdrawal of an edit, not deletion of its evidence. */
  readonly withdrawsActionId: string | null;
}
interface BoardEdit {
  readonly actionId: string;
  readonly stepId: string;
  readonly previousVersionId: string | null;
}
export interface MathState {
  readonly identity: MathIdentity;
  /** Every accepted command, including non-board actions, advances revision once. */
  readonly revision: number;
  readonly status: "active" | "stopped" | "completed" | "skipped" | "ended";
  readonly steps: readonly MathStep[];
  readonly history: readonly MathHistoryEntry[];
  readonly effectiveEdits: readonly BoardEdit[];
  readonly sourceEvents: readonly MathSourceEvent[];
  readonly deliveries: readonly { readonly id: string; readonly fingerprint: string }[];
  readonly clarification: { readonly actionId: string; readonly reason: string } | null;
  readonly nextRequested: boolean;
}
function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown) {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}

export function createMathState(identity: MathIdentity): MathState {
  exactObject(identity, ["runtimeId", "problemId", "visitId", "transcriptRevision", "baseBoardRevision"]);
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.runtimeId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.visitId) ||
    !isCalculusProblemId(identity.problemId) ||
    !Number.isSafeInteger(identity.transcriptRevision) ||
    identity.transcriptRevision < 0 ||
    identity.baseBoardRevision !== 0
  )
    throw new Error("Invalid initial mathematical identity");
  return snapshot({
    identity,
    revision: 0,
    status: "active",
    steps: [],
    history: [],
    effectiveEdits: [],
    sourceEvents: [],
    deliveries: [],
    clarification: null,
    nextRequested: false,
  });
}

/** Opaque in-process acceptance capability. JSON/model fields cannot mint one.
 * The factory is for trusted app code only, after separate semantic review.
 * It does not authenticate a caller or assess free-text reasoning itself.
 */
declare const accepted: unique symbol;
export interface MathAcceptance {
  readonly [accepted]: true;
}
interface AcceptedData {
  readonly state: MathState;
  readonly deliveryId: string;
  readonly batch: MathActionBatch;
  readonly evidence: readonly MathEvidence[];
  readonly fingerprint: string;
}
const capabilities = new WeakMap<MathAcceptance, AcceptedData>();
export function acceptMathBatch(
  state: MathState,
  deliveryId: string,
  proposal: unknown,
  authority: {
    readonly turns: readonly MathLearnerTurn[];
    readonly reviews: readonly MathReview[];
  },
): MathAcceptance {
  if (!deliveryId.trim()) throw new Error("Missing delivery identity");
  const batch = parseMathActionBatch(proposal, {
    identity: state.identity,
    turns: authority.turns,
    logicalStepIds: state.steps.filter(s => s.currentVersionId !== null).map(s => s.id),
    latestUndoableStepId: state.effectiveEdits.at(-1)?.stepId ?? null,
  });
  if (authority.reviews.length !== batch.actions.length || authority.reviews.some(r => r.faithful !== true))
    throw new Error("Separate app review required for every action");
  const evidence = batch.actions.map((action, i) =>
    collectMathEvidence(
      batch.identity,
      action.sources,
      authority.turns,
      state.sourceEvents,
      action.kind === "append" || action.kind === "replace"
        ? authority.reviews[i]
        : { ...authority.reviews[i], mathematicallyComplete: false, independenceEstablished: false },
    ),
  );
  const fingerprint = JSON.stringify({ batch, evidence });
  const capability = Object.freeze({}) as MathAcceptance;
  capabilities.set(capability, { state, deliveryId, batch, evidence, fingerprint });
  return capability;
}

/** Atomic, deterministic application. IDs derive from app state, never proposals.
 * Exact capability redelivery is a no-op even after lifecycle freeze; conflicting
 * delivery IDs reject. A capability is bound to the precise immutable snapshot.
 */
export function applyMathBatch(state: MathState, acceptance: MathAcceptance): MathState {
  const data = capabilities.get(acceptance);
  if (!data) throw new Error("Application acceptance required");
  const duplicate = state.deliveries.find(d => d.id === data.deliveryId);
  if (duplicate) {
    if (duplicate.fingerprint !== data.fingerprint) throw new Error("Conflicting delivery");
    return state;
  }
  if (state.status !== "active" || state !== data.state) throw new Error("Revoked or stale acceptance");
  const next = structuredClone(state) as MutableState;
  let boardChanged = false;
  data.batch.actions.forEach((action, i) => {
    if (data.evidence[i].assessment.disposition === "rejected") throw new Error("Rejected action");
    const id = `a${next.history.length + 1}`;
    let stepId: string | null = null,
      versionId: string | null = null,
      withdrawsActionId: string | null = null;
    if (action.kind === "append" || action.kind === "replace") {
      if (data.evidence[i].assessment.disposition === "clarification-required")
        throw new Error("Board action not accepted");
      let step: MutableStep;
      if (action.kind === "append") {
        step = { id: `s${next.steps.length + 1}`, currentVersionId: null, versions: [] };
        next.steps.push(step);
      } else {
        const target = next.steps.find(s => s.id === action.targetStepId);
        if (!target?.currentVersionId) throw new Error("Withdrawn target");
        step = target;
      }
      stepId = step.id;
      versionId = `${step.id}v${step.versions.length + 1}`;
      next.effectiveEdits.push({ actionId: id, stepId, previousVersionId: step.currentVersionId });
      step.versions.push({
        id: versionId,
        actionId: id,
        predecessorId: step.currentVersionId,
        expression: structuredClone(action.expression),
        evidence: data.evidence[i],
      });
      step.currentVersionId = versionId;
      next.clarification = null;
      boardChanged = true;
    } else if (action.kind === "undo") {
      const edit = next.effectiveEdits.at(-1);
      if (!edit || edit.stepId !== action.targetStepId) throw new Error("Undo must target latest effective edit");
      next.effectiveEdits.pop();
      next.steps.find(s => s.id === edit.stepId)!.currentVersionId = edit.previousVersionId;
      stepId = edit.stepId;
      withdrawsActionId = edit.actionId;
      boardChanged = true;
    } else if (action.kind === "clarify") next.clarification = { actionId: id, reason: action.reason };
    else if (action.kind === "next") next.nextRequested = true;
    next.history.push({
      id,
      deliveryId: data.deliveryId,
      action: structuredClone(action),
      evidence: data.evidence[i],
      stepId,
      versionId,
      withdrawsActionId,
    });
  });
  next.revision++;
  if (boardChanged) next.identity.baseBoardRevision++;
  next.deliveries.push({ id: data.deliveryId, fingerprint: data.fingerprint });
  return snapshot(next);
}
type MutableStep = { id: string; currentVersionId: string | null; versions: MathVersion[] };
type MutableState = {
  -readonly [K in keyof MathState]: K extends "steps"
    ? MutableStep[]
    : K extends "identity"
      ? { -readonly [P in keyof MathIdentity]: MathIdentity[P] }
      : MathState[K] extends readonly (infer T)[]
        ? T[]
        : MathState[K];
};

/** Trusted application lifecycle/source inputs. Every change revokes pending
 * capabilities, even without a board edit. Tutor-only transcript updates can
 * leave the captured learner authority unchanged. No navigation or mastery here.
 */
export function updateMathAuthority(
  state: MathState,
  change:
    | { readonly kind: "learner-revision"; readonly transcriptRevision: number }
    | { readonly kind: "source-event"; readonly event: MathSourceEvent }
    | { readonly kind: "lifecycle"; readonly status: Exclude<MathState["status"], "active"> },
): MathState {
  if (state.status !== "active") throw new Error("Frozen mathematical state");
  const next = structuredClone(state) as MutableState;
  if (change.kind === "learner-revision") {
    if (
      !Number.isSafeInteger(change.transcriptRevision) ||
      change.transcriptRevision <= state.identity.transcriptRevision
    )
      throw new Error("Stale learner revision");
    next.identity.transcriptRevision = change.transcriptRevision;
  } else if (change.kind === "source-event") {
    const event = change.event;
    if (
      !event.id.trim() ||
      !Number.isSafeInteger(event.order) ||
      event.order < 0 ||
      state.sourceEvents.some(e => e.id === event.id) ||
      (state.sourceEvents.at(-1)?.order ?? -1) >= event.order
    )
      throw new Error("Invalid source event order");
    next.sourceEvents.push(structuredClone(event));
  } else next.status = change.status;
  next.revision++;
  return snapshot(next);
}

/** Last visible logical line only; historical/earlier correct attempts cannot
 * mask later incorrect or provisional work. This is not a navigation policy.
 */
export function currentMathProgress(state: MathState) {
  const step = state.steps.findLast(step => step.currentVersionId !== null);
  const evidence = step?.versions.find(version => version.id === step.currentVersionId)?.evidence;
  return {
    mathematicallyComplete: evidence?.mathematicallyComplete ?? false,
    demonstratedIndependent: evidence?.demonstratedIndependent ?? false,
  };
}
