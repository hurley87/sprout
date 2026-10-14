import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { resolveLessonDefinition } from "@/lib/lesson-runtime/lesson-registry";
import {
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
  const input = body.value as { lessonId?: unknown; visits?: unknown } | null;
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).sort().join() !== "lessonId,visits" ||
    typeof input.lessonId !== "string"
  )
    return json({ error: "Invalid assessment request." }, 400);
  const lesson = resolveLessonDefinition(input.lessonId);
  const visits = lesson && parseConversationVisits(input.visits, lesson);
  if (!lesson?.conversationFirst || !visits) return json({ error: "Invalid assessment request." }, 400);
  if (!process.env.TYPESAFE_API_KEY) return json({ error: "Assessment unavailable." }, 503);
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: { conversation: visits },
        questions: assessmentQuestions(lesson),
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) return json({ error: "Assessment unavailable." }, 502);
    const result = await response.json();
    const assessment = result?.model === JEV_MODEL ? normalizeAssessment(result, lesson) : null;
    return assessment ? json({ assessment }) : json({ error: "Assessment unavailable." }, 502);
  } catch {
    return json({ error: "Assessment unavailable." }, 502);
  }
}
