import { isLocalRequest, readJsonBody } from "@/lib/local-request";
import { isCountingNodeId } from "@/lib/lesson-runtime/counting-lesson";
import { classifyConversationStateWithDiagnostics } from "@/lib/lesson-runtime/jev-conversation-state-classifier";
import { classifyFullContextObserver } from "@/lib/lesson-runtime/live-experimental-classifier";
import { localClassifierMode, parseClassifierMode } from "@/lib/lesson-runtime/classifier-mode";
import {
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  classificationDiagnostic,
} from "@/lib/lesson-runtime/classification-decision";

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
    ![3, 4].includes(Object.keys(input).length) ||
    Object.keys(input).some(key => !["nodeId", "transcriptRevision", "transcript", "classifierMode"].includes(key)) ||
    ("classifierMode" in input && !parseClassifierMode(input.classifierMode)) ||
    !isCountingNodeId(input.nodeId) ||
    typeof input.transcriptRevision !== "number" ||
    !Number.isSafeInteger(input.transcriptRevision) ||
    input.transcriptRevision < 0 ||
    typeof input.transcript !== "string" ||
    !input.transcript.trim() ||
    input.transcript.length > 12_000
  )
    return json({ error: "Invalid classification request.", code: "invalid_request" }, 400);
  const classifierMode = parseClassifierMode(input.classifierMode) ?? localClassifierMode();
  if (!process.env.TYPESAFE_API_KEY)
    return json({ error: "Configure TYPESAFE_API_KEY for Sprout.", code: "unconfigured", classifierMode }, 503);
  const timeout = AbortSignal.timeout(10_000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const snapshot = {
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      transcript: input.transcript,
    };
    const startedAt = performance.now();
    const selected =
      classifierMode === "legacy"
        ? { mode: "legacy" as const, decision: await classifyConversationStateWithDiagnostics(snapshot, signal) }
        : { mode: "simplified-full-context" as const, decision: await classifyFullContextObserver(snapshot, signal) };
    const elapsedMs = performance.now() - startedAt;
    if (signal.aborted)
      return json(
        { error: "Classification did not finish.", code: timeout.aborted ? "timeout" : "cancelled", classifierMode },
        timeout.aborted ? 504 : 499,
      );
    const identity = { nodeId: snapshot.nodeId, transcriptRevision: snapshot.transcriptRevision, elapsedMs };
    if (selected.mode === "legacy")
      return json({
        proposal: selected.decision.status === "accepted" ? selected.decision.proposal : null,
        diagnostic: { ...classificationDiagnostic(selected.decision), classifierMode, ...identity },
      });
    const { proposal, outputs, outcome, status, reason, labelCompletionEligible } = selected.decision;
    return json({
      proposal,
      diagnostic: {
        classifierMode,
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
        classifierMode,
      },
      timeout.aborted ? 504 : request.signal.aborted ? 499 : 502,
    );
  }
}
