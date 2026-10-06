import type { CountingNodeId } from "../../../lib/lesson-runtime/counting-lesson";
import type { SpeechFixture } from "../../helpers/synthetic-microphone";

export const LIVE_CORRECT_ANSWERS = {
  "count-1-duck": "answer-one",
  "count-2-ducks": "answer-two",
  "count-3-butterflies": "answer-three",
} as const satisfies Record<CountingNodeId, SpeechFixture>;
