/** Intentional live Issue #57 observer. The reducer remains the only transition authority. */
import { contextProjectionRequest } from "../experiments/issue-57/context-projection";
import { executeSimplifiedObserver } from "../experiments/issue-57/simplified-observer";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";

export function classifyFullContextObserver(input: ConversationStateClassifierInput, signal: AbortSignal) {
  return executeSimplifiedObserver(input, signal, contextProjectionRequest(input, "B"));
}
