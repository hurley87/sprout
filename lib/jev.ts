// Server-only shared TypeSafe/SystemOne transport. The credential and every
// provider response body stay here; callers receive validated probabilities only.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/**
 * Pinned rather than `jev-latest`, so the tuned threshold cannot shift when a
 * new release ships. `jev-latest` resolved to this version on 2026-09-23.
 */
export const JEV_MODEL = "jev-1.13.0";

type JevFailure = { ok: false; reason: "unconfigured" | "rejected" | "unreadable" | "unreachable" | "cancelled" };

export type NoulQuestion = {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
};

type NoulOutcome<Key extends string> = { ok: true; probabilities: Record<Key, number>; model: string } | JevFailure;

function readNoul(body: unknown, questionId: string): number | null {
  const response = body as { answers?: Record<string, { noul?: unknown }> } | null;
  const noul = response?.answers?.[questionId]?.noul;
  return typeof noul === "number" && Number.isFinite(noul) && noul >= 0 && noul <= 1 ? noul : null;
}

/** One paid call, pinned model, closed probability projection; no raw bodies escape. */
export async function evaluateNoulQuestions<Key extends string>(
  state: unknown,
  questions: Record<Key, NoulQuestion>,
  signal: AbortSignal,
): Promise<NoulOutcome<Key>> {
  if (signal.aborted) return { ok: false, reason: "cancelled" };
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { ok: false, reason: "unconfigured" };
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions,
      }),
      signal,
    });
  } catch {
    return { ok: false, reason: signal.aborted ? "cancelled" : "unreachable" };
  }
  // Provider bodies can echo the state; never forward or log them.
  if (signal.aborted) return { ok: false, reason: "cancelled" };
  if (!response.ok) return { ok: false, reason: "rejected" };
  const body: unknown = await response.json().catch(() => null);
  if (signal.aborted) return { ok: false, reason: "cancelled" };
  const probabilities = {} as Record<Key, number>;
  for (const id of Object.keys(questions) as Key[]) {
    const probability = readNoul(body, id);
    if (probability === null) return { ok: false, reason: "unreadable" };
    probabilities[id] = probability;
  }
  const model = (body as { model?: unknown }).model;
  return { ok: true, probabilities, model: typeof model === "string" ? model : JEV_MODEL };
}
