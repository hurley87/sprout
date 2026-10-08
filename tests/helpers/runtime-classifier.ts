import type { ConversationStateProposal } from "../../lib/lesson-runtime/conversation-state-classifier";

type ProposalIdentity = Pick<ConversationStateProposal, "nodeId" | "transcriptRevision">;
type ProposalOutcome = Pick<ConversationStateProposal, "answerOutcome" | "tutorState"> &
  Partial<Pick<ConversationStateProposal, "childActivity" | "supportState" | "conceptObservations">>;

// Build only the repeated proposal envelope; fetch routing and decisions stay local.
export function classifierProposal(input: ProposalIdentity, outcome: ProposalOutcome): ConversationStateProposal {
  return {
    nodeId: input.nodeId,
    transcriptRevision: input.transcriptRevision,
    childActivity: "unknown",
    supportState: "none",
    ...outcome,
  };
}
