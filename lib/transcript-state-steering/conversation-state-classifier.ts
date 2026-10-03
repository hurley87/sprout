import { isCountingNodeId, type CountingNodeId } from "./counting-lesson";

export const CHILD_STATES = ["thinking", "answering", "correct", "incorrect", "unclear", "needs_help"] as const;
export type ChildState = (typeof CHILD_STATES)[number];

export const TUTOR_STATES = ["asking", "listening", "clarifying", "helping", "acknowledging"] as const;
export type TutorState = (typeof TUTOR_STATES)[number];

/**
 * The ConversationStateClassifier's ephemeral runtime interpretation for one node and revision.
 * This is input to the deterministic lesson reducer, with no persistence or parent-review lifecycle.
 * Sprout's post-session, evidence-oriented Observer has a separate proposal contract.
 * Even "correct" is a proposal, not permission to advance. A future application reducer must
 * check current-node/revision relevance and apply authored edges; this parser only checks shape.
 */
export type ConversationStateProposal = {
  readonly nodeId: CountingNodeId;
  /** Nonnegative safe integer identifying the transcript snapshot interpreted. */
  readonly transcriptRevision: number;
  readonly childState: ChildState;
  readonly tutorState: TutorState;
  /** Finite confidence in the whole proposal, inclusive range [0, 1]. */
  readonly confidence: number;
};

/** A supplied transcript snapshot, not an accumulator or a persisted session record. */
export type ConversationStateClassifierInput = {
  readonly nodeId: CountingNodeId;
  readonly transcriptRevision: number;
  readonly transcript: string;
};

/**
 * Provider-independent runtime classification contract; implementation belongs to a later slice.
 * Classify only the supplied snapshot, returning a tentative state proposal or null to abstain.
 * The classifier has no lesson-transition authority and does not publish reviewed learning evidence.
 */
export type ConversationStateClassifier = {
  classify(input: ConversationStateClassifierInput): Promise<ConversationStateProposal | null>;
};

const PROPOSAL_KEYS = ["nodeId", "transcriptRevision", "childState", "tutorState", "confidence"] as const;

/** Closed runtime payload: reject commands, future-node context, and evidence/review metadata. */
export function parseConversationStateProposal(value: unknown): ConversationStateProposal | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value as Record<string, unknown>;
  const keys = Object.keys(proposal);
  if (
    keys.length !== PROPOSAL_KEYS.length ||
    keys.some(key => !PROPOSAL_KEYS.includes(key as (typeof PROPOSAL_KEYS)[number]))
  )
    return null;

  if (
    !isCountingNodeId(proposal.nodeId) ||
    typeof proposal.transcriptRevision !== "number" ||
    !Number.isSafeInteger(proposal.transcriptRevision) ||
    proposal.transcriptRevision < 0 ||
    typeof proposal.childState !== "string" ||
    !CHILD_STATES.includes(proposal.childState as ChildState) ||
    typeof proposal.tutorState !== "string" ||
    !TUTOR_STATES.includes(proposal.tutorState as TutorState) ||
    typeof proposal.confidence !== "number" ||
    !Number.isFinite(proposal.confidence) ||
    proposal.confidence < 0 ||
    proposal.confidence > 1
  )
    return null;

  return {
    nodeId: proposal.nodeId,
    transcriptRevision: proposal.transcriptRevision,
    childState: proposal.childState as ChildState,
    tutorState: proposal.tutorState as TutorState,
    confidence: proposal.confidence,
  };
}
