import { transcriptMessages } from "./tutor-observation";

/** Literal, ordered evidence. Labels are reported attribution, not verified speakers.
 * The anchor is structural (child block before the latest tutor block), never a
 * claim that a task answer/help request occurred or that a provider turn ended. */
export function supportEvidence(transcript: string) {
  const messages = transcriptMessages(transcript);
  if (!messages) return null;
  const tutorIndex = messages.findLastIndex(message => message.speaker === "Tutor");
  let anchor = messages.findLastIndex((message, index) => message.speaker === "Child" && index < tutorIndex);
  if (anchor < 0) anchor = messages.findLastIndex(message => message.speaker === "Child");
  return {
    precedingContext: anchor < 0 ? messages : messages.slice(0, anchor),
    latestChildAttempt: anchor < 0 ? null : messages[anchor],
    subsequentMessages: anchor < 0 ? [] : messages.slice(anchor + 1),
  };
}
