import {
  freezeQuestionOutcomes,
  type QuestionAttempt,
  type QuestionObservation,
  type QuestionOutcomeSnapshot,
} from "./mae386/question-outcomes";
import {
  projectRewrite,
  rewriteWords,
  type RewriteProjection,
  type RewriteTranscript,
} from "./mae386/rewrite-proposal";
import { mae386NeutralBackchannel } from "./mae386/source-block";
import type { OutputActivityEvent } from "../events";
import { acceptsLearnerAnswerIndependently } from "./counting-answer-policy";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import { currentNodeContext, isLessonNodeId, type LessonDefinition } from "./lesson-definition";
import { substantiveLearnerText, transcriptMessages } from "./tutor-observation";
import {
  learnerNavigationIntent,
  parseLearnerNavigationText,
  isLearnerStopText,
  type NavigationIntent,
  closingTutorExchange,
  matchesTutorClosure,
  tutorAcknowledgedClosure,
  hasConversationCompletionEvidence,
} from "./conversation-progression";
import {
  applyConceptObservations,
  conceptKey,
  type ConceptEvidenceRecord,
  type ConceptRevealEffect,
} from "./concept-evidence";

export { learnerRequestedNext } from "./conversation-progression";
export type { ConceptEvidenceReference, ConceptEvidenceRecord } from "./concept-evidence";

/** App-owned identities, captured at the source/request boundary, never supplied by the classifier. */
export type RuntimeSource = {
  readonly runtimeId: string;
  readonly visitId: number;
  readonly childTurnId: number;
};
export type ClassificationSource = RuntimeSource & {
  readonly nodeId: string;
  readonly transcriptRevision: number;
};
export type RenderIdentity = {
  readonly token: string;
  readonly nodeId: string | null;
  readonly sceneId: string | null;
};
export type CurrentNodeSteeringContext = {
  readonly nodeId: string;
  readonly scene: Readonly<Record<string, string | number | boolean>>;
  readonly learningObjective: string;
  readonly tutorBrief: string;
  readonly completionCriteria?: readonly { readonly id: string; readonly description: string }[];
  readonly completionPolicy?: string;
};
/** Departure facts, not assessment outcomes. Transcript presence is not an attempted answer.
 * Actual learner text remains in the existing visit transcript with this source identity. */
export type NavigationRecord = {
  readonly source: ClassificationSource;
  readonly questionId: string;
  readonly intent: NavigationIntent | "tutor_closure";
  readonly hasChildTranscript: boolean;
  readonly skippedNodeIds: readonly string[];
  readonly atMs: number;
};
export type LessonRuntimeState = {
  readonly runtimeId: string;
  readonly lessonId: string;
  readonly nodeId: string;
  readonly visitId: number;
  readonly childTurnId: number;
  readonly hasChildTurn: boolean;
  readonly hasChildTranscript: boolean;
  readonly childSpeaking: boolean;
  /** Provisional energy blocks navigation; confirmed speech owns a new turn. */
  readonly childCandidate: {
    readonly deferredTurn?: boolean;
    readonly hasChildTranscript: boolean;
    readonly tutorOutputObserved: boolean;
  } | null;
  /** Visit-local transcript/audio eligibility only; never saved mastery or navigation authority. */
  readonly interruptedExchange?: { readonly tutorOutputObserved: boolean; readonly ready: boolean } | null;
  readonly transcriptRevision: number;
  readonly transcriptSource: "child" | "tutor" | "unknown";
  readonly consumedRevision: number | null;
  /** Earlier correct observation is only a candidate until the exact latest revision revalidates it. */
  readonly acceptedAnswerRevision: number | null;
  readonly answerAccepted: boolean;
  readonly acknowledgmentObserved: boolean;
  readonly outputActivity: OutputActivityEvent["state"];
  /** Candidate audio for this ended child turn; semantic authority is still required to use it. */
  readonly tutorOutputObserved: boolean;
  readonly tutorOutputDrained: boolean;
  readonly terminalTranscriptComplete?: boolean;
  /** Confirmed terminal speech must receive text or bounded missing-text recovery. */
  readonly terminalLearnerPending?: boolean;
  readonly quietSinceMs: number | null;
  readonly quietDrainMs: number;
  readonly nowMs: number;
  readonly phase: "active" | "rendering" | "complete" | "stopped";
  readonly lessonComplete: boolean;
  /** True when accepted evidence is ready to advance after an application-owned review action. */
  readonly transitionReady: boolean;
  readonly conversationAdvanceRequested?: "learner" | "tutor" | false;
  /** Latest authenticated learner turn in this visit, retained across textless microphone segments.
   * Command authority only; never a substitute for current-turn assessment evidence. */
  readonly learnerUtterance?: { readonly source: ClassificationSource; readonly text: string } | null;
  readonly navigationIntent?: NavigationIntent | null;
  readonly navigationSource?: ClassificationSource | null;
  readonly navigationHistory?: readonly NavigationRecord[];
  /** Classifier-accepted closure of this tutor message, independent of the latest speaker.
   * Suspended during a new learner turn until its text proves to be a brief acknowledgment. */
  readonly tutorClosure?: {
    readonly source: ClassificationSource;
    readonly messageIndex: number;
    readonly text: string;
  } | null;
  /** Current answers and snapshot history, isolated from cumulative mastery. */
  readonly rewriteProposals?: Readonly<Record<string, RewriteProjection>>;
  readonly rewriteTranscript?: RewriteTranscript | null;
  /** Exact app-authenticated conceptual transcript, scoped to this visit. */
  readonly learnerTranscript?: RewriteTranscript | null;
  /** Pre-turn candidate for completed control-only speech. Never current evidence
   * while new learner words are pending, and never restored from history. */
  readonly rewriteTurn?: { readonly source: RuntimeSource; readonly prior: RewriteProjection["current"] } | null;
  /** MAE386-only accepted outcomes, frozen once at recap entry or Stop. */
  readonly questionOutcomes?: QuestionOutcomeSnapshot;
  readonly questionAttempts?: Readonly<Record<string, readonly QuestionAttempt[]>>;
  readonly questionObservations?: Readonly<Record<string, QuestionObservation>>;
  /** Session-local cumulative evidence; a new runtime always starts empty. */
  readonly conceptEvidence: Readonly<Record<string, ConceptEvidenceRecord>>;
  readonly pendingRender: {
    readonly identity: RenderIdentity;
    readonly origin: ClassificationSource;
    readonly navigation?: NavigationRecord;
  } | null;
};

/** atMs uses one local monotonic clock. The reducer has no timers or provider side effects. */
export type LessonRuntimeEvent = { readonly atMs: number } & (
  | { readonly type: "child.turn.started"; readonly source: RuntimeSource }
  | { readonly type: "child.candidate.started"; readonly source: RuntimeSource }
  | { readonly type: "child.candidate.discarded"; readonly source: RuntimeSource }
  | { readonly type: "child.turn.confirmed"; readonly source: RuntimeSource }
  | {
      readonly type: "conversation.recheck.requested";
      readonly source: ClassificationSource;
      readonly transcriptSnapshot?: string;
    }
  | { readonly type: "child.turn.ended"; readonly source: RuntimeSource }
  | {
      readonly type: "transcript.updated";
      readonly source: RuntimeSource;
      readonly revision: number;
      /** App-owned projection of authenticated provider fragments sharing this learner turn. */
      readonly learnerTurnText?: string;
      readonly rewriteTranscript?: RewriteTranscript;
      readonly learnerTranscript?: RewriteTranscript;
      readonly speaker: "child" | "tutor" | "unknown";
      readonly transcriptSnapshot?: string;
    }
  | {
      readonly type: "proposal.received";
      readonly source: ClassificationSource;
      readonly proposal: unknown;
      readonly transcriptSnapshot?: string;
    }
  | { readonly type: "output.activity"; readonly source: RuntimeSource; readonly state: OutputActivityEvent["state"] }
  | {
      readonly type: "conversation.advance.requested";
      readonly source: ClassificationSource;
      readonly transcriptSnapshot: string;
      readonly intent?: NavigationIntent;
      /** Calculus only: the application checked the problem complete. */
      readonly appCompleted?: true;
    }
  | {
      readonly type: "question.observation";
      readonly source: ClassificationSource;
      readonly status: QuestionObservation["status"];
    }
  | { readonly type: "terminal.transcript.checked"; readonly source: RuntimeSource; readonly complete: boolean }
  | { readonly type: "terminal.learner.resolved"; readonly source: RuntimeSource }
  | { readonly type: "clock.tick"; readonly source: RuntimeSource }
  | { readonly type: "render.confirmed"; readonly runtimeId: string; readonly identity: RenderIdentity }
  | { readonly type: "scene.skipped"; readonly source: RuntimeSource; readonly scope?: NavigationIntent["scope"] }
  | { readonly type: "presentation.continued"; readonly source: ClassificationSource }
  | { readonly type: "stop"; readonly runtimeId: string }
  | { readonly type: "disconnect"; readonly runtimeId: string }
);

export type LessonRuntimeEffect =
  | { readonly type: "render.requested"; readonly identity: RenderIdentity }
  | {
      readonly type: "steering.ready";
      readonly renderToken: string;
      readonly context: CurrentNodeSteeringContext;
    }
  | { readonly type: "lesson.completed"; readonly renderToken: string }
  | ConceptRevealEffect;
/** Observation only: captured before finish can clear accepted flags on transition. */
export type ProposalConsumption = {
  readonly consumption: "consumed" | "ignored";
  readonly reason: string | null;
  readonly accepted: Pick<
    LessonRuntimeState,
    "answerAccepted" | "acceptedAnswerRevision" | "acknowledgmentObserved" | "conceptEvidence"
  > | null;
};
export type LessonRuntimeResult = {
  readonly state: LessonRuntimeState;
  readonly effects: readonly LessonRuntimeEffect[];
  readonly proposalConsumption?: ProposalConsumption;
};

const clearedEvidence = {
  acceptedAnswerRevision: null,
  answerAccepted: false,
  acknowledgmentObserved: false,
  tutorOutputObserved: false,
  tutorOutputDrained: false,
  quietSinceMs: null,
  transitionReady: false,
  conversationAdvanceRequested: false,
  tutorClosure: null,
} as const;

function clearedNavigation(state: LessonRuntimeState) {
  return state.navigationHistory ? { navigationIntent: null, navigationSource: null } : {};
}

/** The initial authored scene must already be rendered. Use a fresh runtimeId for every start/reconnect. */
export function createLessonRuntime(
  runtimeId: string,
  { quietDrainMs = 250, atMs = 0, lesson }: { quietDrainMs?: number; atMs?: number; lesson: LessonDefinition },
): LessonRuntimeState {
  if (
    !runtimeId ||
    !Number.isFinite(quietDrainMs) ||
    quietDrainMs <= 0 ||
    !validTime(atMs) ||
    !isLessonNodeId(lesson, lesson.initialNodeId)
  ) {
    throw new Error("A runtime identity, positive quiet threshold, and valid local time are required");
  }
  return {
    runtimeId,
    lessonId: lesson.id,
    nodeId: lesson.initialNodeId,
    visitId: 1,
    childTurnId: 0,
    hasChildTurn: false,
    hasChildTranscript: false,
    childSpeaking: false,
    childCandidate: null,
    interruptedExchange: null,
    transcriptRevision: 0,
    transcriptSource: "unknown",
    consumedRevision: null,
    ...clearedEvidence,
    outputActivity: "unavailable",
    quietDrainMs,
    nowMs: atMs,
    phase: "active",
    lessonComplete: false,
    ...(lesson.questionGroups
      ? { navigationHistory: [], navigationIntent: null, navigationSource: null, learnerUtterance: null }
      : {}),
    ...(Object.values(lesson.nodes).some(node => node.currentRewrite)
      ? { rewriteProposals: {}, rewriteTurn: null }
      : {}),
    ...(lesson.id === "mae386" ? { questionAttempts: {}, questionObservations: {} } : {}),
    conceptEvidence: {},
    pendingRender: null,
  };
}

export function runtimeSource(state: LessonRuntimeState): RuntimeSource {
  return { runtimeId: state.runtimeId, visitId: state.visitId, childTurnId: state.childTurnId };
}

/** Capture alongside the exact transcript snapshot before awaiting a classification. */
export function classificationSource(state: LessonRuntimeState): ClassificationSource | null {
  if (
    state.phase !== "active" ||
    state.childSpeaking ||
    (!state.hasChildTranscript && !state.interruptedExchange?.ready)
  )
    return null;
  return { ...runtimeSource(state), nodeId: state.nodeId, transcriptRevision: state.transcriptRevision };
}

function rewriteForCurrentVisit(state: LessonRuntimeState) {
  const current = state.rewriteProposals?.[state.nodeId]?.current;
  return current?.source.runtimeId === state.runtimeId &&
    current.source.visitId === state.visitId &&
    current.source.nodeId === state.nodeId
    ? current
    : null;
}

/** Whole authenticated turn grammar only; partial prefixes confer no authority. */
function controlRewritePrior(state: LessonRuntimeState, text: string | undefined) {
  const turn = state.rewriteTurn;
  return text !== undefined &&
    turn &&
    sameSource(state, turn.source) &&
    (isLearnerStopText(text) || parseLearnerNavigationText(text))
    ? turn.prior
    : null;
}

function validTime(atMs: number) {
  return Number.isFinite(atMs) && atMs >= 0;
}

function sameSource(state: RuntimeSource, source: RuntimeSource) {
  return (
    state.runtimeId === source.runtimeId && state.visitId === source.visitId && state.childTurnId === source.childTurnId
  );
}

function sameClassificationSource(state: LessonRuntimeState, source: ClassificationSource) {
  return (
    sameSource(state, source) &&
    source.nodeId === state.nodeId &&
    source.transcriptRevision === state.transcriptRevision
  );
}

export function meetsAuthoredCompletionPolicy(state: LessonRuntimeState, lesson: LessonDefinition) {
  const node = lesson.nodes[state.nodeId];
  if (!node.concepts?.length || node.completionPolicy === "allow_unresolved") return true;
  if (node.completionPolicy !== "all_demonstrated" && node.completionPolicy !== "all_independent") return false;
  return node.concepts.every(concept => {
    const evidence = state.conceptEvidence[conceptKey(node.id, concept.id)];
    return (
      evidence?.status === "demonstrated" &&
      (node.completionPolicy !== "all_independent" || evidence.understanding === "independent")
    );
  });
}

export function hasCurrentCompletionEvidence(state: LessonRuntimeState, lesson: LessonDefinition) {
  if (lesson.nodes[state.nodeId].completeAfterTutorOutput)
    return state.tutorOutputObserved && state.terminalTranscriptComplete === true && !state.terminalLearnerPending;
  if (lesson.calculus) return state.conversationAdvanceRequested === "learner";
  if (lesson.conversationFirst) return hasConversationCompletionEvidence(state);
  const learnerAnswerOnly = acceptsLearnerAnswerIndependently(lesson);
  return (
    state.hasChildTranscript &&
    (learnerAnswerOnly ||
      (state.transcriptSource === "tutor" &&
        state.consumedRevision === state.transcriptRevision &&
        state.acknowledgmentObserved)) &&
    state.acceptedAnswerRevision !== null &&
    state.answerAccepted &&
    meetsAuthoredCompletionPolicy(state, lesson)
  );
}

function sameRender(expected: RenderIdentity, actual: RenderIdentity) {
  return expected.token === actual.token && expected.nodeId === actual.nodeId && expected.sceneId === actual.sceneId;
}

/** Cancel an unconfirmed transition. A new runtime/render is required to resume after interruption. */
function stopped(state: LessonRuntimeState, lesson: LessonDefinition): LessonRuntimeState {
  const next: LessonRuntimeState = {
    ...state,
    ...clearedEvidence,
    ...clearedNavigation(state),
    ...(state.rewriteProposals ? { rewriteTurn: null } : {}),
    nodeId: state.pendingRender?.origin.nodeId ?? state.nodeId,
    phase: "stopped",
    lessonComplete: state.pendingRender ? false : state.lessonComplete,
    pendingRender: null,
    outputActivity: "unavailable",
    childSpeaking: false,
    childCandidate: null,
    interruptedExchange: null,
  };
  return next.questionAttempts && !next.questionOutcomes
    ? { ...next, questionOutcomes: freezeQuestionOutcomes(lesson, next) }
    : next;
}

function outputHasDrained(state: LessonRuntimeState, lesson: LessonDefinition) {
  return (
    (state.tutorOutputObserved ||
      (lesson.conversationFirst === true && state.conversationAdvanceRequested === "learner")) &&
    state.outputActivity === "quiet" &&
    state.quietSinceMs !== null &&
    state.nowMs - state.quietSinceMs >=
      (lesson.nodes[state.nodeId].completeAfterTutorOutput ? Math.max(1500, state.quietDrainMs) : state.quietDrainMs)
  );
}

function finish(state: LessonRuntimeState, lesson: LessonDefinition): LessonRuntimeResult {
  const drained = outputHasDrained(state, lesson);
  const next = { ...state, tutorOutputDrained: drained, transitionReady: false };
  if (!hasCurrentCompletionEvidence(next, lesson) || !drained || next.childSpeaking) {
    return { state: next, effects: [] };
  }
  const edge = lesson.nodes[next.nodeId].onSuccess;
  if (
    next.questionObservations?.[next.nodeId]?.status === "pending" &&
    sameClassificationSource(next, next.questionObservations[next.nodeId].source) &&
    edge.kind === "node" &&
    lesson.nodes[edge.nodeId].completeAfterTutorOutput
  )
    return { state: next, effects: [] };
  if (lesson.requirePresentationConfirmation) return { state: { ...next, transitionReady: true }, effects: [] };
  return requestAuthoredTransition(next, lesson, {
    ...runtimeSource(next),
    nodeId: next.nodeId,
    transcriptRevision: next.transcriptRevision,
  });
}

/** A learner-requested skip follows the authored edge without accepting or revealing an answer. */
function requestAuthoredTransition(
  next: LessonRuntimeState,
  lesson: LessonDefinition,
  origin: ClassificationSource,
  explicitIntent?: NavigationIntent,
): LessonRuntimeResult {
  // The only transition authority is this authored edge. No model-selected destination is read.
  const node = lesson.nodes[next.nodeId];
  const group = lesson.questionGroups?.find(group => group.nodeIds.includes(node.id));
  const intent = explicitIntent ?? next.navigationIntent;
  const skippedNodeIds =
    group && intent?.scope === "question" ? group.nodeIds.slice(group.nodeIds.indexOf(node.id) + 1) : [];
  // Jump only by walking authored sibling edges. Never read a destination from a command/model.
  const lastNode = skippedNodeIds.at(-1) ?? node.id;
  const edge = lesson.nodes[lastNode].onSuccess;
  const navigation: NavigationRecord | undefined = group
    ? {
        source: explicitIntent ? origin : (next.navigationSource ?? origin),
        questionId: group.questionId,
        intent: intent ?? "tutor_closure",
        hasChildTranscript: next.hasChildTranscript,
        skippedNodeIds,
        atMs: next.nowMs,
      }
    : undefined;
  const visitId = next.visitId + 1;
  const identity: RenderIdentity = {
    token: JSON.stringify([next.runtimeId, visitId]),
    nodeId: edge.kind === "node" ? edge.nodeId : null,
    sceneId: edge.kind === "node" ? String(lesson.nodes[edge.nodeId].presentation.sceneId ?? edge.nodeId) : null,
  };
  const conceptEvidence = { ...next.conceptEvidence };
  if (edge.kind === "node") {
    for (const criterionId of skippedNodeIds.length ? [] : (edge.carryForwardCriteria ?? [])) {
      const sourceRecord = conceptEvidence[conceptKey(node.id, criterionId)];
      if (sourceRecord?.status !== "demonstrated") continue;
      conceptEvidence[conceptKey(edge.nodeId, criterionId)] = { ...sourceRecord, criterionId };
    }
  }
  return {
    state: {
      ...next,
      ...clearedEvidence,
      ...clearedNavigation(next),
      ...(lesson.questionGroups ? { learnerUtterance: null } : {}),
      ...(next.rewriteProposals ? { rewriteTurn: null } : {}),
      // Keep delivery evidence until the terminal screen has actually committed;
      // resumed output can suspend that confirmation without closing the voice.
      ...(edge.kind === "complete" && node.completeAfterTutorOutput
        ? {
            tutorOutputObserved: next.tutorOutputObserved,
            tutorOutputDrained: next.tutorOutputDrained,
            quietSinceMs: next.quietSinceMs,
          }
        : {}),
      nodeId: edge.kind === "node" ? edge.nodeId : next.nodeId,
      visitId,
      hasChildTurn: false,
      hasChildTranscript: false,
      interruptedExchange: null,
      consumedRevision: null,
      phase: "rendering",
      lessonComplete: edge.kind === "complete",
      pendingRender: { identity, origin, ...(navigation ? { navigation } : {}) },
      conceptEvidence,
      ...(lesson.id === "mae386" ? { learnerTranscript: null } : {}),
    },
    effects: [{ type: "render.requested", identity }],
  };
}

export function reduceLessonRuntime(
  state: LessonRuntimeState,
  event: LessonRuntimeEvent,
  lesson: LessonDefinition,
): LessonRuntimeResult {
  const ignore = (reason: string): LessonRuntimeResult => ({
    state,
    effects: [],
    ...(event.type === "proposal.received"
      ? ({
          proposalConsumption: { consumption: "ignored", reason, accepted: null },
        } as const)
      : {}),
  });
  const ignored = ignore("runtime_event_ineligible");
  if (state.lessonId && state.lessonId !== lesson.id) return ignored;
  if (state.phase === "stopped" || state.phase === "complete" || !validTime(event.atMs) || event.atMs < state.nowMs)
    return ignored;
  if (event.type === "stop" || event.type === "disconnect") {
    return event.runtimeId === state.runtimeId
      ? { state: stopped({ ...state, nowMs: event.atMs }, lesson), effects: [] }
      : ignored;
  }
  const terminalRendering =
    state.phase === "rendering" && state.lessonComplete && lesson.nodes[state.nodeId].completeAfterTutorOutput;
  if (
    terminalRendering &&
    (event.type === "output.activity" || event.type === "clock.tick") &&
    (sameSource(state, event.source) || sameSource(state.pendingRender!.origin, event.source))
  ) {
    if (event.type === "output.activity") {
      if (event.state === state.outputActivity) return ignored;
      return {
        state: {
          ...state,
          nowMs: event.atMs,
          outputActivity: event.state,
          tutorOutputObserved: event.state === "active" || (event.state === "quiet" && state.tutorOutputObserved),
          tutorOutputDrained: false,
          quietSinceMs: event.state === "quiet" ? event.atMs : null,
        },
        effects: [],
      };
    }
    const next = { ...state, nowMs: event.atMs };
    if (state.tutorOutputDrained || !outputHasDrained(next, lesson)) return ignored;
    // Ask React to confirm again after fresh quiet. The old callback must not
    // acknowledge a later delivery boundary, even if its frame was delayed.
    const identity = {
      ...state.pendingRender!.identity,
      token: JSON.stringify([state.runtimeId, state.visitId, event.atMs]),
    };
    return {
      state: { ...next, tutorOutputDrained: true, pendingRender: { ...state.pendingRender!, identity } },
      effects: [{ type: "render.requested", identity }],
    };
  }
  if (event.type === "render.confirmed") {
    if (
      event.runtimeId !== state.runtimeId ||
      state.phase !== "rendering" ||
      !state.pendingRender ||
      !sameRender(state.pendingRender.identity, event.identity) ||
      (terminalRendering && (!state.tutorOutputDrained || !outputHasDrained({ ...state, nowMs: event.atMs }, lesson)))
    )
      return ignored;
    let next: LessonRuntimeState = {
      ...state,
      nowMs: event.atMs,
      phase: state.lessonComplete ? "complete" : "active",
      ...(state.pendingRender.navigation
        ? {
            navigationHistory: [...(state.navigationHistory ?? []), state.pendingRender.navigation],
          }
        : {}),
      pendingRender: null,
    };
    if (next.questionAttempts && !next.questionOutcomes && lesson.nodes[next.nodeId].completeAfterTutorOutput)
      next = { ...next, questionOutcomes: freezeQuestionOutcomes(lesson, next) };
    if (next.lessonComplete) {
      return { state: next, effects: [{ type: "lesson.completed", renderToken: event.identity.token }] };
    }
    const context = currentNodeContext(lesson, next.nodeId);
    return {
      state: next,
      effects: [
        {
          type: "steering.ready",
          renderToken: event.identity.token,
          // Explicit projection: never serialize the graph or future teaching context.
          context,
        },
      ],
    };
  }
  if (event.type === "scene.skipped") {
    if (lesson.nodes[state.nodeId].completeAfterTutorOutput) return ignored;
    if (
      state.phase !== "active" ||
      state.childSpeaking ||
      state.childCandidate !== null ||
      state.outputActivity !== "quiet" ||
      state.quietSinceMs === null ||
      event.atMs - state.quietSinceMs < state.quietDrainMs ||
      !sameSource(state, event.source)
    )
      return ignored;
    const origin: ClassificationSource = {
      ...event.source,
      nodeId: state.nodeId,
      transcriptRevision: state.transcriptRevision,
    };
    const edge = lesson.nodes[state.nodeId].onSuccess;
    if (
      state.questionObservations?.[state.nodeId]?.status === "pending" &&
      sameClassificationSource(state, state.questionObservations[state.nodeId].source) &&
      edge.kind === "node" &&
      lesson.nodes[edge.nodeId].completeAfterTutorOutput
    ) {
      return finish(
        {
          ...state,
          nowMs: event.atMs,
          conversationAdvanceRequested: "learner",
          navigationIntent: { action: "skip", scope: event.scope ?? "subpart" },
          navigationSource: origin,
        },
        lesson,
      );
    }
    const skipped: LessonRuntimeState = {
      ...state,
      ...clearedEvidence,
      ...clearedNavigation(state),
      nowMs: event.atMs,
      hasChildTurn: state.hasChildTurn,
      hasChildTranscript: state.hasChildTranscript,
      childSpeaking: false,
      childCandidate: null,
      consumedRevision: null,
      outputActivity: "unavailable",
      phase: "rendering",
      lessonComplete: false,
      pendingRender: null,
    };
    return requestAuthoredTransition(skipped, lesson, origin, { action: "skip", scope: event.scope ?? "subpart" });
  }
  if (event.type === "presentation.continued") {
    const quietDrained =
      state.tutorOutputObserved &&
      state.outputActivity === "quiet" &&
      state.quietSinceMs !== null &&
      event.atMs - state.quietSinceMs >= state.quietDrainMs;
    if (
      state.phase !== "active" ||
      !state.transitionReady ||
      state.childSpeaking ||
      state.childCandidate !== null ||
      !quietDrained ||
      !hasCurrentCompletionEvidence(state, lesson) ||
      !sameClassificationSource(state, event.source)
    )
      return ignored;
    return requestAuthoredTransition({ ...state, nowMs: event.atMs, tutorOutputDrained: true }, lesson, event.source);
  }
  // Media/transcript work from the previous visit cannot mutate a newly committed target.
  // Speech or a newly revised child transcript during rendering cancels old completion authority.
  if (
    state.phase === "rendering" &&
    (event.type === "child.turn.started" ||
      event.type === "child.candidate.started" ||
      (event.type === "output.activity" && event.state !== "quiet") ||
      (event.type === "transcript.updated" &&
        event.speaker !== "tutor" &&
        Number.isSafeInteger(event.revision) &&
        event.revision > state.transcriptRevision)) &&
    (sameSource(state, event.source) || sameSource(state.pendingRender!.origin, event.source))
  ) {
    // A delivered terminal recap is already committed. Microphone/transcript
    // callbacks cannot reopen it while React confirms the completion screen.
    // Terminal output is handled above by suspending render confirmation.
    if (state.lessonComplete && lesson.nodes[state.nodeId].completeAfterTutorOutput && event.type !== "output.activity")
      return ignored;
    return { state: stopped({ ...state, nowMs: event.atMs }, lesson), effects: [] };
  }
  if (state.phase !== "active" || !sameSource(state, event.source)) return ignore("inactive_or_source_mismatch");

  let next: LessonRuntimeState = { ...state, nowMs: event.atMs };
  let additionalEffects: LessonRuntimeEffect[] = [];
  let proposalReason: string | null = null;
  switch (event.type) {
    case "child.candidate.started":
    case "child.turn.started":
      if (event.type === "child.candidate.started" && state.childSpeaking) return ignored;
      if (
        event.type === "child.candidate.started" &&
        lesson.conversationFirst &&
        !lesson.nodes[state.nodeId].completeAfterTutorOutput
      ) {
        // Energy alone is not a new learner exchange. Preserve exact-source
        // classification and audio history, but block finish until resolved.
        next = {
          ...next,
          childSpeaking: true,
          childCandidate: {
            deferredTurn: true,
            hasChildTranscript: state.hasChildTranscript,
            tutorOutputObserved: state.tutorOutputObserved,
          },
        };
        break;
      }
      next = {
        ...next,
        ...clearedEvidence,
        ...clearedNavigation(state),
        tutorClosure: lesson.conversationFirst ? state.tutorClosure : null,
        // Terminal transcript/audio evidence belongs to this recap visit, not a
        // microphone turn. Activity blocks completion but is not new learner text.
        ...(lesson.nodes[state.nodeId].completeAfterTutorOutput
          ? {
              tutorOutputObserved: state.tutorOutputObserved,
              quietSinceMs: state.quietSinceMs,
              ...(event.type === "child.turn.started" ? { terminalLearnerPending: true } : {}),
            }
          : {}),
        interruptedExchange:
          lesson.conversationFirst && (state.hasChildTranscript || state.interruptedExchange)
            ? {
                tutorOutputObserved: state.tutorOutputObserved || !!state.interruptedExchange?.tutorOutputObserved,
                ready: false,
              }
            : null,
        childCandidate:
          event.type === "child.candidate.started"
            ? {
                hasChildTranscript: state.hasChildTranscript,
                tutorOutputObserved: state.tutorOutputObserved,
              }
            : null,
        ...(lesson.nodes[state.nodeId].currentRewrite
          ? {
              rewriteTurn: {
                source: { ...runtimeSource(state), childTurnId: state.childTurnId + 1 },
                prior: rewriteForCurrentVisit(state),
              },
            }
          : {}),
        childTurnId: state.childTurnId + 1,
        hasChildTurn: true,
        hasChildTranscript: false,
        childSpeaking: true,
        consumedRevision: null,
      };
      break;
    case "child.candidate.discarded":
      if (!state.childSpeaking || !state.childCandidate) return ignored;
      if (state.childCandidate.deferredTurn) {
        next = { ...next, childSpeaking: false, childCandidate: null };
        break;
      }
      next = {
        ...next,
        ...clearedEvidence,
        ...clearedNavigation(state),
        hasChildTranscript: state.childCandidate.hasChildTranscript,
        tutorOutputObserved: state.childCandidate.tutorOutputObserved,
        // Recap output quiet is independent of microphone activity. Other nodes
        // still need fresh quiet and classification after a discarded candidate.
        quietSinceMs: lesson.nodes[state.nodeId].completeAfterTutorOutput
          ? state.quietSinceMs
          : state.childCandidate.tutorOutputObserved && state.outputActivity === "quiet"
            ? event.atMs
            : null,
        childSpeaking: false,
        childCandidate: null,
        consumedRevision: null,
      };
      break;
    case "child.turn.confirmed":
      if (!state.childSpeaking || !state.childCandidate) return ignored;
      if (state.childCandidate.deferredTurn)
        return reduceLessonRuntime(state, { ...event, type: "child.turn.started" }, lesson);
      next = {
        ...next,
        childCandidate: null,
        ...(lesson.nodes[state.nodeId].completeAfterTutorOutput
          ? { terminalLearnerPending: !state.hasChildTranscript }
          : {}),
      };
      break;
    case "child.turn.ended":
      if (!state.childSpeaking) return ignored;
      next = { ...next, childSpeaking: false, childCandidate: null };
      if (lesson.nodes[state.nodeId].currentRewrite && state.hasChildTranscript) {
        const projection = state.rewriteProposals?.[state.nodeId];
        if (projection)
          next = {
            ...next,
            rewriteProposals: {
              ...state.rewriteProposals,
              [state.nodeId]: {
                ...projection,
                current: controlRewritePrior(
                  state,
                  state.learnerUtterance && sameSource(state, state.learnerUtterance.source)
                    ? state.learnerUtterance.text
                    : undefined,
                ),
              },
            },
          };
      }
      break;
    case "transcript.updated": {
      if (!Number.isSafeInteger(event.revision) || event.revision <= state.transcriptRevision) return ignored;
      if (event.speaker === "child" && state.childCandidate?.deferredTurn) {
        const confirmed = reduceLessonRuntime(state, { ...event, type: "child.turn.started" }, lesson).state;
        return reduceLessonRuntime(confirmed, { ...event, source: runtimeSource(confirmed) }, lesson);
      }
      const exchange =
        lesson.conversationFirst && event.speaker === "child" ? closingTutorExchange(event.transcriptSnapshot) : null;
      const closure = matchesTutorClosure(exchange, state.tutorClosure) ? state.tutorClosure : null;
      if (lesson.id === "mae386" && !lesson.nodes[state.nodeId].currentRewrite) {
        next = {
          ...next,
          learnerTranscript:
            event.learnerTranscript?.text === event.transcriptSnapshot ? event.learnerTranscript : null,
        };
      }
      if (lesson.nodes[state.nodeId].currentRewrite) {
        next = {
          ...next,
          rewriteTranscript: event.transcriptSnapshot
            ? {
                text: event.transcriptSnapshot,
                turns: event.rewriteTranscript?.text === event.transcriptSnapshot ? event.rewriteTranscript.turns : [],
              }
            : null,
          rewriteProposals: {
            ...state.rewriteProposals,
            [state.nodeId]: {
              revision: event.revision,
              current:
                event.speaker === "tutor"
                  ? (state.rewriteProposals?.[state.nodeId]?.current ?? null)
                  : event.speaker === "child" && state.hasChildTurn && !state.childSpeaking
                    ? controlRewritePrior(state, event.learnerTurnText)
                    : null,
              history: state.rewriteProposals?.[state.nodeId]?.history ?? [],
            },
          },
        };
      }
      next = {
        ...next,
        ...(event.speaker === "tutor" ? {} : { ...clearedEvidence, ...clearedNavigation(state) }),
        tutorClosure: closure,
        ...((lesson.questionGroups || lesson.calculus) && event.speaker !== "tutor"
          ? {
              learnerUtterance:
                event.speaker === "child" && state.hasChildTurn && event.learnerTurnText !== undefined
                  ? {
                      text: event.learnerTurnText,
                      source: { ...event.source, nodeId: state.nodeId, transcriptRevision: event.revision },
                    }
                  : null,
            }
          : {}),
        // A brief acknowledgment belongs to the preceding exchange. Keep its
        // observed audio even when classification of the close is still in flight.
        ...(exchange
          ? {
              tutorOutputObserved: state.tutorOutputObserved || !!state.interruptedExchange?.tutorOutputObserved,
              quietSinceMs: state.outputActivity === "quiet" ? (state.quietSinceMs ?? event.atMs) : null,
            }
          : {}),
        childCandidate: event.speaker === "tutor" ? state.childCandidate : null,
        interruptedExchange: event.speaker === "tutor" ? state.interruptedExchange : null,
        transcriptRevision: event.revision,
        transcriptSource: event.speaker,
        hasChildTranscript:
          event.speaker === "child" ? state.hasChildTurn : event.speaker === "tutor" && state.hasChildTranscript,
        consumedRevision: null,
        conversationAdvanceRequested:
          event.speaker === "tutor" && state.conversationAdvanceRequested === "learner"
            ? "learner"
            : closure && exchange?.complete
              ? "tutor"
              : false,
        // Tutor wording does not retract counting evidence. New learner speech
        // always clears acceptance until its exact current source is evaluated.
        answerAccepted: acceptsLearnerAnswerIndependently(lesson) && event.speaker === "tutor" && state.answerAccepted,
        acknowledgmentObserved: false,
        ...(lesson.nodes[state.nodeId].completeAfterTutorOutput ? { terminalTranscriptComplete: false } : {}),
        ...(lesson.nodes[state.nodeId].completeAfterTutorOutput && event.speaker === "child"
          ? { terminalLearnerPending: false }
          : {}),
      };
      break;
    }
    case "conversation.recheck.requested": {
      const exchange = closingTutorExchange(event.transcriptSnapshot);
      if (
        !lesson.conversationFirst ||
        !sameClassificationSource(state, event.source) ||
        state.childSpeaking ||
        state.childCandidate ||
        state.hasChildTranscript ||
        !state.interruptedExchange?.tutorOutputObserved ||
        (state.transcriptSource !== "tutor" && !exchange?.complete) ||
        state.outputActivity !== "quiet"
      )
        return ignored;
      next = {
        ...next,
        interruptedExchange: { ...state.interruptedExchange, ready: true },
        tutorOutputObserved: true,
        quietSinceMs: event.atMs,
        // Microphone-only activity suspends progression, but does not revoke a
        // classified close of this unchanged exchange. New substantive words or
        // tutor output already invalidate tutorClosure in transcript.updated.
        conversationAdvanceRequested:
          exchange?.complete && matchesTutorClosure(exchange, state.tutorClosure)
            ? "tutor"
            : state.conversationAdvanceRequested,
        // Without a retained close, require a fresh exact-source proposal.
        consumedRevision: null,
      };
      break;
    }
    case "conversation.advance.requested": {
      const appCompleted = lesson.calculus && event.appCompleted;
      const intent: NavigationIntent | null = appCompleted
        ? { action: "next", scope: "subpart" }
        : lesson.questionGroups || lesson.calculus
          ? parseLearnerNavigationText(state.learnerUtterance?.text ?? "")
          : learnerNavigationIntent(event.transcriptSnapshot);
      if (
        !lesson.conversationFirst ||
        !sameClassificationSource(state, event.source) ||
        state.childSpeaking ||
        !intent ||
        (event.intent && (event.intent.action !== intent.action || event.intent.scope !== intent.scope))
      )
        return ignored;
      next = {
        ...next,
        conversationAdvanceRequested: "learner",
        ...(lesson.questionGroups || lesson.calculus
          ? { navigationIntent: intent, navigationSource: appCompleted ? event.source : state.learnerUtterance!.source }
          : {}),
        quietSinceMs:
          state.outputActivity === "quiet"
            ? state.conversationAdvanceRequested === "learner"
              ? (state.quietSinceMs ?? event.atMs)
              : event.atMs
            : null,
      };
      break;
    }
    case "proposal.received": {
      if (lesson.calculus) return ignore("calculus_uses_reviewed_math_actions");
      const proposal = parseConversationStateProposal(event.proposal);
      const currentNode = lesson.nodes[state.nodeId];
      if (
        (state.childSpeaking && !state.childCandidate?.deferredTurn) ||
        (!state.hasChildTranscript && !(lesson.conversationFirst && state.interruptedExchange?.ready)) ||
        !proposal ||
        !isLessonNodeId(lesson, proposal.nodeId)
      )
        return ignore("proposal_guard_rejected");
      if (event.source.nodeId !== state.nodeId || event.source.transcriptRevision !== state.transcriptRevision)
        return ignore("classification_source_mismatch");
      if (
        proposal.nodeId !== state.nodeId ||
        (currentNode.currentRewrite &&
          proposal.currentRewrite &&
          state.rewriteTranscript?.text !== event.transcriptSnapshot) ||
        (currentNode.concepts?.length &&
          (!proposal.conceptObservations ||
            proposal.conceptObservations.some(
              observation => !currentNode.concepts?.some(concept => concept.id === observation.criterionId),
            ) ||
            !event.transcriptSnapshot ||
            !transcriptMessages(event.transcriptSnapshot)?.some(
              message => message.speaker === "Child" && message.text.trim(),
            ))) ||
        proposal.transcriptRevision !== state.transcriptRevision
      )
        return ignore("proposal_guard_rejected");
      if (state.consumedRevision === state.transcriptRevision) return ignore("revision_already_consumed");
      next = { ...next, consumedRevision: state.transcriptRevision };
      // A textless turn is not evidence. MAE386 rechecks may assess previously
      // authenticated words in the exact current-visit snapshot, with null
      // conceptual turn identity rather than crediting the microphone-only turn.
      const historicalRecheck =
        lesson.id === "mae386" && !state.hasChildTranscript && !!state.interruptedExchange?.ready;
      const historicalTranscript = currentNode.currentRewrite ? state.rewriteTranscript : state.learnerTranscript;
      const historicalWords =
        historicalRecheck && historicalTranscript && historicalTranscript.text === event.transcriptSnapshot
          ? rewriteWords(event.transcriptSnapshot ?? "").filter(word =>
              historicalTranscript.turns.some(
                turn =>
                  turn.messageIndex === word.messageIndex &&
                  turn.start <= word.start &&
                  turn.end >= word.end &&
                  Number.isSafeInteger(turn.childTurnId) &&
                  turn.childTurnId > 0,
              ),
            )
          : [];
      const historicalObservations = historicalRecheck
        ? proposal.conceptObservations?.filter(observation => {
            const start = observation.childMessageIndex;
            if (start === null || start === undefined) return false;
            const end = observation.childMessageEndIndex ?? start;
            const selected = rewriteWords(event.transcriptSnapshot ?? "").filter(
              word => word.messageIndex >= start && word.messageIndex <= end,
            );
            return selected.length > 0 && selected.every(word => historicalWords.some(auth => auth.id === word.id));
          })
        : undefined;
      const evidenceMessages = transcriptMessages(event.transcriptSnapshot ?? "") ?? [];
      const content = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
      const eligibleText = (text: string, index: number) =>
        substantiveLearnerText(text) &&
        !parseLearnerNavigationText(text) &&
        !isLearnerStopText(text) &&
        content(text) !== content(String(currentNode.presentation.sourceText ?? "")) &&
        !evidenceMessages
          .slice(0, index)
          .some(message => message.speaker === "Tutor" && content(message.text).includes(content(text)));
      const observations = next.questionAttempts
        ? proposal.conceptObservations?.filter(observation => {
            const start = observation.childMessageIndex;
            if (start === null) return false;
            if (start === undefined)
              return (
                evidenceMessages.filter(
                  (message, index) => message.speaker === "Child" && eligibleText(message.text, index),
                ).length === 1
              );
            return evidenceMessages
              .slice(start, (observation.childMessageEndIndex ?? start) + 1)
              .some((message, offset) => message.speaker === "Child" && eligibleText(message.text, start + offset));
          })
        : proposal.conceptObservations;
      const conceptResult =
        state.hasChildTranscript || historicalObservations?.length
          ? applyConceptObservations(
              next.conceptEvidence,
              currentNode,
              historicalRecheck ? { ...event.source, childTurnId: null } : event.source,
              historicalRecheck
                ? historicalObservations?.filter(observation => observations?.includes(observation))
                : observations,
              event.transcriptSnapshot,
              lesson.id === "mae386" && !currentNode.currentRewrite ? mae386NeutralBackchannel : undefined,
            )
          : { conceptEvidence: next.conceptEvidence, effects: [] };
      if (conceptResult.conceptEvidence !== next.conceptEvidence)
        next = { ...next, conceptEvidence: conceptResult.conceptEvidence };
      if (
        currentNode.currentRewrite &&
        (state.hasChildTranscript || historicalWords.length > 0) &&
        proposal.currentRewrite &&
        state.rewriteTranscript?.text === event.transcriptSnapshot
      ) {
        const attempt = projectRewrite(
          proposal.currentRewrite,
          event.source,
          event.transcriptSnapshot!,
          state.rewriteTranscript,
          String(currentNode.presentation.sourceText),
        );
        next = {
          ...next,
          rewriteProposals: {
            ...next.rewriteProposals,
            [currentNode.id]: {
              revision: event.source.transcriptRevision,
              current: attempt,
              history: [...(state.rewriteProposals?.[currentNode.id]?.history ?? []), attempt],
            },
          },
        };
      }
      if (next.questionAttempts && state.hasChildTranscript && !currentNode.currentRewrite) {
        const utterance = state.learnerUtterance;
        const text = utterance?.text.trim();
        const messages = transcriptMessages(event.transcriptSnapshot ?? "") ?? [];
        const normalized = (value: string) => (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
        const sourceText = String(currentNode.presentation.sourceText ?? "");
        const authentic =
          utterance &&
          sameSource(state, utterance.source) &&
          text &&
          messages.some(message => message.speaker === "Child" && message.text.includes(text));
        if (
          authentic &&
          substantiveLearnerText(text) &&
          !parseLearnerNavigationText(text) &&
          !isLearnerStopText(text) &&
          normalized(text) !== normalized(sourceText) &&
          !messages
            .slice(
              0,
              messages.findLastIndex(message => message.speaker === "Child" && message.text.includes(text)),
            )
            .some(message => message.speaker === "Tutor" && normalized(message.text).includes(normalized(text))) &&
          proposal.answerOutcome !== "none"
        ) {
          next = {
            ...next,
            questionAttempts: {
              ...next.questionAttempts,
              [next.nodeId]: [
                ...(next.questionAttempts[next.nodeId] ?? []),
                { source: event.source, text, outcome: proposal.answerOutcome },
              ],
            },
          };
        }
      }
      additionalEffects = conceptResult.effects;
      if (lesson.conversationFirst) {
        const exchange = closingTutorExchange(event.transcriptSnapshot);
        const tutorClosed = tutorAcknowledgedClosure(proposal.tutorState, state.transcriptSource, exchange);
        next = {
          ...next,
          tutorClosure:
            tutorClosed && exchange
              ? { messageIndex: exchange.messageIndex, text: exchange.text, source: event.source }
              : null,
          conversationAdvanceRequested:
            next.conversationAdvanceRequested === "learner" ? "learner" : tutorClosed ? "tutor" : false,
        };
        break;
      }
      if (
        proposal.answerOutcome !== "correct" ||
        (acceptsLearnerAnswerIndependently(lesson) && proposal.answerCommitment !== "committed") ||
        proposal.supportState !== "none" ||
        proposal.childActivity === "answering"
      ) {
        next = { ...next, ...clearedEvidence, ...clearedNavigation(state) };
        proposalReason =
          acceptsLearnerAnswerIndependently(lesson) && proposal.answerCommitment !== "committed"
            ? "uncommitted_answer_judgment"
            : "nonqualifying_answer_judgment";
        break;
      }
      next = {
        ...next,
        answerAccepted: true,
        acceptedAnswerRevision: state.acceptedAnswerRevision ?? state.transcriptRevision,
        // This exact tutor snapshot includes the current turn's child answer and subsequent tutor message.
        // It can establish both semantics even if an earlier child-only classification was superseded.
        acknowledgmentObserved: state.transcriptSource === "tutor" && proposal.tutorState === "acknowledging",
      };
      break;
    }
    case "output.activity":
      next = { ...next, outputActivity: event.state };
      if (state.interruptedExchange) {
        next = {
          ...next,
          interruptedExchange: {
            ...state.interruptedExchange,
            tutorOutputObserved:
              event.state !== "unavailable" &&
              (state.interruptedExchange.tutorOutputObserved || event.state === "active"),
          },
        };
      }
      if (state.childCandidate) {
        const candidate = state.childCandidate;
        const observed =
          event.state !== "unavailable" &&
          (candidate.tutorOutputObserved ||
            (event.state === "active" &&
              state.outputActivity !== "active" &&
              (candidate.hasChildTranscript || lesson.nodes[state.nodeId].completeAfterTutorOutput === true)));
        next = {
          ...next,
          childCandidate: {
            ...candidate,
            tutorOutputObserved: observed,
          },
        };
      }
      if (event.state === "unavailable") {
        next = { ...next, tutorOutputObserved: false, quietSinceMs: null };
      } else if (event.state === "active") {
        next = {
          ...next,
          // Anchor a fresh onset to the ended child turn, independent of classifier latency.
          // Already-active pre-turn/during-child PCM cannot become relevant by remaining active.
          tutorOutputObserved:
            state.tutorOutputObserved ||
            (state.outputActivity !== "active" &&
              (state.hasChildTranscript ||
                state.interruptedExchange?.ready === true ||
                lesson.nodes[state.nodeId].completeAfterTutorOutput === true) &&
              (!state.childSpeaking || lesson.nodes[state.nodeId].completeAfterTutorOutput === true)),
          quietSinceMs: null,
        };
      } else if (state.quietSinceMs === null) {
        // A quiet observation can authorize an explicit skip after sustained
        // drain even when there was no accepted answer. Normal completion still
        // separately requires relevant tutor output to have been observed.
        next = { ...next, quietSinceMs: event.atMs };
      }
      break;
    case "terminal.transcript.checked":
      if (lesson.nodes[state.nodeId].completeAfterTutorOutput)
        next = {
          ...next,
          terminalTranscriptComplete: event.complete,
          quietSinceMs: next.outputActivity === "quiet" ? event.atMs : null,
        };
      break;
    case "terminal.learner.resolved":
      if (
        !lesson.nodes[state.nodeId].completeAfterTutorOutput ||
        !state.terminalLearnerPending ||
        state.childSpeaking ||
        state.hasChildTranscript ||
        state.outputActivity !== "quiet"
      )
        return ignored;
      next = { ...next, terminalLearnerPending: false };
      break;
    case "question.observation":
      if (!next.questionObservations || !sameClassificationSource(state, event.source)) return ignored;
      next = {
        ...next,
        questionObservations: {
          ...next.questionObservations,
          [next.nodeId]: { source: event.source, status: event.status },
        },
      };
      break;
    case "clock.tick":
      break;
  }
  // Only a complete authenticated turn can leave unreviewed words behind.
  // Interim command prefixes while speaking must never create answer uncertainty.
  if (
    next.questionObservations &&
    !next.childSpeaking &&
    (event.type === "child.turn.ended" || (event.type === "transcript.updated" && event.speaker === "child"))
  ) {
    const utterance = next.learnerUtterance;
    if (utterance && sameSource(next, utterance.source)) {
      const words = utterance.text;
      const content = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
      const observations = { ...next.questionObservations };
      const prior = observations[next.nodeId];
      const control = parseLearnerNavigationText(words) || isLearnerStopText(words);
      if (
        substantiveLearnerText(words) &&
        !control &&
        content(words) !== content(String(lesson.nodes[next.nodeId].presentation.sourceText ?? ""))
      ) {
        observations[next.nodeId] = { source: utterance.source, status: "unreviewed" };
      } else if (prior && sameSource(next, prior.source) && prior.status !== "settled") {
        // A late full-turn revision can complete control-only speech after an
        // earlier fragment ended. It grants no attempted-answer history.
        delete observations[next.nodeId];
      }
      next = { ...next, questionObservations: observations };
    }
  }
  const result = finish(next, lesson);
  return {
    ...result,
    effects: [...additionalEffects, ...result.effects],
    ...(event.type === "proposal.received"
      ? ({
          proposalConsumption: {
            consumption: "consumed",
            reason: proposalReason,
            accepted: {
              answerAccepted: next.answerAccepted,
              acceptedAnswerRevision: next.acceptedAnswerRevision,
              acknowledgmentObserved: next.acknowledgmentObserved,
              conceptEvidence: next.conceptEvidence,
            },
          },
        } as const)
      : {}),
  };
}
