import type { LessonDefinition } from "./lesson-definition";

export const CHILD_ACTIVITIES = ["unknown", "waiting", "thinking", "answering"] as const;
export type ChildActivity = (typeof CHILD_ACTIVITIES)[number];

export const ANSWER_OUTCOMES = ["none", "correct", "incorrect", "unclear"] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

export const SUPPORT_STATES = ["none", "needs_help"] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export const TUTOR_STATES = ["unknown", "asking", "listening", "clarifying", "helping", "acknowledging"] as const;
export type TutorState = (typeof TUTOR_STATES)[number];
export const CONCEPT_OBSERVATIONS = ["not_yet", "partial", "demonstrated_independent", "demonstrated_prompted"] as const;
export type ConceptObservation = (typeof CONCEPT_OBSERVATIONS)[number];
export type ProposedConceptObservation = { readonly criterionId: string; readonly observation: ConceptObservation };

/**
 * The ConversationStateClassifier's ephemeral runtime interpretation for one node and revision.
 * This is ephemeral input to the deterministic lesson reducer.
 * Activity, latest answer outcome, and support need are independent: a child can be thinking
 * after an incorrect answer while needing help. Even "correct" is not permission to advance.
 * The application reducer must match node/revision claims to the exact classification
 * request before applying authored edges; this parser only checks shape.
 */
export type ConversationStateProposal = {
  /** Claimed authored node; the app must match it to the exact classification request. */
  readonly nodeId: string;
  /** Claimed snapshot revision; a nonnegative safe integer the app must match to the request. */
  readonly transcriptRevision: number;
  /** Requires runtime turn/audio signals; a transcript-only classifier emits "unknown". */
  readonly childActivity: ChildActivity;
  /** Outcome of the latest answer for this node; "none" when no answer has been given. */
  readonly answerOutcome: AnswerOutcome;
  /** Current inferred need for help; "none" when no need is inferred. */
  readonly supportState: SupportState;
  /** Transcript classification describes the latest tutor message, not live speech activity. */
  readonly tutorState: TutorState;
  /** Optional classifier interpretations; the reducer validates authorship and owns accepted evidence. */
  readonly conceptObservations?: readonly ProposedConceptObservation[];
};

/** A supplied transcript snapshot, not an accumulator or a persisted session record. */
export type ConversationStateClassifierInput = {
  readonly lesson?: LessonDefinition;
  readonly nodeId: string;
  readonly transcriptRevision: number;
  /** Recent current-node exchange in order, with Child:/Tutor: speaker labels. */
  readonly transcript: string;
};

/**
 * Provider-independent runtime classification contract.
 * Classify only the supplied snapshot, returning a tentative state proposal or null to abstain.
 * The classifier has no lesson-transition authority and does not publish reviewed learning evidence.
 */
export type ConversationStateClassifier = {
  classify(input: ConversationStateClassifierInput, signal: AbortSignal): Promise<ConversationStateProposal | null>;
};

const PROPOSAL_KEYS = [
  "nodeId",
  "transcriptRevision",
  "childActivity",
  "answerOutcome",
  "supportState",
  "tutorState",
  "conceptObservations",
] as const;

/** Closed runtime payload: reject commands, future-node context, and evidence/review metadata. */
export function parseConversationStateProposal(value: unknown): ConversationStateProposal | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value as Record<string, unknown>;
  const keys = Object.keys(proposal);
  if (
    (keys.length !== PROPOSAL_KEYS.length && keys.length !== PROPOSAL_KEYS.length - 1) ||
    keys.some(key => !PROPOSAL_KEYS.includes(key as (typeof PROPOSAL_KEYS)[number])) ||
    (keys.length === PROPOSAL_KEYS.length) !== ("conceptObservations" in proposal)
  )
    return null;

  if (
    typeof proposal.nodeId !== "string" ||
    typeof proposal.transcriptRevision !== "number" ||
    !Number.isSafeInteger(proposal.transcriptRevision) ||
    proposal.transcriptRevision < 0 ||
    typeof proposal.childActivity !== "string" ||
    !CHILD_ACTIVITIES.includes(proposal.childActivity as ChildActivity) ||
    typeof proposal.answerOutcome !== "string" ||
    !ANSWER_OUTCOMES.includes(proposal.answerOutcome as AnswerOutcome) ||
    typeof proposal.supportState !== "string" ||
    !SUPPORT_STATES.includes(proposal.supportState as SupportState) ||
    typeof proposal.tutorState !== "string" ||
    !TUTOR_STATES.includes(proposal.tutorState as TutorState)
  )
    return null;

  let conceptObservations: ProposedConceptObservation[] | undefined;
  if ("conceptObservations" in proposal) {
    if (!Array.isArray(proposal.conceptObservations)) return null;
    conceptObservations = [];
    for (const item of proposal.conceptObservations) {
      if (
        !item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).length !== 2 ||
        typeof item.criterionId !== "string" || !item.criterionId ||
        typeof item.observation !== "string" || !CONCEPT_OBSERVATIONS.includes(item.observation as ConceptObservation) ||
        conceptObservations.some(existing => existing.criterionId === item.criterionId)
      ) return null;
      conceptObservations.push({ criterionId: item.criterionId, observation: item.observation as ConceptObservation });
    }
  }
  return {
    nodeId: proposal.nodeId as string,
    transcriptRevision: proposal.transcriptRevision,
    childActivity: proposal.childActivity as ChildActivity,
    answerOutcome: proposal.answerOutcome as AnswerOutcome,
    supportState: proposal.supportState as SupportState,
    tutorState: proposal.tutorState as TutorState,
    ...(conceptObservations === undefined ? {} : { conceptObservations }),
  };
}
