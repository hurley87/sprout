/** Offline projection-A comparison adapter; execution and mapping are canonical. */
import { JEV_MODEL } from "../../jev";
import { executeConversationObserver } from "../../lesson-runtime/jev-conversation-state-classifier";
import { simplifiedObserverState, SIMPLIFIED_QUESTIONS } from "./simplified-observer-contract";
import type { ConversationStateClassifierInput } from "../../lesson-runtime/conversation-state-classifier";
export * from "./simplified-observer-contract";
export const executeSimplifiedObserver = executeConversationObserver;
export function classifySimplifiedObserver(input: ConversationStateClassifierInput, signal: AbortSignal) {
  return executeConversationObserver(input, signal, {
    model: JEV_MODEL,
    state: simplifiedObserverState(input),
    questions: SIMPLIFIED_QUESTIONS,
  });
}
