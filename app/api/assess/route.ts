import { validReviewOwner, reviewReferenceOptions, reviewReferences } from "@/lib/lesson-runtime/review-evidence";
import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { resolveLessonDefinition } from "@/lib/lesson-runtime/lesson-registry";
import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
  parseConversationVisits,
} from "@/lib/lesson-runtime/conversation-assessment";
import { JEV_MODEL } from "@/lib/jev";

export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Use the local Sprout window." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Invalid assessment request." }, 415);
  const body = await readJsonBody(request, 600_000);
  if (!body.ok) return json({ error: "Invalid assessment request." }, body.tooLarge ? 413 : 400);
  const input = body.value as { lessonId?: unknown; visits?: unknown; owner?: unknown } | null;
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).sort().join() !== "lessonId,owner,visits" ||
    typeof input.lessonId !== "string" ||
    !validReviewOwner(input.owner) ||
    Object.keys(input.owner).sort().join() !== "generation,runtimeId"
  )
    return json({ error: "Invalid assessment request." }, 400);
  const lesson = resolveLessonDefinition(input.lessonId);
  const visits = lesson && parseConversationVisits(input.visits, lesson);
  if (!lesson?.conversationFirst || !visits) return json({ error: "Invalid assessment request." }, 400);
  const snapshot = { ...input.owner, visits };
  if (!reviewReferenceOptions(snapshot)) return json({ error: "Review reference capacity exceeded." }, 422);
  if (!process.env.TYPESAFE_API_KEY) return json({ error: "Assessment unavailable." }, 503);
  try {
    const payload = JSON.stringify({
      model: JEV_MODEL,
      state: { conversation: visits, learnerReferences: reviewReferences(visits) },
      questions: assessmentQuestions(lesson, snapshot),
    });
    if (new TextEncoder().encode(payload).length > 1_500_000)
      return json({ error: "Review request capacity exceeded." }, 422);
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) return json({ error: "Assessment unavailable." }, 502);
    const result = await response.json();
    const assessment =
      result?.model === JEV_MODEL
        ? normalizeAssessment({ version: ASSESSMENT_VERSION, answers: result?.answers }, lesson, snapshot)
        : null;
    return assessment ? json({ assessment }) : json({ error: "Assessment unavailable." }, 502);
  } catch {
    return json({ error: "Assessment unavailable." }, 502);
  }
}
