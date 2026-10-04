import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { isCountingNodeId } from "@/lib/lesson-runtime/counting-lesson";
import { classifyConversationStateWithDiagnostics } from "@/lib/lesson-runtime/jev-conversation-state-classifier";
import { classificationDiagnostic } from "@/lib/lesson-runtime/classification-decision";

export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isLocalRequest(request))
    return json({ error: "Use the local Sprout window.", code: "local_request_rejected" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 415);
  const body = await readJsonBody(request, 65_536);
  if (!body.ok)
    return json({ error: "Invalid classification request.", code: "invalid_request" }, body.tooLarge ? 413 : 400);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value))
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 400);
  const input = body.value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 3 ||
    Object.keys(input).some(key => !["nodeId", "transcriptRevision", "transcript"].includes(key)) ||
    !isCountingNodeId(input.nodeId) ||
    typeof input.transcriptRevision !== "number" ||
    !Number.isSafeInteger(input.transcriptRevision) ||
    input.transcriptRevision < 0 ||
    typeof input.transcript !== "string" ||
    !input.transcript.trim() ||
    input.transcript.length > 12_000
  )
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 400);
  if (!process.env.TYPESAFE_API_KEY)
    return json({ error: "Configure TYPESAFE_API_KEY for Sprout.", code: "unconfigured" }, 503);
  const timeout = AbortSignal.timeout(10_000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const decision = await classifyConversationStateWithDiagnostics(
      {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        transcript: input.transcript,
      },
      signal,
    );
    if (signal.aborted)
      return json(
        { error: "Classification did not finish.", code: timeout.aborted ? "timeout" : "cancelled" },
        timeout.aborted ? 504 : 499,
      );
    return json({
      proposal: decision.status === "accepted" ? decision.proposal : null,
      diagnostic: classificationDiagnostic(decision),
    });
  } catch {
    return json(
      {
        error: "Classification did not finish.",
        code: timeout.aborted ? "timeout" : request.signal.aborted ? "cancelled" : "internal_error",
      },
      timeout.aborted ? 504 : request.signal.aborted ? 499 : 502,
    );
  }
}
