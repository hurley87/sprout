import type { OutputActivityEvent } from "../events";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import { currentNodeContext, isLessonNodeId, type LessonDefinition } from "./lesson-definition";
import { transcriptMessages } from "./tutor-observation";
import {
  learnerNavigationIntent,
  parseLearnerNavigationText,
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
  /** Session-local evidence; a new runtime always starts empty. */
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
export type LessonRuntimeResult = {
  readonly state: LessonRuntimeState;
  readonly effects: readonly LessonRuntimeEffect[];
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
  if (lesson.conversationFirst) return hasConversationCompletionEvidence(state);
  return (
    state.hasChildTranscript &&
    state.transcriptSource === "tutor" &&
    state.consumedRevision === state.transcriptRevision &&
    state.acceptedAnswerRevision !== null &&
    state.answerAccepted &&
    state.acknowledgmentObserved &&
    meetsAuthoredCompletionPolicy(state, lesson)
  );
}

function sameRender(expected: RenderIdentity, actual: RenderIdentity) {
  return expected.token === actual.token && expected.nodeId === actual.nodeId && expected.sceneId === actual.sceneId;
}

/** Cancel an unconfirmed transition. A new runtime/render is required to resume after interruption. */
function stopped(state: LessonRuntimeState): LessonRuntimeState {
  return {
    ...state,
    ...clearedEvidence,
    ...clearedNavigation(state),
    nodeId: state.pendingRender?.origin.nodeId ?? state.nodeId,
    phase: "stopped",
    lessonComplete: state.pendingRender ? false : state.lessonComplete,
    pendingRender: null,
    outputActivity: "unavailable",
    childSpeaking: false,
    childCandidate: null,
    interruptedExchange: null,
  };
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
    },
    effects: [{ type: "render.requested", identity }],
  };
}

export function reduceLessonRuntime(
  state: LessonRuntimeState,
  event: LessonRuntimeEvent,
  lesson: LessonDefinition,
): LessonRuntimeResult {
  const ignored = { state, effects: [] };
  if (state.lessonId && state.lessonId !== lesson.id) return ignored;
  if (state.phase === "stopped" || state.phase === "complete" || !validTime(event.atMs) || event.atMs < state.nowMs)
    return ignored;
  if (event.type === "stop" || event.type === "disconnect") {
    return event.runtimeId === state.runtimeId
      ? { state: stopped({ ...state, nowMs: event.atMs }), effects: [] }
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
    const next: LessonRuntimeState = {
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
    return { state: stopped({ ...state, nowMs: event.atMs }), effects: [] };
  }
  if (state.phase !== "active" || !sameSource(state, event.source)) return ignored;

  let next: LessonRuntimeState = { ...state, nowMs: event.atMs };
  let additionalEffects: LessonRuntimeEffect[] = [];
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
      next = {
        ...next,
        ...(event.speaker === "tutor" ? {} : { ...clearedEvidence, ...clearedNavigation(state) }),
        tutorClosure: closure,
        ...(lesson.questionGroups && event.speaker !== "tutor"
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
        // Answer acceptance remains revision-bound, independently of conversational closure.
        answerAccepted: false,
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
      const intent = lesson.questionGroups
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
        ...(lesson.questionGroups
          ? { navigationIntent: intent, navigationSource: state.learnerUtterance!.source }
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
      const proposal = parseConversationStateProposal(event.proposal);
      const currentNode = lesson.nodes[state.nodeId];
      if (
        (state.childSpeaking && !state.childCandidate?.deferredTurn) ||
        (!state.hasChildTranscript && !(lesson.conversationFirst && state.interruptedExchange?.ready)) ||
        !proposal ||
        !isLessonNodeId(lesson, proposal.nodeId) ||
        event.source.nodeId !== state.nodeId ||
        event.source.transcriptRevision !== state.transcriptRevision ||
        proposal.nodeId !== state.nodeId ||
        (currentNode.concepts?.length &&
          (!proposal.conceptObservations ||
            proposal.conceptObservations.some(
              observation => !currentNode.concepts?.some(concept => concept.id === observation.criterionId),
            ) ||
            !event.transcriptSnapshot ||
            !transcriptMessages(event.transcriptSnapshot)?.some(
              message => message.speaker === "Child" && message.text.trim(),
            ))) ||
        proposal.transcriptRevision !== state.transcriptRevision ||
        state.consumedRevision === state.transcriptRevision
      )
        return ignored;
      next = { ...next, consumedRevision: state.transcriptRevision };
      // A missing-turn recheck can establish conversational closure only. Do not
      // attribute historical child words or new mastery to the microphone-only turn.
      const conceptResult = state.hasChildTranscript
        ? applyConceptObservations(
            next.conceptEvidence,
            currentNode,
            event.source,
            proposal.conceptObservations,
            event.transcriptSnapshot,
          )
        : { conceptEvidence: next.conceptEvidence, effects: [] };
      if (conceptResult.conceptEvidence !== next.conceptEvidence)
        next = { ...next, conceptEvidence: conceptResult.conceptEvidence };
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
        proposal.supportState !== "none" ||
        proposal.childActivity === "answering"
      ) {
        next = { ...next, ...clearedEvidence, ...clearedNavigation(state) };
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
    case "clock.tick":
      break;
  }
  const result = finish(next, lesson);
  return { ...result, effects: [...additionalEffects, ...result.effects] };
}
