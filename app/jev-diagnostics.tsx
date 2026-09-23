"use client";

import { ADVANCE_THRESHOLD, SETTLE_MS } from "@/lib/answer";
import { evaluationHistory, safeEvaluationRequest, traceScene, type EvaluationTrace } from "@/lib/jev-diagnostics";
import type { Diagnostic } from "@/lib/session";

const ms = (value?: number) => (value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`);
const probability = (value?: number) => (value === undefined ? "—" : value.toFixed(2));

function Timeline({ trace }: { trace: EvaluationTrace }) {
  const stages = ["Child transcript", "Settle", "Jev request", "Jev response", "Scene transition"];
  const reached = trace.displayed
    ? 5
    : trace.deferred
      ? 4
      : trace.decision
        ? 4
        : trace.jevMs !== undefined
          ? 4
          : trace.actualSettleMs !== undefined
            ? 3
            : 2;
  return (
    <ol className="jev-timeline">
      {stages.map((stage, index) => (
        <li key={stage} className={index < reached ? "reached" : ""}>
          {stage}
        </li>
      ))}
    </ol>
  );
}

export function JevDiagnostics({ events }: { events: readonly Diagnostic[] }) {
  const history = evaluationHistory(events);
  const active = history.at(-1);
  return (
    <aside className="jev-diagnostics" aria-label="Jev diagnostics">
      <h2>Jev diagnostics</h2>
      {active ? (
        <>
          <dl className="jev-facts">
            <dt>Scene</dt>
            <dd>{traceScene(active)}</dd>
            <dt>Utterance</dt>
            <dd>“{active.utterance}”</dd>
            <dt>Phase</dt>
            <dd>{active.phase}</dd>
            <dt>Configured settle</dt>
            <dd>{ms(active.configuredSettleMs)}</dd>
            <dt>Actual settle</dt>
            <dd>{ms(active.actualSettleMs)}</dd>
            <dt>Jev request</dt>
            <dd>{ms(active.jevMs)}</dd>
            <dt>Total to decision</dt>
            <dd>{ms(active.totalMs)}</dd>
            <dt>Probability</dt>
            <dd>{probability(active.probability)}</dd>
            <dt>Threshold</dt>
            <dd>{ADVANCE_THRESHOLD.toFixed(2)}</dd>
            <dt>Status</dt>
            <dd>{active.reason === "timeout" ? "TIMEOUT" : (active.reason ?? "—")}</dd>
            <dt>Decision</dt>
            <dd>{active.decision ?? "—"}</dd>
            <dt>Stale</dt>
            <dd>{active.stale ? "Yes" : "No"}</dd>
            <dt>Deferred for speech</dt>
            <dd>{active.deferred ? "Yes" : "No"}</dd>
            <dt>Deferred delay</dt>
            <dd>{ms(active.deferredMs)}</dd>
          </dl>
          <Timeline trace={active} />
          <details>
            <summary>Request</summary>
            <p>
              Safe evaluation payload, model, Noul question and threshold. No credentials or provider response body.
            </p>
            <pre>{JSON.stringify(safeEvaluationRequest(active), null, 2)}</pre>
          </details>
        </>
      ) : (
        <p>Waiting for a learner answer. Configured settle: {ms(SETTLE_MS)}.</p>
      )}
      <h3>Current lesson history</h3>
      <div className="jev-history-scroll">
        <table>
          <thead>
            <tr>
              <th>Utterance</th>
              <th>Scene</th>
              <th>Settle</th>
              <th>Jev</th>
              <th>Probability</th>
              <th>Decision</th>
              <th>Deferred</th>
            </tr>
          </thead>
          <tbody>
            {history.map(trace => (
              <tr key={trace.version}>
                <td>{trace.utterance}</td>
                <td>{traceScene(trace)}</td>
                <td>{ms(trace.actualSettleMs)}</td>
                <td>{ms(trace.jevMs)}</td>
                <td>{probability(trace.probability)}</td>
                <td>
                  {trace.reason === "timeout" ? "TIMEOUT / " : ""}
                  {trace.decision ?? trace.phase}
                </td>
                <td>{trace.deferred ? ms(trace.deferredMs) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
