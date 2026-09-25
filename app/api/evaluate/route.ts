import { MAX_UTTERANCE_CHARS } from "@/lib/answer";
import { evaluateCount } from "@/lib/jev";
import { SCENES, sceneAt } from "@/lib/lesson";
import { isLocalRequest, readJsonBody } from "@/lib/local-request";

export const runtime = "nodejs";
const LIMIT = 4096;
const json = (body: object, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type AnswerRequest = { sceneIndex: number; utterance: string };

function parseRequest(body: unknown): AnswerRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { sceneIndex, utterance } = body as { sceneIndex?: unknown; utterance?: unknown };
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= SCENES.length)
    return null;
  if (typeof utterance !== "string") return null;
  const trimmed = utterance.trim();
  if (!trimmed || trimmed.length > MAX_UTTERANCE_CHARS) return null;
  return { sceneIndex, utterance: trimmed };
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Start Sprout from its local browser window." }, 403);
  const body = await readJsonBody(request, LIMIT);
  if (!body.ok) return json({ error: "Invalid evaluation request." }, body.tooLarge ? 413 : 400);
  const parsed = parseRequest(body.value);
  if (!parsed) return json({ error: "Invalid evaluation request." }, 400);
  const outcome = await evaluateCount(sceneAt(parsed.sceneIndex), parsed.utterance, request.signal);
  if (outcome.ok) return json({ probability: outcome.probability, model: outcome.model }, 200);
  if (outcome.reason === "unconfigured")
    return json({ error: "Sprout needs TYPESAFE_API_KEY configured on this computer." }, 503);
  return json({ error: "The evaluation service did not answer." }, 502);
}
