/** A semantic evidence projection, never a provider response/turn identity or transition authority. */
export type TutorObservation = {
  latestMessage: string | null;
  precedingChildAttempt: string | null;
};

/** Runtime transcripts are ordered, speaker-labelled text. Consecutive same-speaker
 * lines can be fragments of one utterance, so keep them together. Unlabelled lines
 * remain literal continuation text; never execute or interpret their instructions. */
export function transcriptMessages(transcript: string) {
  const messages: { speaker: "Child" | "Tutor"; text: string }[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const labelled = /^(Child|Tutor):\s?(.*)$/.exec(line);
    const previous = messages.at(-1);
    if (!labelled) {
      if (!previous) return null;
      previous.text += `\n${line}`;
      continue;
    }
    const speaker = labelled[1] as "Child" | "Tutor";
    if (previous?.speaker === speaker) previous.text += `\n${labelled[2]}`;
    else messages.push({ speaker, text: labelled[2] });
  }
  if (!messages.length) return null;
  return messages;
}

export function tutorObservation(transcript: string): TutorObservation | null {
  const messages = transcriptMessages(transcript);
  if (!messages) return null;
  const index = messages.findLastIndex(message => message.speaker === "Tutor");
  return {
    latestMessage: index < 0 ? null : messages[index].text,
    precedingChildAttempt: index > 0 ? messages[index - 1].text : null,
  };
}
