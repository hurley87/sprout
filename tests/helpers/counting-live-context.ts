/** Test adapter: the production helpers require a selected lesson definition. */
import { COUNTING_LESSON } from "../../lib/lesson-runtime/counting-lesson";
import {
  createLiveSessionConfig,
  initialTeachingContext as initialContext,
  teachingInstruction as instruct,
} from "../../lib/lesson-runtime/live-context";
import type { CurrentNodeSteeringContext } from "../../lib/lesson-runtime/lesson-runtime-reducer";

export const SPROUT_LIVE_CONFIG = createLiveSessionConfig(COUNTING_LESSON);
export const LESSON_START_INSTRUCTION = COUNTING_LESSON.tutor.startInstruction;
export const initialTeachingContext = () => initialContext(COUNTING_LESSON);
export const teachingInstruction = (context: CurrentNodeSteeringContext, startLesson = false) =>
  instruct(context, COUNTING_LESSON, startLesson);
