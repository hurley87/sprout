import type { SpeechFixture } from "../../helpers/synthetic-microphone";

export const UNRESOLVED = {
  help: { fixture: "support-help", heard: /help.*count.*ducks/i },
  incomplete: { fixture: "partial-count", heard: /(?:one|1).*duck.*and then/i },
  ambiguous: { fixture: "unsettled-answer", heard: /(?:two|2).*or.*(?:three|3).*not decided/i },
  offTopic: { fixture: "off-topic", heard: /favorite toy.*red truck/i },
} satisfies Record<string, { fixture: SpeechFixture; heard: RegExp }>;
