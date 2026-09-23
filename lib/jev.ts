import { ANSWER_QUESTION, ANSWER_QUESTION_ID } from "./answer";
import { objectName, type Scene } from "./lesson";

// Server-only. Asks TypeSafe's Jev the single Noul question defined in
// lib/answer.ts. The credential and every provider response body stay here.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/**
 * Pinned rather than `jev-latest`, so the tuned threshold cannot shift when a
 * new release ships. `jev-latest` resolved to this version on 2026-09-23.
 */
export const JEV_MODEL = "jev-1.13.0";

export type JevOutcome =
  | { ok: true; probability: number; model: string }
  | { ok: false; reason: "unconfigured" | "rejected" | "unreadable" | "unreachable" };

/** Only what the decision needs: the displayed scene and the recent utterance. */
export function answerState(scene: Scene, utterance: string) {
  return {
    displayed: {
      object: objectName(scene),
      quantity: scene.quantity,
      description: `${scene.quantity} ${objectName(scene)}`,
    },
    learnerUtterance: utterance,
  };
}

function readNoul(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const answers = (body as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return null;
  const answer = (answers as Record<string, unknown>)[ANSWER_QUESTION_ID];
  if (typeof answer !== "object" || answer === null) return null;
  const noul = (answer as { noul?: unknown }).noul;
  if (typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1) return null;
  return noul;
}

export async function evaluateCount(scene: Scene, utterance: string, signal: AbortSignal): Promise<JevOutcome> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { ok: false, reason: "unconfigured" };
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: answerState(scene, utterance),
        questions: { [ANSWER_QUESTION_ID]: ANSWER_QUESTION },
      }),
      signal,
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  // Provider bodies can echo the state; never forward or log them.
  if (!response.ok) return { ok: false, reason: "rejected" };
  const body: unknown = await response.json().catch(() => null);
  const probability = readNoul(body);
  if (probability === null) return { ok: false, reason: "unreadable" };
  const model = (body as { model?: unknown }).model;
  return { ok: true, probability, model: typeof model === "string" ? model : JEV_MODEL };
}
