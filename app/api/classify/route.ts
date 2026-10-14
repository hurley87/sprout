import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { isLessonNodeId } from "@/lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "@/lib/lesson-runtime/lesson-registry";
import { classifyConversationStateWithDiagnostics } from "@/lib/lesson-runtime/jev-conversation-state-classifier";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
} from "@/lib/lesson-runtime/conversation-observer-contract";

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
    Object.keys(input).length !== 4 ||
    Object.keys(input).some(key => !["lessonId", "nodeId", "transcriptRevision", "transcript"].includes(key)) ||
    typeof input.lessonId !== "string" ||
    typeof input.transcriptRevision !== "number" ||
    !Number.isSafeInteger(input.transcriptRevision) ||
    input.transcriptRevision < 0 ||
    typeof input.transcript !== "string" ||
    !input.transcript.trim() ||
    input.transcript.length > 12_000
  )
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 400);
  const lesson = resolveLessonDefinition(input.lessonId);
  if (!lesson || !isLessonNodeId(lesson, input.nodeId))
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 400);
  if (!process.env.TYPESAFE_API_KEY)
    return json(
      { error: "Configure TYPESAFE_API_KEY for Sprout.", code: "unconfigured", classifierVersion: CLASSIFIER_VERSION },
      503,
    );
  const timeout = AbortSignal.timeout(10_000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const snapshot = {
      lesson,
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      transcript: input.transcript,
    };
    const startedAt = performance.now();
    const decision = await classifyConversationStateWithDiagnostics(snapshot, signal);
    const elapsedMs = performance.now() - startedAt;
    if (signal.aborted)
      return json(
        {
          error: "Classification did not finish.",
          code: timeout.aborted ? "timeout" : "cancelled",
          classifierVersion: CLASSIFIER_VERSION,
        },
        timeout.aborted ? 504 : 499,
      );
    const identity = { nodeId: snapshot.nodeId, transcriptRevision: snapshot.transcriptRevision, elapsedMs };
    const { proposal, outputs, outcome, status, reason, labelCompletionEligible } = decision;
    return json({
      proposal,
      diagnostic: {
        classifierVersion: CLASSIFIER_VERSION,
        decision: status,
        outputs,
        outcome,
        ...(reason ? { reason } : {}),
        labelCompletionEligible,
        thresholds: { ...CONVERSATION_CLASSIFICATION_THRESHOLDS },
        ...identity,
      },
    });
  } catch {
    return json(
      {
        error: "Classification did not finish.",
        code: timeout.aborted ? "timeout" : request.signal.aborted ? "cancelled" : "internal_error",
        classifierVersion: CLASSIFIER_VERSION,
      },
      timeout.aborted ? 504 : request.signal.aborted ? 499 : 502,
    );
  }
}
