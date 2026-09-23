import { ADVANCE_THRESHOLD, ANSWER_QUESTION, JEV_MODEL, SETTLE_MS, answerState } from "./answer";
import { objectName, sceneAt } from "./lesson";
import type { Diagnostic } from "./session";

export type EvaluationTrace = {
  version: string;
  sceneIndex: number;
  utterance: string;
  phase: "settling" | "requesting Jev" | "evaluated" | "unavailable" | "stale/cancelled" | "deferred advance";
  configuredSettleMs: number;
  actualSettleMs?: number;
  jevMs?: number;
  totalMs?: number;
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

/** Pure view of the application events. React does not make answer decisions. */
export function evaluationHistory(events: readonly Diagnostic[]): EvaluationTrace[] {
  const traces: EvaluationTrace[] = [];
  const byVersion = new Map<string, EvaluationTrace>();
  for (const event of events) {
    const detail = detailOf(event);
    if (!detail) continue;
    const version =
      event.type === "answer.settling" || event.type === "answer.requesting" || event.type === "answer.evaluated"
        ? detail.version
        : detail.answer_version;
    if (typeof version !== "string") continue;
    if (event.type === "answer.settling") {
      if (typeof detail.sceneIndex !== "number" || typeof detail.utterance !== "string") continue;
      // A transcript delta replaces an unfinished settle candidate. Only
      // requests that were actually sent belong in evaluation history.
      const previous = traces.at(-1);
      if (previous?.phase === "settling") {
        traces.pop();
        byVersion.delete(previous.version);
      }
      const trace: EvaluationTrace = {
        version,
        sceneIndex: detail.sceneIndex,
        utterance: detail.utterance,
        phase: "settling",
        configuredSettleMs: SETTLE_MS,
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
      case "answer.requesting":
        trace.phase = "requesting Jev";
        trace.actualSettleMs = detail.actual_settle_ms as number;
        break;
      case "answer.evaluated":
        trace.jevMs = detail.latency_ms as number;
        trace.totalMs = detail.total_ms as number;
        trace.probability = typeof detail.probability === "number" ? detail.probability : undefined;
        trace.reason = typeof detail.unavailable === "string" ? detail.unavailable : undefined;
        trace.decision = detail.decision as EvaluationTrace["decision"];
        trace.stale = detail.stale === true;
        trace.phase = trace.stale ? "stale/cancelled" : trace.reason ? "unavailable" : "evaluated";
        break;
      case "advance.deferred":
        trace.deferred = true;
        trace.phase = "deferred advance";
        break;
      case "advance.released":
        trace.deferredMs = detail.delay_ms as number;
        trace.phase = "evaluated";
        break;
      case "advance.cancelled":
        trace.deferredMs = detail.delay_ms as number;
        trace.stale = true;
        trace.decision = "STALE";
        trace.phase = "stale/cancelled";
        break;
      case "advance.displayed":
        trace.displayed = true;
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
