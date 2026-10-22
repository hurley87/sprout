import { neutralTutorAcknowledgment, substantiveLearnerText, transcriptMessages } from "../tutor-observation";

/** The captured adult discussion uses "Hmm" and "Go on" as content-free backchannels.
 * Do not broaden the shared counting/Catching Unicorns predicate. */
export const mae386NeutralBackchannel = (text: string) =>
  neutralTutorAcknowledgment(text) || /^(?:hmm|go on)[.!?]?$/iu.test(text.trim());

/** Maximal learner blocks separated by substantive tutor speech. A later probe
 * must not erase earlier candidates. No block bridges help, feedback or visits. */
export function learnerSourceBlocks(transcript: string) {
  const messages = transcriptMessages(transcript);
  if (!messages) return [];
  const blocks: {
    id: string;
    start: number;
    end: number;
    messages: { messageIndex: number; speaker: "Child" | "Tutor"; text: string }[];
  }[] = [];
  let start: number | null = null;
  let end: number | null = null;
  const flush = () => {
    if (start !== null && end !== null)
      blocks.push({
        id: `span_${start}_${end}`,
        start,
        end,
        messages: messages
          .slice(start, end + 1)
          .map((message, offset) => ({ messageIndex: start! + offset, ...message })),
      });
    start = end = null;
  };
  for (const [index, message] of messages.entries()) {
    if (message.speaker === "Tutor" && !mae386NeutralBackchannel(message.text)) flush();
    else if (message.speaker === "Child" && substantiveLearnerText(message.text, true)) {
      start ??= index;
      end = index;
    }
  }
  flush();
  // Keep the existing single-message path when there is no fragmented block.
  return blocks.some(block => block.end > block.start) ? blocks : [];
}

/** Compatibility helper for callers expecting exactly one neutral block. */
export function neutralLearnerSourceBlock(transcript: string) {
  const blocks = learnerSourceBlocks(transcript);
  return blocks.length === 1 ? blocks[0] : null;
}
