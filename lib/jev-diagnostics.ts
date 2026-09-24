import { ADVANCE_THRESHOLD, ANSWER_QUESTION, JEV_MODEL, answerState } from "./answer";
import { objectName, sceneAt } from "./lesson";
import type { Diagnostic } from "./session";

export type EvaluationTrace = {
  version: string;
  sceneIndex: number;
  utterance: string;
  phase:
    | "turn detection"
    | "skipped"
    | "requesting Jev"
    | "evaluated"
    | "unavailable"
    | "stale/cancelled"
    | "deferred advance";
  signal?: string;
  transcriptAt?: number;
  estimatedAcousticEndAt?: number;
  turnEndAt?: number;
  requestAt?: number;
  transcriptToRequestMs?: number;
  vadDetectionMs?: number;
  turnEndToRequestMs?: number;
  jevMs?: number;
  answerSettleMs?: number;
  settleReadyAt?: number;
  decisionAt?: number;
  remainingSettleMsAtDecision?: number;
  decisionReleasableAt?: number;
  acousticToDecisionMs?: number;
  turnEndToDecisionMs?: number;
  turnEndToCommitMs?: number;
  acousticToDisplayMs?: number;
  turnEndToDisplayMs?: number;
  probability?: number;
  reason?: string;
  decision?: "ADVANCE" | "STAY" | "UNAVAILABLE" | "STALE";
  stale: boolean;
  deferred: boolean;
  deferredMs?: number;
  displayed: boolean;
};
const detailOf = (event: Diagnostic): Record<string, unknown> | null =>
  event.detail && typeof event.detail === "object" ? (event.detail as Record<string, unknown>) : null;

/** Pure view of application events. */
export function evaluationHistory(events: readonly Diagnostic[]): EvaluationTrace[] {
  const traces: EvaluationTrace[] = [];
  const byVersion = new Map<string, EvaluationTrace>();
  for (const event of events) {
    const detail = detailOf(event);
    if (!detail) continue;
    const version =
      event.type === "answer.decision_releasable"
        ? detail.answer_version
        : event.type.startsWith("answer.")
          ? detail.version
          : detail.answer_version;
    if (typeof version !== "string") continue;
    if (event.type === "answer.candidate") {
      if (typeof detail.sceneIndex !== "number" || typeof detail.utterance !== "string") continue;
      const previous = traces.at(-1);
      if (previous?.phase === "turn detection") {
        traces.pop();
        byVersion.delete(previous.version);
      }
      const trace: EvaluationTrace = {
        version,
        sceneIndex: detail.sceneIndex,
        utterance: detail.utterance,
        phase: "turn detection",
        signal: detail.signal as string,
        transcriptAt: detail.transcript_at as number,
        stale: false,
        deferred: false,
        displayed: false,
      };
      traces.push(trace);
      byVersion.set(version, trace);
      continue;
    }
    const trace = byVersion.get(version);
    if (!trace) continue;
    switch (event.type) {
      case "answer.skipped":
        trace.phase = "skipped";
        trace.reason = detail.reason as string;
        break;
      case "answer.requesting":
        trace.phase = "requesting Jev";
        trace.signal = detail.signal as string;
        trace.turnEndAt = detail.turn_end_at as number;
        trace.vadDetectionMs = typeof detail.vad_detection_ms === "number" ? detail.vad_detection_ms : undefined;
        trace.estimatedAcousticEndAt =
          trace.vadDetectionMs === undefined ? undefined : trace.turnEndAt - trace.vadDetectionMs;
        trace.requestAt = event.at;
        trace.transcriptToRequestMs = detail.transcript_to_request_ms as number;
        trace.turnEndToRequestMs = detail.turn_end_to_request_ms as number;
        break;
      case "answer.evaluated":
        trace.jevMs = detail.latency_ms as number;
        trace.answerSettleMs = detail.answer_settle_ms as number;
        trace.settleReadyAt = detail.settle_ready_at as number;
        trace.decisionAt = detail.decision_at as number;
        trace.remainingSettleMsAtDecision = detail.remaining_settle_ms_at_decision as number;
        trace.turnEndToDecisionMs = detail.turn_end_to_decision_ms as number;
        trace.acousticToDecisionMs =
          trace.vadDetectionMs === undefined ? undefined : trace.vadDetectionMs + trace.turnEndToDecisionMs;
        trace.probability = typeof detail.probability === "number" ? detail.probability : undefined;
        trace.reason = typeof detail.unavailable === "string" ? detail.unavailable : undefined;
        trace.decision = detail.decision as EvaluationTrace["decision"];
        trace.stale = detail.stale === true;
        trace.phase = trace.stale ? "stale/cancelled" : trace.reason ? "unavailable" : "evaluated";
        break;
      case "advance.committed":
        trace.turnEndToCommitMs = detail.turn_end_to_commit_ms as number;
        break;
      case "advance.deferred":
        trace.deferred = true;
        trace.phase = "deferred advance";
        break;
      case "advance.released":
        trace.deferredMs = detail.delay_ms as number;
        trace.phase = "evaluated";
        break;
      case "answer.decision_releasable":
        trace.decisionReleasableAt = event.at;
        break;
      case "advance.cancelled":
        trace.deferredMs = detail.delay_ms as number;
        trace.stale = true;
        trace.decision = "STALE";
        trace.phase = "stale/cancelled";
        break;
      case "advance.displayed":
        trace.displayed = true;
        trace.turnEndToDisplayMs = detail.turn_end_to_display_ms as number;
        trace.acousticToDisplayMs =
          trace.vadDetectionMs === undefined ? undefined : trace.vadDetectionMs + trace.turnEndToDisplayMs;
        break;
    }
  }
  return traces;
}

export function safeEvaluationRequest(trace: EvaluationTrace) {
  return {
    state: answerState(sceneAt(trace.sceneIndex), trace.utterance),
    model: JEV_MODEL,
    question: ANSWER_QUESTION,
    threshold: ADVANCE_THRESHOLD,
  };
}
export function traceScene(trace: EvaluationTrace) {
  const scene = sceneAt(trace.sceneIndex);
  return `${scene.quantity} ${objectName(scene)}`;
}
