import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";
import { ACK_DEADLINE_MS, type AckInput } from "@/lib/experiments/grok-counting/acknowledgment";
import { classifyAcknowledgment } from "@/lib/experiments/grok-counting/jev-acknowledgment";
export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "local_request_rejected" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "invalid_request" }, 415);
  const body = await readJsonBody(request, 12_000);
  if (!body.ok) return json({ error: "invalid_request" }, body.tooLarge ? 413 : 400);
  const input = body.value as AckInput | null;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 5 ||
    Object.keys(input).some(key => !["nodeId", "expectedAnswer", "learner", "tutor", "requestId"].includes(key)) ||
    Object.values(input).some(value => typeof value !== "string" || !value.trim() || value.length > 2000) ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)
  )
    return json({ error: "invalid_request" }, 400);
  const node = COUNTING_LESSON.nodes[input.nodeId]?.presentation;
  if (!node || input.expectedAnswer !== `${node.quantity} ${node.object}`)
    return json({ error: "invalid_request" }, 400);
  const timeout = AbortSignal.timeout(ACK_DEADLINE_MS);
  const signal = AbortSignal.any([request.signal, timeout]);
  const decision = await classifyAcknowledgment(input, signal);
  return json(
    signal.aborted
      ? {
          requestId: input.requestId,
          outcome: "abstain",
          reason: timeout.aborted ? "timeout" : "cancelled",
          modelValidated: false,
        }
      : decision,
  );
}
