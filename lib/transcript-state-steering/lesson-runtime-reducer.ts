import type { OutputActivityEvent } from "../events";
import { parseConversationStateProposal } from "./conversation-state-classifier";
import {
  COUNTING_LESSON_GRAPH,
  INITIAL_COUNTING_NODE_ID,
  type CountingLessonNode,
  type CountingNodeId,
} from "./counting-lesson";

/** App-owned identities, captured at the source/request boundary, never supplied by the classifier. */
export type RuntimeSource = {
  readonly runtimeId: string;
  readonly visitId: number;
  readonly childTurnId: number;
};
export type ClassificationSource = RuntimeSource & {
  readonly nodeId: CountingNodeId;
  readonly transcriptRevision: number;
};
export type RenderIdentity = {
  readonly token: string;
  readonly nodeId: CountingNodeId | null;
  readonly sceneId: CountingLessonNode["sceneId"] | null;
};
export type CurrentNodeSteeringContext = {
  readonly nodeId: CountingNodeId;
  readonly scene: {
    readonly id: CountingLessonNode["sceneId"];
    readonly object: CountingLessonNode["object"];
    readonly quantity: CountingLessonNode["quantity"];
  };
  readonly learningObjective: string;
  readonly tutorBrief: string;
};

export type LessonRuntimeState = {
  readonly runtimeId: string;
  readonly nodeId: CountingNodeId;
  readonly visitId: number;
  readonly childTurnId: number;
  readonly hasChildTurn: boolean;
  readonly hasChildTranscript: boolean;
  readonly childSpeaking: boolean;
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
  readonly pendingRender: {
    readonly identity: RenderIdentity;
    readonly origin: ClassificationSource;
  } | null;
};

/** atMs uses one local monotonic clock. The reducer has no timers or provider side effects. */
export type LessonRuntimeEvent = { readonly atMs: number } & (
  | { readonly type: "child.turn.started"; readonly source: RuntimeSource }
  | { readonly type: "child.turn.ended"; readonly source: RuntimeSource }
  | {
      readonly type: "transcript.updated";
      readonly source: RuntimeSource;
      readonly revision: number;
      readonly speaker: "child" | "tutor" | "unknown";
    }
  | { readonly type: "proposal.received"; readonly source: ClassificationSource; readonly proposal: unknown }
  | { readonly type: "output.activity"; readonly source: RuntimeSource; readonly state: OutputActivityEvent["state"] }
  | { readonly type: "clock.tick"; readonly source: RuntimeSource }
  | { readonly type: "render.confirmed"; readonly runtimeId: string; readonly identity: RenderIdentity }
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
  | { readonly type: "lesson.completed"; readonly renderToken: string };
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
} as const;

/** The initial authored scene must already be rendered. Use a fresh runtimeId for every start/reconnect. */
export function createLessonRuntime(
  runtimeId: string,
  { quietDrainMs = 250, atMs = 0 }: { quietDrainMs?: number; atMs?: number } = {},
): LessonRuntimeState {
  if (!runtimeId || !Number.isFinite(quietDrainMs) || quietDrainMs <= 0 || !validTime(atMs)) {
    throw new Error("A runtime identity, positive quiet threshold, and valid local time are required");
  }
  return {
    runtimeId,
    nodeId: INITIAL_COUNTING_NODE_ID,
    visitId: 1,
    childTurnId: 0,
    hasChildTurn: false,
    hasChildTranscript: false,
    childSpeaking: false,
    transcriptRevision: 0,
    transcriptSource: "unknown",
    consumedRevision: null,
    ...clearedEvidence,
    outputActivity: "unavailable",
    quietDrainMs,
    nowMs: atMs,
    phase: "active",
    lessonComplete: false,
    pendingRender: null,
  };
}

export function runtimeSource(state: LessonRuntimeState): RuntimeSource {
  return { runtimeId: state.runtimeId, visitId: state.visitId, childTurnId: state.childTurnId };
}

/** Capture alongside the exact transcript snapshot before awaiting a classification. */
export function classificationSource(state: LessonRuntimeState): ClassificationSource | null {
  if (state.phase !== "active" || state.childSpeaking || !state.hasChildTranscript) return null;
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
  };
}

function finish(state: LessonRuntimeState): LessonRuntimeResult {
  const drained =
    state.tutorOutputObserved &&
    state.outputActivity === "quiet" &&
    state.quietSinceMs !== null &&
    state.nowMs - state.quietSinceMs >= state.quietDrainMs;
  const next = { ...state, tutorOutputDrained: drained };
  if (!next.answerAccepted || !next.acknowledgmentObserved || !drained || next.childSpeaking) {
    return { state: next, effects: [] };
  }

  // The only transition authority is this authored edge. No model-selected destination is read.
  const edge = COUNTING_LESSON_GRAPH[next.nodeId].onSuccess;
  const visitId = next.visitId + 1;
  const identity: RenderIdentity = {
    token: JSON.stringify([next.runtimeId, visitId]),
    nodeId: edge.kind === "node" ? edge.nodeId : null,
    sceneId: edge.kind === "node" ? COUNTING_LESSON_GRAPH[edge.nodeId].sceneId : null,
  };
  return {
    state: {
      ...next,
      ...clearedEvidence,
      nodeId: edge.kind === "node" ? edge.nodeId : next.nodeId,
      visitId,
      hasChildTurn: false,
      hasChildTranscript: false,
      consumedRevision: null,
      phase: "rendering",
      lessonComplete: edge.kind === "complete",
      pendingRender: { identity, origin: classificationSource(next)! },
    },
    effects: [{ type: "render.requested", identity }],
  };
}

export function reduceLessonRuntime(state: LessonRuntimeState, event: LessonRuntimeEvent): LessonRuntimeResult {
  const ignored = { state, effects: [] };
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
    const node = COUNTING_LESSON_GRAPH[next.nodeId];
    return {
      state: next,
      effects: [
        {
          type: "steering.ready",
          renderToken: event.identity.token,
          // Explicit projection: never serialize the graph or future teaching context.
          context: {
            nodeId: node.id,
            scene: { id: node.sceneId, object: node.object, quantity: node.quantity },
            learningObjective: node.learningObjective,
            tutorBrief: node.tutorBrief,
          },
        },
      ],
    };
  }
  // Media/transcript work from the previous visit cannot mutate a newly committed target.
  // Speech or a newly revised child transcript during rendering cancels old completion authority.
  if (
    state.phase === "rendering" &&
    (event.type === "child.turn.started" ||
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
  switch (event.type) {
    case "child.turn.started":
      next = {
        ...next,
        ...clearedEvidence,
        childTurnId: state.childTurnId + 1,
        hasChildTurn: true,
        hasChildTranscript: false,
        childSpeaking: true,
        consumedRevision: null,
      };
      break;
    case "child.turn.ended":
      if (!state.childSpeaking) return ignored;
      next = { ...next, childSpeaking: false };
      break;
    case "transcript.updated":
      if (!Number.isSafeInteger(event.revision) || event.revision <= state.transcriptRevision) return ignored;
      next = {
        ...next,
        ...(event.speaker === "tutor" ? {} : clearedEvidence),
        transcriptRevision: event.revision,
        transcriptSource: event.speaker,
        hasChildTranscript:
          event.speaker === "child" ? state.hasChildTurn : event.speaker === "tutor" && state.hasChildTranscript,
        consumedRevision: null,
        // Even tutor-only updates require the latest answer to be revalidated before progression.
        answerAccepted: false,
        acknowledgmentObserved: false,
      };
      break;
    case "proposal.received": {
      const proposal = parseConversationStateProposal(event.proposal);
      if (
        state.childSpeaking ||
        !state.hasChildTranscript ||
        !proposal ||
        event.source.nodeId !== state.nodeId ||
        event.source.transcriptRevision !== state.transcriptRevision ||
        proposal.nodeId !== state.nodeId ||
        proposal.transcriptRevision !== state.transcriptRevision ||
        state.consumedRevision === state.transcriptRevision
      )
        return ignored;
      next = { ...next, consumedRevision: state.transcriptRevision };
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
        acknowledgmentObserved:
          state.acceptedAnswerRevision !== null &&
          state.acceptedAnswerRevision < state.transcriptRevision &&
          state.transcriptSource === "tutor" &&
          proposal.tutorState === "acknowledging",
      };
      break;
    }
    case "output.activity":
      next = { ...next, outputActivity: event.state };
      if (event.state === "unavailable") {
        next = { ...next, tutorOutputObserved: false, quietSinceMs: null };
      } else if (event.state === "active") {
        next = {
          ...next,
          // Anchor a fresh onset to the ended child turn, independent of classifier latency.
          // Already-active pre-turn/during-child PCM cannot become relevant by remaining active.
          tutorOutputObserved:
            state.tutorOutputObserved ||
            (state.outputActivity !== "active" && state.hasChildTranscript && !state.childSpeaking),
          quietSinceMs: null,
        };
      } else if (state.tutorOutputObserved && state.quietSinceMs === null) {
        next = { ...next, quietSinceMs: event.atMs };
      }
      break;
    case "clock.tick":
      break;
  }
  return finish(next);
}
