import { neutralTutorAcknowledgment, substantiveLearnerText, transcriptMessages } from "../tutor-observation";

/** The captured adult discussion uses a standalone "Hmm" as a backchannel.
 * Do not broaden the shared counting/Catching Unicorns predicate. */
export const mae386NeutralBackchannel = (text: string) =>
  neutralTutorAcknowledgment(text) || /^hmm[.!?]?$/iu.test(text.trim());

/** One candidate, not a semantic verdict. Keep the literal transcript and every
 * original index; never join across substantive tutor speech or across visits. */
export function neutralLearnerSourceBlock(transcript: string) {
  const messages = transcriptMessages(transcript);
  if (!messages) return null;
  const candidates = messages.flatMap((message, index) =>
    message.speaker === "Child" && substantiveLearnerText(message.text, true) ? [index] : [],
  );
  if (candidates.length < 2) return null;
  const start = candidates[0];
  const end = candidates.at(-1)!;
  const selected = messages.slice(start, end + 1);
  if (selected.some(message => message.speaker === "Tutor" && !mae386NeutralBackchannel(message.text))) return null;
  return {
    id: `span_${start}_${end}`,
    start,
    end,
    messages: selected.map((message, offset) => ({ messageIndex: start + offset, ...message })),
  };
}
