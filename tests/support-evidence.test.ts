import { expect, it } from "vitest";
import { supportEvidence } from "../lib/lesson-runtime/support-evidence";

const pause = "Tutor: How many ducks do you see?\nChild: [breath ]I think [sigh\nChild: ] One\nTutor: Yes. One duck.";
it("keeps the exact pause/resume evidence, including split annotations, as one structural attempt", () => {
  expect(supportEvidence(pause)).toEqual({
    precedingContext: [{ speaker: "Tutor", text: "How many ducks do you see?" }],
    latestChildAttempt: { speaker: "Child", text: "[breath ]I think [sigh\n] One" },
    subsequentMessages: [{ speaker: "Tutor", text: "Yes. One duck." }],
  });
});
it("preserves earlier help and later renewed requests in order without declaring resolution", () => {
  expect(
    supportEvidence(
      "Child: Can you help?\nTutor: Point to each duck.\nChild: Two\nTutor: Yes, two ducks.\nChild: I still need help",
    ),
  ).toEqual({
    precedingContext: [
      { speaker: "Child", text: "Can you help?" },
      { speaker: "Tutor", text: "Point to each duck." },
    ],
    latestChildAttempt: { speaker: "Child", text: "Two" },
    subsequentMessages: [
      { speaker: "Tutor", text: "Yes, two ducks." },
      { speaker: "Child", text: "I still need help" },
    ],
  });
});
it.each([
  "Child: One...\nChild: can you help?",
  "Child: One\nChild: No, two",
  "Child: One or\nChild: two?",
  "Child: Three\nTutor: Try again\nChild: Four",
  "Tutor: Two ducks\nChild: Two?",
  "Child: [please help me]\nChild: [sigh]",
])("retains all literal words for semantic review: %s", transcript => {
  const projection = supportEvidence(transcript)!;
  const messages = [
    ...projection.precedingContext,
    ...(projection.latestChildAttempt ? [projection.latestChildAttempt] : []),
    ...projection.subsequentMessages,
  ];
  expect(
    messages
      .map(message => `${message.speaker}: ${message.text}`)
      .join("\n")
      .replaceAll("\nChild: ", "\n"),
  ).toBe(transcript.replaceAll("\nChild: ", "\n"));
  expect(JSON.stringify(projection)).not.toMatch(/supportState|resolved|childTurnId|answerOutcome/);
});
it("has no child attempt for tutor-only text and rejects unknown leading attribution", () => {
  expect(supportEvidence("Tutor: One duck")).toMatchObject({ latestChildAttempt: null, subsequentMessages: [] });
  expect(supportEvidence("Unknown: one\nTutor: Yes")).toBeNull();
});
