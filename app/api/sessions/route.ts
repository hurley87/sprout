import { put } from "@vercel/blob";
import { isAllowedRequest } from "@/lib/access";
import { resolveLessonDefinition } from "@/lib/lesson-runtime/lesson-registry";
import { readJsonBody } from "@/lib/local-request";
import { sessionBlobPath, sessionSavingEnabled } from "@/lib/session-store";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const json = (body: object, status: number) => Response.json(body, { status, headers });
const invalidRequest = (status: number) => json({ error: "Invalid session request.", code: "invalid_request" }, status);
const runtimeIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function POST(request: Request) {
  if (!(await isAllowedRequest(request)))
    return json(
      { error: "Use the local Sprout window, or enter the family passcode.", code: "local_request_rejected" },
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("application/json")) return invalidRequest(415);

  const body = await readJsonBody(request, 4_000_000);
  if (!body.ok) return invalidRequest(body.tooLarge ? 413 : 400);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) return invalidRequest(400);

  const { lessonId, runtimeId, report } = body.value as Record<string, unknown>;
  const lesson = resolveLessonDefinition(lessonId);
  if (
    Object.keys(body.value).length !== 3 ||
    !lesson ||
    typeof runtimeId !== "string" ||
    !runtimeIdPattern.test(runtimeId) ||
    !report ||
    typeof report !== "object" ||
    Array.isArray(report)
  )
    return invalidRequest(400);

  if (!sessionSavingEnabled()) return new Response(null, { status: 204, headers });

  const pathname = sessionBlobPath({ lessonId: lesson.id, runtimeId, now: new Date() });
  try {
    await put(pathname, JSON.stringify(report, null, 2), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return json({ saved: true, pathname }, 201);
  } catch {
    console.error("Could not save the Sprout session to Blob.");
    return json({ error: "Could not save the session.", code: "storage_failed" }, 502);
  }
}
