/** Offline projection-A comparison adapter; execution and mapping are canonical. */
import { JEV_MODEL } from "../../jev";
import { executeConversationObserver } from "../../lesson-runtime/jev-conversation-state-classifier";
import { simplifiedObserverState, SIMPLIFIED_QUESTIONS } from "./simplified-observer-contract";
import { COUNTING_LESSON } from "../../lesson-runtime/counting-lesson";
import type { ConversationStateClassifierInput } from "../../lesson-runtime/conversation-state-classifier";
export * from "./simplified-observer-contract";
export const executeSimplifiedObserver = executeConversationObserver;
export function classifySimplifiedObserver(input: ConversationStateClassifierInput, signal: AbortSignal) {
  const lessonInput = { ...input, lesson: input.lesson ?? COUNTING_LESSON };
  return executeConversationObserver(lessonInput, signal, {
    model: JEV_MODEL,
    state: simplifiedObserverState(lessonInput),
    questions: SIMPLIFIED_QUESTIONS,
  });
}
