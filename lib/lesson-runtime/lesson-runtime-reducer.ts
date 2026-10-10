import type { OutputActivityEvent } from "../events";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import { currentNodeContext, isLessonNodeId, satisfiesConceptCompletion, type LessonNodeDefinition, type LessonDefinition } from "./lesson-definition";
import { transcriptMessages, substantiveLearnerText } from "./tutor-observation";

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
  readonly completionPolicy?: LessonNodeDefinition["completionPolicy"];
};
export type ConceptEvidenceReference = {
  readonly runtimeId: string;
  readonly nodeId: string;
  readonly visitId: number;
  /** null for a historical utterance first seen in a later turn's snapshot. */
  readonly childTurnId: number | null;
  /** Revision where this exact quote was recorded, not a fabricated utterance timestamp. */
  readonly transcriptRevision: number;
  readonly childMessageIndex: number;
  readonly childTranscript: string;
};
export type ConceptEvidenceRecord = {
  readonly criterionId: string;
  readonly status: "not_yet" | "partial" | "demonstrated";
  readonly understanding: "independent" | "prompted" | null;
  /** Advisory progress, never accepted demonstration or reveal authority. */
  readonly tentative?: boolean;
  readonly source: ConceptEvidenceReference | null;
  readonly promptingHistory: readonly {
    readonly source: ConceptEvidenceReference;
    readonly prompted: boolean | null;
  }[];
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
  /** Eligibility/audio only, never semantic authority; discarded onset requires fresh classification. */
  readonly childCandidate: {
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
  readonly quietSinceMs: number | null;
  readonly quietDrainMs: number;
  readonly nowMs: number;
  readonly phase: "active" | "rendering" | "complete" | "stopped";
  readonly lessonComplete: boolean;
  /** True when accepted evidence is ready to advance after an application-owned review action. */
  readonly transitionReady: boolean;
  readonly conversationAdvanceRequested?: "learner" | "tutor" | false;
  /** Session-local evidence; a new runtime always starts empty. */
  readonly conceptEvidence: Readonly<Record<string, ConceptEvidenceRecord>>;
  readonly pendingRender: {
    readonly identity: RenderIdentity;
    readonly origin: ClassificationSource;
  } | null;
};

/** atMs uses one local monotonic clock. The reducer has no timers or provider side effects. */
export type LessonRuntimeEvent = { readonly atMs: number } & (
  | { readonly type: "child.turn.started"; readonly source: RuntimeSource }
  | { readonly type: "child.candidate.started"; readonly source: RuntimeSource }
  | { readonly type: "child.candidate.discarded"; readonly source: RuntimeSource }
  | { readonly type: "child.turn.confirmed"; readonly source: RuntimeSource }
  | { readonly type: "conversation.recheck.requested"; readonly source: ClassificationSource }
  | { readonly type: "child.turn.ended"; readonly source: RuntimeSource }
  | {
      readonly type: "transcript.updated";
      readonly source: RuntimeSource;
      readonly revision: number;
      readonly speaker: "child" | "tutor" | "unknown";
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
    }
  | { readonly type: "clock.tick"; readonly source: RuntimeSource }
  | { readonly type: "render.confirmed"; readonly runtimeId: string; readonly identity: RenderIdentity }
  | { readonly type: "scene.skipped"; readonly source: RuntimeSource }
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
  | { readonly type: "concept.revealed"; readonly nodeId: string; readonly criterionId: string };
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
} as const;

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
    conceptEvidence: {},
    pendingRender: null,
  };
}

/** Recognize a bounded navigation utterance, including conversational fillers.
 * Never search arbitrarily inside an answer, quotation, or reported speech. */
export function learnerRequestedNext(transcript: string) {
  const text = transcriptMessages(transcript)
    ?.findLast(message => message.speaker === "Child")
    ?.text.trim()
    .replace(/\s+/gu, " ");
  if (!text) return false;
  const request =
    /^(?:please[,.]?\s+)?(?:(?:let['’]s|can we|could we|i(?:['’]d| would) like to)\s+)?(?:(?:can|could) i (?:have|get) (?:the )?next question|i(?:['’]d| would) like (?:the )?next question|let['’]s do (?:the )?next question|next question(?:,? then)?|(?:go|move|skip)(?: on)? to (?:the )?next(?: question)?|move on|skip (?:this|the)(?: question)?)(?:[.!?]|,? please)?$/iu;
  const normalized = text
    .replace(/^(?:(?:yes|yeah|yep|okay|ok|well|um|i am)[,.]?\s+)+/iu, "")
    .replace(/^i think\s+/iu, "")
    .replace(/[.!]\s+i(?: think i)?(?: have|['’]ve) answered (?:this|that)(?: question)?[.!]?$/iu, "");
  return request.test(normalized);
}

export function runtimeSource(state: LessonRuntimeState): RuntimeSource {
  return { runtimeId: state.runtimeId, visitId: state.visitId, childTurnId: state.childTurnId };
}

/** Capture alongside the exact transcript snapshot before awaiting a classification. */
export function classificationSource(state: LessonRuntimeState): ClassificationSource | null {
  if (state.phase !== "active" || state.childSpeaking || (!state.hasChildTranscript && !state.interruptedExchange?.ready)) return null;
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
  return satisfiesConceptCompletion(node, criterionId => {
    const evidence = state.conceptEvidence[conceptKey(node.id, criterionId)];
    return (
      evidence?.status === "demonstrated" &&
      (node.completionPolicy !== "all_independent" || evidence.understanding === "independent")
    );
  });
}

export function hasCurrentCompletionEvidence(state: LessonRuntimeState, lesson: LessonDefinition) {
  if (lesson.conversationFirst)
    return (
      state.conversationAdvanceRequested === "learner" ||
      ((state.hasChildTranscript || state.interruptedExchange?.ready) && state.conversationAdvanceRequested === "tutor")
    );
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

function finish(state: LessonRuntimeState, lesson: LessonDefinition): LessonRuntimeResult {
  const drained =
    (state.tutorOutputObserved ||
      (lesson.conversationFirst === true && state.conversationAdvanceRequested === "learner")) &&
    state.outputActivity === "quiet" &&
    state.quietSinceMs !== null &&
    state.nowMs - state.quietSinceMs >= state.quietDrainMs;
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
): LessonRuntimeResult {
  // The only transition authority is this authored edge. No model-selected destination is read.
  const node = lesson.nodes[next.nodeId];
  const edge = lesson.nodes[next.nodeId].onSuccess;
  const visitId = next.visitId + 1;
  const identity: RenderIdentity = {
    token: JSON.stringify([next.runtimeId, visitId]),
    nodeId: edge.kind === "node" ? edge.nodeId : null,
    sceneId: edge.kind === "node" ? String(lesson.nodes[edge.nodeId].presentation.sceneId ?? edge.nodeId) : null,
  };
  const conceptEvidence = { ...next.conceptEvidence };
  if (edge.kind === "node") {
    for (const criterionId of edge.carryForwardCriteria ?? []) {
      const sourceRecord = conceptEvidence[conceptKey(node.id, criterionId)];
      if (sourceRecord?.status !== "demonstrated") continue;
      conceptEvidence[conceptKey(edge.nodeId, criterionId)] = { ...sourceRecord, criterionId };
    }
  }
  return {
    state: {
      ...next,
      ...clearedEvidence,
      nodeId: edge.kind === "node" ? edge.nodeId : next.nodeId,
      visitId,
      hasChildTurn: false,
      hasChildTranscript: false,
      interruptedExchange: null,
      consumedRevision: null,
      phase: "rendering",
      lessonComplete: edge.kind === "complete",
      pendingRender: { identity, origin },
      conceptEvidence,
    },
    effects: [{ type: "render.requested", identity }],
  };
}

const conceptKey = (nodeId: string, criterionId: string) => `${nodeId}:${criterionId}`;

function echoedByTutor(childText: string, tutorTexts: readonly string[]) {
  const tokens = (value: string): string[] => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const child = tokens(childText);
  if (!child.length) return false;
  const childPhrase = child.join(" ");
  return tutorTexts.some(text => {
    // Tutor questions commonly contain the answer choices or the concept vocabulary.
    // Compare against declarative utterances only, and require copied words in order.
    const statements = text.split(/(?<=[.!?])\s+/u).filter(statement => !statement.trimEnd().endsWith("?"));
    return statements.some(statement => {
      const tutor = tokens(statement);
      if (!tutor.length) return false;
      if (childPhrase === tutor.join(" ")) return true;
      // A single shared word is too common to establish copying unless it was the
      // tutor's complete utterance. Multiword answer phrases must occur contiguously.
      if (child.length < 2 || child.length > tutor.length) return false;
      return tutor.some((_, index) => tutor.slice(index, index + child.length).join(" ") === childPhrase);
    });
  });
}

function applyConceptObservations(
  state: LessonRuntimeState,
  lesson: LessonDefinition,
  source: ClassificationSource,
  proposal: NonNullable<ReturnType<typeof parseConversationStateProposal>>,
  transcriptSnapshot: string | undefined,
): { state: LessonRuntimeState; effects: LessonRuntimeEffect[] } {
  const node = lesson.nodes[state.nodeId];
  if (!node.concepts?.length || !proposal.conceptObservations?.length || !transcriptSnapshot)
    return { state, effects: [] };
  const messages = transcriptMessages(transcriptSnapshot);
  if (!messages) return { state, effects: [] };
  const candidates = messages.flatMap((message, index) =>
    message.speaker === "Child" && substantiveLearnerText(message.text) ? [index] : [],
  );
  const evidence = { ...state.conceptEvidence };
  const effects: LessonRuntimeEffect[] = [];
  for (const observation of proposal.conceptObservations) {
    if (!node.concepts.some(concept => concept.id === observation.criterionId)) continue;
    const key = conceptKey(node.id, observation.criterionId);
    const previous = evidence[key];
    // Absence has no supporting utterance and is never an independent attempt.
    if (observation.observation === "not_yet") {
      evidence[key] = previous ?? {
        criterionId: observation.criterionId, status: "not_yet", understanding: null,
        source: null, promptingHistory: [],
      };
      continue;
    }
    // Legacy proposals may identify a source only when there is one substantive
    // learner utterance. Never guess the latest answer in a cumulative snapshot.
    const childMessageIndex = observation.childMessageIndex === undefined
      ? candidates.length === 1 ? candidates[0] : null
      : observation.childMessageIndex;
    if (childMessageIndex === null || !candidates.includes(childMessageIndex)) continue;
    const childTranscript = messages[childMessageIndex].text.trim();
    const tutorTexts = messages.slice(0, childMessageIndex)
      .filter(message => message.speaker === "Tutor").map(message => message.text);
    const echoed = echoedByTutor(childTranscript, tutorTexts);
    const tentative = observation.observation === "partial_uncertain";
    let status: ConceptEvidenceRecord["status"] =
      observation.observation === "partial" || tentative ? "partial" : "demonstrated";
    let understanding: ConceptEvidenceRecord["understanding"] =
      observation.observation === "demonstrated_independent" ? "independent"
        : observation.observation === "demonstrated_prompted" ? "prompted" : null;
    if (echoed && understanding === "independent") {
      status = "partial";
      understanding = null;
    }
    // Uncertain progress must never erase accepted mastery. Prompting belongs
    // to the selected utterance, so a later tutor paraphrase cannot change it.
    if (tentative && previous?.status === "demonstrated") continue;
    const sameUtterance = (reference: ConceptEvidenceReference) =>
      reference.runtimeId === source.runtimeId && reference.nodeId === source.nodeId &&
      reference.visitId === source.visitId && reference.childMessageIndex === childMessageIndex;
    const existingAttempt = previous?.promptingHistory.find(entry => sameUtterance(entry.source));
    const contentKey = (text: string) => (text.replace(/\[[^\]]*(?:\]|$)/gu, " ").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter(word => !["uh", "um", "hmm", "well", "ah", "oh"].includes(word)).join(" ");
    const unchanged = existingAttempt && contentKey(existingAttempt.source.childTranscript) === contentKey(childTranscript);
    const evidenceReference: ConceptEvidenceReference = unchanged ? existingAttempt.source : {
      runtimeId: source.runtimeId, nodeId: source.nodeId, visitId: source.visitId,
      childTurnId: childMessageIndex === messages.findLastIndex(message => message.speaker === "Child")
        ? source.childTurnId : null,
      transcriptRevision: source.transcriptRevision, childMessageIndex, childTranscript,
    };
    const unattributed = observation.observation === "demonstrated_unattributed";
    if (unattributed && previous?.status === "demonstrated") understanding = previous.understanding;
    // Reclassification of an unchanged utterance is not a fresh attempt. Once
    // attribution is known, an ambiguous cumulative label cannot rewrite it.
    if (unchanged && previous?.status === "demonstrated" &&
      (status !== "demonstrated" || understanding === null || previous.understanding !== null)) continue;
    const prompted = observation.observation === "demonstrated_independent" && !echoed ? false
      : observation.observation === "demonstrated_prompted" ? true : null;
    const promptingHistory = existingAttempt
      ? previous!.promptingHistory.map(entry => entry === existingAttempt
        ? { source: evidenceReference, prompted } : entry)
      : [...(previous?.promptingHistory ?? []), { source: evidenceReference, prompted }];
    evidence[key] = {
      criterionId: observation.criterionId, status, understanding,
      ...(tentative ? { tentative: true } : {}),
      source: unattributed && previous?.status === "demonstrated" ? previous.source : evidenceReference,
      promptingHistory,
    };
    if (status === "demonstrated" && previous?.status !== "demonstrated")
      effects.push({ type: "concept.revealed", nodeId: node.id, criterionId: observation.criterionId });
  }
  return { state: { ...state, conceptEvidence: evidence }, effects };
}

export function reduceLessonRuntime(
  state: LessonRuntimeState,
  event: LessonRuntimeEvent,
  lesson: LessonDefinition,
): LessonRuntimeResult {
  const ignored = { state, effects: [] };
  if (state.lessonId && state.lessonId !== lesson.id) return ignored;
  if (state.phase === "stopped" || !validTime(event.atMs) || event.atMs < state.nowMs) return ignored;
  if (event.type === "stop" || event.type === "disconnect") {
    return event.runtimeId === state.runtimeId
      ? { state: stopped({ ...state, nowMs: event.atMs }), effects: [] }
      : ignored;
  }
  if (event.type === "render.confirmed") {
    if (
      event.runtimeId !== state.runtimeId ||
      state.phase !== "rendering" ||
      !state.pendingRender ||
      !sameRender(state.pendingRender.identity, event.identity)
    )
      return ignored;
    const next: LessonRuntimeState = {
      ...state,
      nowMs: event.atMs,
      phase: state.lessonComplete ? "complete" : "active",
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
      nowMs: event.atMs,
      hasChildTurn: false,
      hasChildTranscript: false,
      childSpeaking: false,
      childCandidate: null,
      consumedRevision: null,
      outputActivity: "unavailable",
      phase: "rendering",
      lessonComplete: false,
      pendingRender: null,
    };
    return requestAuthoredTransition(skipped, lesson, origin);
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
    return { state: stopped({ ...state, nowMs: event.atMs }), effects: [] };
  }
  if (state.phase !== "active" || !sameSource(state, event.source)) return ignored;

  let next: LessonRuntimeState = { ...state, nowMs: event.atMs };
  let additionalEffects: LessonRuntimeEffect[] = [];
  switch (event.type) {
    case "child.candidate.started":
    case "child.turn.started":
      if (event.type === "child.candidate.started" && state.childSpeaking) return ignored;
      next = {
        ...next,
        ...clearedEvidence,
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
      next = {
        ...next,
        ...clearedEvidence,
        hasChildTranscript: state.childCandidate.hasChildTranscript,
        tutorOutputObserved: state.childCandidate.tutorOutputObserved,
        // Candidate time never satisfies drain. Recheck sustained quiet after discard.
        quietSinceMs: state.childCandidate.tutorOutputObserved && state.outputActivity === "quiet" ? event.atMs : null,
        childSpeaking: false,
        childCandidate: null,
        consumedRevision: null,
      };
      break;
    case "child.turn.confirmed":
      if (!state.childSpeaking || !state.childCandidate) return ignored;
      next = { ...next, childCandidate: null };
      break;
    case "child.turn.ended":
      if (!state.childSpeaking) return ignored;
      next = { ...next, childSpeaking: false, childCandidate: null };
      break;
    case "transcript.updated":
      if (!Number.isSafeInteger(event.revision) || event.revision <= state.transcriptRevision) return ignored;
      next = {
        ...next,
        ...(event.speaker === "tutor" ? {} : clearedEvidence),
        childCandidate: event.speaker === "tutor" ? state.childCandidate : null,
        interruptedExchange: event.speaker === "tutor" ? state.interruptedExchange : null,
        transcriptRevision: event.revision,
        transcriptSource: event.speaker,
        hasChildTranscript:
          event.speaker === "child" ? state.hasChildTurn : event.speaker === "tutor" && state.hasChildTranscript,
        consumedRevision: null,
        conversationAdvanceRequested:
          event.speaker === "tutor" && state.conversationAdvanceRequested === "learner" ? "learner" : false,
        // Even tutor-only updates require the latest answer to be revalidated before progression.
        answerAccepted: false,
        acknowledgmentObserved: false,
      };
      break;
    case "conversation.recheck.requested": {
      if (
        !lesson.conversationFirst ||
        !sameClassificationSource(state, event.source) ||
        state.childSpeaking ||
        state.childCandidate ||
        state.hasChildTranscript ||
        !state.interruptedExchange?.tutorOutputObserved ||
        state.transcriptSource !== "tutor" ||
        state.outputActivity !== "quiet"
      ) return ignored;
      next = {
        ...next,
        interruptedExchange: { ...state.interruptedExchange, ready: true },
        tutorOutputObserved: true,
        quietSinceMs: event.atMs,
        // Recheck does not itself authorize navigation. Require a fresh exact-source proposal.
        consumedRevision: null,
      };
      break;
    }
    case "conversation.advance.requested": {
      if (
        !lesson.conversationFirst ||
        !sameClassificationSource(state, event.source) ||
        state.childSpeaking ||
        !learnerRequestedNext(event.transcriptSnapshot)
      )
        return ignored;
      next = {
        ...next,
        conversationAdvanceRequested: "learner",
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
        state.childSpeaking ||
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
        ? applyConceptObservations(next, lesson, event.source, proposal, event.transcriptSnapshot)
        : { state: next, effects: [] };
      next = conceptResult.state;
      additionalEffects = conceptResult.effects;
      if (lesson.conversationFirst) {
        next = {
          ...next,
          conversationAdvanceRequested:
            next.conversationAdvanceRequested === "learner"
              ? "learner"
              : state.transcriptSource === "tutor" && proposal.tutorState === "acknowledging"
                ? "tutor"
                : false,
        };
        break;
      }
      if (
        proposal.answerOutcome !== "correct" ||
        proposal.supportState !== "none" ||
        proposal.childActivity === "answering"
      ) {
        next = { ...next, ...clearedEvidence };
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
            (event.state === "active" && state.outputActivity !== "active" && candidate.hasChildTranscript));
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
              (state.hasChildTranscript || state.interruptedExchange?.ready === true) &&
              !state.childSpeaking),
          quietSinceMs: null,
        };
      } else if (state.quietSinceMs === null) {
        // A quiet observation can authorize an explicit skip after sustained
        // drain even when there was no accepted answer. Normal completion still
        // separately requires relevant tutor output to have been observed.
        next = { ...next, quietSinceMs: event.atMs };
      }
      break;
    case "clock.tick":
      break;
  }
  const result = finish(next, lesson);
  return { ...result, effects: [...additionalEffects, ...result.effects] };
}
