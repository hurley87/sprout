"use client";

import { ADVANCE_THRESHOLD, MICROPHONE_QUIET_MS, TRANSCRIPT_FALLBACK_MS, TRANSCRIPT_TAIL_MS } from "@/lib/answer";
import { evaluationHistory, safeEvaluationRequest, traceScene, type EvaluationTrace } from "@/lib/jev-diagnostics";
import type { Diagnostic } from "@/lib/session";

const ms = (value?: number) => (value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`);
const probability = (value?: number) => (value === undefined ? "—" : value.toFixed(2));

function Timeline({ trace }: { trace: EvaluationTrace }) {
  const stages = ["Child transcript", "Turn end", "Jev request", "Jev response", "Scene transition"];
  const reached = trace.displayed
    ? 5
    : trace.deferred
      ? 4
      : trace.decision
        ? 4
        : trace.jevMs !== undefined
          ? 4
          : trace.requestAt !== undefined
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
            <dt>Turn signal</dt>
            <dd>{active.signal ?? "—"}</dd>
            <dt>Transcript at</dt>
            <dd>{ms(active.transcriptAt)}</dd>
            <dt>Turn end at</dt>
            <dd>{ms(active.turnEndAt)}</dd>
            <dt>Jev start at</dt>
            <dd>{ms(active.requestAt)}</dd>
            <dt>Transcript → request</dt>
            <dd>{ms(active.transcriptToRequestMs)}</dd>
            <dt>Turn end → request</dt>
            <dd>{ms(active.turnEndToRequestMs)}</dd>
            <dt>Jev duration</dt>
            <dd>{ms(active.jevMs)}</dd>
            <dt>Turn end → decision</dt>
            <dd>{ms(active.turnEndToDecisionMs)}</dd>
            <dt>Turn end → commit</dt>
            <dd>{ms(active.turnEndToCommitMs)}</dd>
            <dt>Turn end → display</dt>
            <dd>{ms(active.turnEndToDisplayMs)}</dd>
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
          {active.requestAt !== undefined && (
            <details>
              <summary>Request</summary>
              <p>
                Safe evaluation payload, model, Noul question and threshold. No credentials or provider response body.
              </p>
              <pre>{JSON.stringify(safeEvaluationRequest(active), null, 2)}</pre>
            </details>
          )}
        </>
      ) : (
        <p>
          Waiting for a learner count. Microphone quiet: {ms(MICROPHONE_QUIET_MS)}; transcript tail:{" "}
          {ms(TRANSCRIPT_TAIL_MS)}; fallback: {ms(TRANSCRIPT_FALLBACK_MS)}.
        </p>
      )}
      <h3>Current lesson history</h3>
      <div className="jev-history-scroll">
        <table>
          <thead>
            <tr>
              <th>Utterance</th>
              <th>Scene</th>
              <th>Signal</th>
              <th>End → request</th>
              <th>Jev</th>
              <th>End → decision</th>
              <th>End → display</th>
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
                <td>{trace.signal ?? "—"}</td>
                <td>{ms(trace.turnEndToRequestMs)}</td>
                <td>{ms(trace.jevMs)}</td>
                <td>{ms(trace.turnEndToDecisionMs)}</td>
                <td>{ms(trace.turnEndToDisplayMs)}</td>
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
