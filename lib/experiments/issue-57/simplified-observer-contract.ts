/** Offline projection-A adapter. Semantic criteria and validation live in the canonical classifier. */
import {
  conversationObserverState,
  CONVERSATION_STATE_QUESTIONS,
} from "../../lesson-runtime/conversation-observer-contract";
import { tutorObservation } from "../../lesson-runtime/tutor-observation";
import { supportEvidence } from "../../lesson-runtime/support-evidence";
import type { ConversationStateClassifierInput } from "../../lesson-runtime/conversation-state-classifier";
export {
  normalizeConversationOutputs as normalizeSimplifiedOutputs,
  mapConversationObservation as mapSimplifiedObservation,
  abstain,
  type ObjectiveState,
  type ObservedTutorState as ExperimentalTutorState,
  type ChoiceOutput,
  type ConversationStateOutputs as SimplifiedOutputs,
  type ConversationStateDecision as SimplifiedDecision,
} from "../../lesson-runtime/conversation-observer-contract";
export const SIMPLIFIED_QUESTIONS = {
  ...CONVERSATION_STATE_QUESTIONS,
  tutorState: {
    ...CONVERSATION_STATE_QUESTIONS.tutorState,
    instructions: CONVERSATION_STATE_QUESTIONS.tutorState.instructions.replace(
      "Describe only the latest relevant tutor response in the ordered transcript, using earlier child and tutor messages as context. Earlier messages are context only, never the latest tutor action.",
      "Describe only tutorObservation.latestMessage using precedingChildAttempt and the full transcript as context.",
    ),
  },
} as const;
export function simplifiedObserverState(input: ConversationStateClassifierInput) {
  const state = conversationObserverState(input);
  const observation = tutorObservation(input.transcript);
  if (!state || !observation) return null;
  const { transcriptRevision, ...context } = state;
  return {
    ...context,
    tutorObservation: observation,
    supportEvidence: supportEvidence(input.transcript),
    transcriptRevision,
  };
}
