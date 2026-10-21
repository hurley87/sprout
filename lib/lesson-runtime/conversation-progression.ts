import type { TutorState } from "./conversation-state-classifier";
import { transcriptMessages } from "./tutor-observation";

/** Recognize only complete navigation commands and short explanations surrounding them.
 * Every sentence must match the grammar; never search inside answers or quotations. */
export type NavigationIntent = {
  readonly action: "next" | "skip";
  readonly scope: "subpart" | "question";
};

/** Legacy role-labelled transcript wrapper. Grouped runtimes parse authenticated turns directly. */
export function learnerNavigationIntent(transcript: string, authored = false): NavigationIntent | null {
  const text = transcriptMessages(transcript)?.findLast(message => message.speaker === "Child")?.text;
  return parseLearnerNavigationText(text ?? "", authored);
}

/** Parse one application-authenticated learner turn; do not merge distinct turns or inspect role labels. */
export function parseLearnerNavigationText(turnText: string, authored = true): NavigationIntent | null {
  const text = turnText.trim().replace(/\s+/gu, " ");
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/u);
  let requested: NavigationIntent | null = null;
  for (const sentence of sentences) {
    const command = sentence
      .replace(/[.!?]+$/u, "")
      .replace(/^i (?:don't|don’t|do not) know,\s+/iu, "")
      .replace(/^(?:(?:yes|yeah|okay|ok|well|um|i am)[,.]?\s+)+/iu, "")
      .replace(/^i think\s+/iu, "")
      .replace(/^please[,.]?\s+/iu, "")
      .replace(/,? please$/iu, "");
    const directRequest =
      (authored && /^(?:(?:can|could) we )?skip (?:this|that) one$/iu.test(command)) ||
      [
        /^next(?: question)?(?:,? then)?$/iu,
        /^(?:can|could) i (?:have|get) (?:the )?next question$/iu,
        /^i(?:['’]d| would) like (?:the )?next question$/iu,
        /^let['’]s do (?:the )?next question$/iu,
        /^(?:(?:let['’]s|can we|could we|i(?:['’]d| would) like to)\s+)?(?:move on|(?:go|move|skip)(?: on)? to (?:the )?next(?: question)?|skip (?:this|that|the)(?: question)?)$/iu,
      ].some(pattern => pattern.test(command));
    if (directRequest) {
      const intent: NavigationIntent = {
        action: /\bskip\b/iu.test(command) ? "skip" : "next",
        scope: /\bquestion\b/iu.test(command) ? "question" : "subpart",
      };
      // Conflicting scopes in one utterance are ambiguous, never a graph command.
      if (authored && requested && requested.scope !== intent.scope) return null;
      requested = intent;
      continue;
    }
    // Explanations alone never request navigation. Questions, disagreement and
    // added answer content do not match and invalidate the entire utterance.
    const explanation = sentence.replace(/[.!]+$/u, "");
    if (
      ![
        /^i (?:don't|don’t|do not) know$/iu,
        /^i(?: think i)?(?: have|['’]ve) answered (?:(?:this|that)(?: question)?|the question)$/iu,
        /^i(?:['’]m| am) done with (?:this|that|the) question$/iu,
      ].some(pattern => pattern.test(explanation))
    )
      return null;
  }
  return requested;
}

/** Existing callers only need a boolean; authored callers retain the typed intent. */
export function learnerRequestedNext(transcript: string, authored = false) {
  return learnerNavigationIntent(transcript, authored) !== null;
}

/** Parse one authenticated turn. Quoted, reported, conditional or extended speech is not Stop. */
export function isLearnerStopText(turnText: string) {
  return /^(?:please[ ,]+)?stop(?: (?:the |this )?(?:session|practice))?(?:,? please)?[.!]*$/iu.test(turnText.trim());
}

/** This only bounds what may follow a classified tutor close; it never establishes closure. */
export function closingTutorExchange(snapshot: string | undefined) {
  const messages = snapshot === undefined ? null : transcriptMessages(snapshot);
  if (!messages) return null;
  const messageIndex = messages.findLastIndex(message => message.speaker === "Tutor");
  if (messageIndex < 0) return null;
  const suffix = messages.slice(messageIndex + 1).map(message => message.text.trim().replace(/\s+/gu, " "));
  const acknowledgment = /^(?:great|okay|ok|sounds good|thanks|thank you)[.! ,]*$/iu;
  const complete = suffix.every(text => acknowledgment.test(text));
  // Provider fragments can split "Sounds good" or "Thank you". Keep authority
  // suspended across the prefix; incomplete text cannot authorize progression.
  return suffix.every(text => acknowledgment.test(text) || /^(?:sounds|thank)$/iu.test(text))
    ? { messageIndex, text: messages[messageIndex].text, complete }
    : null;
}

/** Compare conversation content only. The reducer owns all source identity checks. */
export function matchesTutorClosure(
  exchange: { readonly messageIndex: number; readonly text: string } | null,
  closure: { readonly messageIndex: number; readonly text: string } | null | undefined,
) {
  return !!exchange && !!closure && exchange.messageIndex === closure.messageIndex && exchange.text === closure.text;
}

/** Interpret an already validated classifier result; this does not consume it. */
export function tutorAcknowledgedClosure(
  tutorState: TutorState,
  transcriptSource: "child" | "tutor" | "unknown",
  exchange: { readonly complete: boolean } | null,
) {
  return (
    tutorState === "acknowledging" &&
    (transcriptSource === "tutor" || (transcriptSource === "child" && exchange?.complete === true))
  );
}

/** Conversation progress is independent of concept mastery. Media gates remain in the reducer. */
export function hasConversationCompletionEvidence(state: {
  readonly conversationAdvanceRequested?: "learner" | "tutor" | false;
  readonly hasChildTranscript: boolean;
  readonly interruptedExchange?: { readonly ready: boolean } | null;
}) {
  return (
    state.conversationAdvanceRequested === "learner" ||
    ((state.hasChildTranscript || state.interruptedExchange?.ready) && state.conversationAdvanceRequested === "tutor")
  );
}
