// The one semantic decision the application delegates to an evaluation model:
// whether the learner's answer is good enough to advance the current scene.
// Everything behind this seam is replaceable; nothing else in the lesson
// depends on which model answers the question. See
// docs/jev-answer-experiment.md for the experiment this supports.

/** Question id on the wire; also the key the evaluation answer arrives under. */
export const ANSWER_QUESTION_ID = "countedDisplayed";
export const ANSWER_QUESTION = {
  type: "noul",
  instructions: "Did the learner correctly count the objects currently displayed?",
  criteria: {
    true: "The learner's final answer gives the same total as the displayed quantity, either by naming that total or by counting up to it and stopping there. A self-correction counts: judge only the answer they settled on.",
    false:
      "The final answer gives a different number, gives no total at all, is a guess the learner is asking about rather than stating, says they do not know, or is about something other than counting what is displayed.",
  },
} as const;

/**
 * Chosen from the labeled calibration set in docs/jev-answer-experiment.md and
 * frozen before the comparison runs: correct answers scored 0.96 and above,
 * everything else 0.81 and below. A single band, so anything under this leaves
 * the scene alone and the scaffolding to GPT-Live. Retune only against a fresh
 * calibration set, and only together with the pinned model version.
 */
export const ADVANCE_THRESHOLD = 0.9;

/**
 * GPT-Live emits no authoritative end-of-turn event, so the application defines
 * one: a learner utterance is complete once this much time passes with no new
 * transcript delta for it.
 */
export const SETTLE_MS = 1500;

/** An evaluation that outlives its usefulness must never reach the lesson. */
export const EVALUATION_TIMEOUT_MS = 3000;

export type AnswerResult =
  | { status: "evaluated"; probability: number; model: string; latencyMs: number }
  | { status: "unavailable"; reason: string; latencyMs: number };

export type AnswerRequest = { sceneIndex: number; utterance: string };
export type EvaluateAnswer = (request: AnswerRequest, signal: AbortSignal) => Promise<AnswerResult>;

/**
 * The probability is an application control signal only. It is not evidence of
 * understanding and is never stored as a learner assessment.
 */
export function shouldAdvance(result: AnswerResult): boolean {
  return result.status === "evaluated" && result.probability >= ADVANCE_THRESHOLD;
}

/** Longest learner utterance the evaluation accepts; also enforced server-side. */
export const MAX_UTTERANCE_CHARS = 500;

function parseProbability(body: unknown): { probability: number; model: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { probability, model } = body as { probability?: unknown; model?: unknown };
  if (typeof probability !== "number" || !Number.isFinite(probability)) return null;
  if (probability < 0 || probability > 1 || typeof model !== "string") return null;
  return { probability, model };
}

/** Browser implementation. The evaluation credential stays on the server. */
export const fetchEvaluateAnswer: EvaluateAnswer = async (request, signal) => {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(EVALUATION_TIMEOUT_MS)]),
    });
    if (!response.ok) return { status: "unavailable", reason: `http_${response.status}`, latencyMs: elapsed() };
    const answer = parseProbability(await response.json().catch(() => null));
    if (!answer) return { status: "unavailable", reason: "unreadable_answer", latencyMs: elapsed() };
    return { status: "evaluated", ...answer, latencyMs: elapsed() };
  } catch {
    return { status: "unavailable", reason: signal.aborted ? "cancelled" : "request_failed", latencyMs: elapsed() };
  }
};
