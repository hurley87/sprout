"use client";

import {
  ADVANCE_THRESHOLD,
  ANSWER_SETTLE_MS,
  MICROPHONE_ONSET_MS,
  MICROPHONE_ONSET_QUIET_MS,
  MICROPHONE_QUIET_MS,
  TRANSCRIPT_FALLBACK_MS,
  TRANSCRIPT_TAIL_MS,
} from "@/lib/answer";
import { evaluationHistory, safeEvaluationRequest, traceScene, type EvaluationTrace } from "@/lib/jev-diagnostics";
import type { Diagnostic } from "@/lib/session";

const ms = (value?: number) => (value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`);
const probability = (value?: number) => (value === undefined ? "—" : value.toFixed(2));
const eventDetail = (event?: Diagnostic) =>
  event?.detail && typeof event.detail === "object" ? (event.detail as Record<string, unknown>) : {};
const latestEvent = (events: readonly Diagnostic[], type: string) =>
  [...events].reverse().find(event => event.type === type);
const firstEvent = (events: readonly Diagnostic[], type: string) => events.find(event => event.type === type);
const elapsed = (event?: Diagnostic) => (event ? ms(event.at) : "—");

function Timeline({ trace }: { trace: EvaluationTrace }) {
  const stages = [
    trace.vadDetectionMs === undefined ? "Child transcript" : "Estimated acoustic end",
    trace.signal === "microphone_vad" ? "VAD detection" : "Fallback turn end",
    "Jev request",
    "Jev response",
    "Scene transition",
  ];
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
  const feedbackGate = latestEvent(events, "answer.feedback_gate");
  const feedbackGateDetail = eventDetail(feedbackGate);
  const feedbackViolations = events.filter(event => event.type === "answer.feedback_violation");
  const lastViolation = feedbackViolations.at(-1);
  const lastDecisionRelease = latestEvent(events, "answer.decision_releasable");
  const lastContextRelease = latestEvent(events, "answer.context_release");
  const contextReleaseId = eventDetail(lastContextRelease).command_id;
  const contextApplied = events.find(
    event => event.type === "answer.context_applied" && eventDetail(event).command_id === contextReleaseId,
  );
  const nonAnswerRelease = latestEvent(events, "answer.feedback_non_answer_release");
  const outputQuiet = latestEvent(events, "answer.feedback_output_quiet");
  const waitingOutputQuiet = latestEvent(events, "answer.feedback_waiting_for_output_quiet");
  const startup = {
    ready: firstEvent(events, "lesson.started"),
    scene: firstEvent(events, "initial_scene.displayed"),
    context: firstEvent(events, "startup.context_sent"),
    transcript: firstEvent(events, "startup.first_sprout_transcript"),
    audio: firstEvent(events, "startup.first_audio_playing"),
  };
  const delta = (from?: Diagnostic, to?: Diagnostic) => (from && to ? ms(to.at - from.at) : "—");
  return (
    <aside className="jev-diagnostics" aria-label="Jev diagnostics">
      <h2>Jev diagnostics</h2>
      <h3>Startup timing</h3>
      <dl className="jev-facts">
        <dt>Live/session ready</dt>
        <dd>{elapsed(startup.ready)}</dd>
        <dt>Initial scene displayed</dt>
        <dd>{elapsed(startup.scene)}</dd>
        <dt>Opening context sent</dt>
        <dd>{elapsed(startup.context)}</dd>
        <dt>First Sprout transcript</dt>
        <dd>{elapsed(startup.transcript)}</dd>
        <dt>Browser audio playing</dt>
        <dd>{elapsed(startup.audio)}</dd>
        <dt>Ready → opening context</dt>
        <dd>{delta(startup.ready, startup.context)}</dd>
        <dt>Opening context → first transcript</dt>
        <dd>{delta(startup.context, startup.transcript)}</dd>
      </dl>
      <p>
        Transcript receipt is not proof of playback. Browser audio playing reports media-element playback activity, not
        exact acoustic onset or listener audibility.
      </p>
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
            <dt>Estimated acoustic end at</dt>
            <dd>{ms(active.estimatedAcousticEndAt)}</dd>
            <dt>{active.signal === "microphone_vad" ? "VAD detected at" : "Fallback turn end at"}</dt>
            <dd>{ms(active.turnEndAt)}</dd>
            <dt>Acoustic end → VAD detection</dt>
            <dd>{ms(active.vadDetectionMs)}</dd>
            <dt>Jev start at</dt>
            <dd>{ms(active.requestAt)}</dd>
            <dt>Transcript → request</dt>
            <dd>{ms(active.transcriptToRequestMs)}</dd>
            <dt>Detected end → request</dt>
            <dd>{ms(active.turnEndToRequestMs)}</dd>
            <dt>Jev duration</dt>
            <dd>{ms(active.jevMs)}</dd>
            <dt>Decision time</dt>
            <dd>{ms(active.decisionAt)}</dd>
            <dt>Settle remaining when Jev decided</dt>
            <dd>{ms(active.remainingSettleMsAtDecision)}</dd>
            <dt>Answer settle interval</dt>
            <dd>{ms(active.answerSettleMs ?? ANSWER_SETTLE_MS)}</dd>
            <dt>Settle deadline</dt>
            <dd>{ms(active.settleReadyAt)}</dd>
            <dt>Decision releasable</dt>
            <dd>{ms(active.decisionReleasableAt)}</dd>
            <dt>{active.signal === "microphone_vad" ? "VAD detection → decision" : "Fallback end → decision"}</dt>
            <dd>{ms(active.turnEndToDecisionMs)}</dd>
            <dt>Estimated acoustic end → decision</dt>
            <dd>{ms(active.acousticToDecisionMs)}</dd>
            <dt>Detected end → commit</dt>
            <dd>{ms(active.turnEndToCommitMs)}</dd>
            <dt>Detected end → display</dt>
            <dd>{ms(active.turnEndToDisplayMs)}</dd>
            <dt>Estimated acoustic end → display</dt>
            <dd>{ms(active.acousticToDisplayMs)}</dd>
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
            <dt>Deferred advance</dt>
            <dd>{active.deferred ? "Yes" : "No"}</dd>
            <dt>Deferred delay</dt>
            <dd>{ms(active.deferredMs)}</dd>
          </dl>
          <p>Acoustic end is estimated from the first quiet microphone frame, not a verified final-word timestamp.</p>
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
          Waiting for a learner count. Microphone onset: {ms(MICROPHONE_ONSET_MS)}; provisional burst quiet:{" "}
          {ms(MICROPHONE_ONSET_QUIET_MS)}; speech stop quiet: {ms(MICROPHONE_QUIET_MS)}; transcript tail:{" "}
          {ms(TRANSCRIPT_TAIL_MS)}; fallback/grace: {ms(TRANSCRIPT_FALLBACK_MS)}; answer settle interval:{" "}
          {ms(ANSWER_SETTLE_MS)}. This is a learner-side timing safeguard, not a guaranteed acoustic boundary.
        </p>
      )}
      <h3>Answer feedback ordering</h3>
      <dl className="jev-facts">
        <dt>Browser playback gate</dt>
        <dd>
          {feedbackGate
            ? `${String(feedbackGateDetail.state)} (${String(feedbackGateDetail.phase)}) at ${ms(feedbackGate.at)}`
            : "Not engaged"}
        </dd>
        <dt>Premature substantive transcripts</dt>
        <dd>{feedbackViolations.length}</dd>
        <dt>Last transcript violation</dt>
        <dd>
          {lastViolation
            ? `${String(eventDetail(lastViolation).transcript)} at ${ms(lastViolation.at)}; playback is not verified`
            : "None recorded"}
        </dd>
        <dt>Latest decision became releasable</dt>
        <dd>
          {lastDecisionRelease
            ? `${String(eventDetail(lastDecisionRelease).decision)} at ${ms(lastDecisionRelease.at)}`
            : "Not yet"}
        </dd>
        <dt>Non-answer turn released</dt>
        <dd>{nonAnswerRelease ? `Yes, at ${ms(nonAnswerRelease.at)}` : "Not recorded"}</dd>
        <dt>Premature output quiet</dt>
        <dd>
          {outputQuiet
            ? `Transcript quiet at ${ms(outputQuiet.at)}; this is a bounded heuristic, not provider completion`
            : waitingOutputQuiet
              ? `Waiting since ${ms(waitingOutputQuiet.at)}; provider output completion is unverified`
              : "No wait required"}
        </dd>
        <dt>Answer context released</dt>
        <dd>
          {lastContextRelease
            ? `${String(eventDetail(lastContextRelease).decision ?? "session context")} at ${ms(lastContextRelease.at)}${contextApplied ? `; applied at ${ms(contextApplied.at)}` : "; awaiting provider acknowledgment"}`
            : "Not yet"}
        </dd>
      </dl>
      <h3>Current lesson history</h3>
      <div className="jev-history-scroll">
        <table>
          <thead>
            <tr>
              <th>Utterance</th>
              <th>Scene</th>
              <th>Signal</th>
              <th>Detected end → request</th>
              <th>Jev</th>
              <th>Detected end → decision</th>
              <th>Est. acoustic end → decision</th>
              <th>Detected end → display</th>
              <th>Est. acoustic end → display</th>
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
                <td>{ms(trace.acousticToDecisionMs)}</td>
                <td>{ms(trace.turnEndToDisplayMs)}</td>
                <td>{ms(trace.acousticToDisplayMs)}</td>
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
