import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { isCountingNodeId } from "@/lib/transcript-state-steering/counting-lesson";
import { jevConversationStateClassifier } from "@/lib/transcript-state-steering/jev-conversation-state-classifier";

export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Use the local experiment window." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Invalid classification request." }, 415);
  const body = await readJsonBody(request, 65_536);
  if (!body.ok) return json({ error: "Invalid classification request." }, body.tooLarge ? 413 : 400);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value))
    return json({ error: "Invalid classification request." }, 400);
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
    return json({ error: "Invalid classification request." }, 400);
  if (!process.env.TYPESAFE_API_KEY) return json({ error: "Configure TYPESAFE_API_KEY for the experiment." }, 503);
  try {
    const proposal = await jevConversationStateClassifier.classify(
      {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        transcript: input.transcript,
      },
      AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    );
    // Abstention includes provider unavailability; never expose raw provider bodies.
    return json({ proposal });
  } catch {
    return json({ error: "Classification did not finish." }, 502);
  }
}
