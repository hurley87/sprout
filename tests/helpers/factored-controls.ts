// Synthetic mechanical controls only. No provider measurement, human labels, or calibration evidence.
import type { DecisionsRequest } from "../../lib/experiments/issue-42/decisions-classifier";
import type { ConversationStateClassifierInput } from "../../lib/lesson-runtime/conversation-state-classifier";
import { CATCHING_UNICORNS_LESSON } from "../../lib/lesson-runtime/catching-unicorns-lesson";
export const input: ConversationStateClassifierInput = {
  lesson: CATCHING_UNICORNS_LESSON,
  nodeId: "engram",
  transcriptRevision: 7,
  transcript: "Tutor: What is an engram?\nChild: A memory held inside my brain.\nTutor: Yes, that explains it.",
};
// Mechanical controls only. These are neither measured model outputs nor calibration labels.
export const policy = { minProbability: 0.8, minConfidence: 0.6, minMargin: 0.4 };
export function body(
  req: DecisionsRequest,
  demonstration = "demonstrated",
  prompting = "independent",
  source = "message_1",
) {
  return {
    model: "gpt-6-luna",
    answers: req.questions.map(q => {
      const choice =
        q.name === "objectiveState"
          ? "completed"
          : q.name === "tutorState"
            ? "confirmed_completion"
            : q.name.startsWith("source_")
              ? source
              : q.name.startsWith("prompting_")
                ? prompting
                : demonstration;
      return {
        type: "choice",
        name: q.name,
        choice,
        confidence: 0.87,
        probabilities: q.choices.map(c => ({
          value: c.value,
          probability: c.value === choice ? 0.96 : 0.04 / (q.choices.length - 1),
        })),
      };
    }),
  };
}
