import {
  learnerSourceOptions,
  type ConversationStateOutputs,
} from "../../lib/lesson-runtime/conversation-observer-contract";

/** Controlled source scores for reviewed replays and transport tests, never recorded provider output. */
export function sourceOutputs(
  transcript: string,
  selections: Readonly<Record<string, number | null>>,
): NonNullable<ConversationStateOutputs["sources"]> {
  const options = Object.keys(learnerSourceOptions(transcript));
  return Object.fromEntries(
    Object.entries(selections).map(([criterionId, index]) => {
      const choice = index === null ? "none" : `message_${index}`;
      if (!options.includes(choice)) throw new Error(`Invalid controlled source ${choice}`);
      return [
        `source_${criterionId}`,
        {
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 1 : 0])),
        },
      ];
    }),
  );
}
