import { diagnoseObserverOutput } from "../../lib/observer-diagnostics";
import type { DiagnosticAttempt, DiagnosticHistory } from "../../lib/parent-review-diagnostics";
import type { InspectableSessionRecord, TimelineEvent } from "../../lib/session-recorder";
import { observationFixtures } from "./observation-contracts";

/** Invented diagnostics and source material; no provider call or historic record. */
export function reviewDiagnosticFixture() {
  const { record: canonical, proposal } = structuredClone(observationFixtures[0]);
  const response = canonical.events[1];
  if (response.evidence?.type !== "utterance") throw new Error("fixture");
  response.atMs = 20000;
  response.evidence.firstObservedAtMs = 14000;
  response.evidence.lastObservedAtMs = 14500;
  response.evidence.startMs = 50600;
  response.evidence.endMs = 50800;
  response.evidence.providerTiming = { clock: "provider", startMs: 50600, endMs: 50800, sourceId: 1 };
  response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 12000, endMs: 14000 };
  response.evidence.transcriptFragments = [
    { key: "fragment-one", textStart: 0, textEnd: response.evidence.text.length },
  ];
  proposal!.exchangeAtMs = response.atMs;
  const absent = { ...structuredClone(response), _id: "absent-response", atMs: 21000 };
  if (absent.evidence?.type === "utterance")
    absent.evidence.transcriptFragments = [{ key: "fragment-absent", textStart: 0, textEnd: 5 }];
  canonical.events.push(absent);
  const timeline: TimelineEvent = {
    type: "evaluation_control",
    action: "application_result",
    sourceId: 1,
    transcriptRevision: 2,
    applicationAction: "ADVANCE",
    responseIdentity: {
      provenance: "application_evaluation",
      sourceStatus: "known",
      fragmentKeys: ["fragment-one"],
      evaluatedScene: { sceneId: "ducks-3", displayedAtMs: canonical.events[0].atMs },
    },
  };
  canonical.events.push({ _id: "evaluation-event", atMs: 14500, timeline });
  const output = [
    proposal,
    { ...proposal!, proposalId: "rejected-proposal", observation: { ...proposal!.observation, statedTotal: 2 } },
    null,
  ];
  const { rows, ...summary } = diagnoseObserverOutput(canonical, output, "provider_validation").diagnostics;
  summary.failureStage = "provider_validation";
  const attempt: DiagnosticAttempt = {
    snapshotId: "attempt-one",
    attempt: 1,
    startedAt: 100,
    completedAt: 200,
    recordStatus: "incomplete",
    hasRecording: true,
    state: "captured",
    summary,
    snapshotChanged: false,
  };
  const history: DiagnosticHistory = { availability: "recorded", attempts: [attempt], missingAttempts: [] };
  const record: InspectableSessionRecord = {
    id: "saved-session",
    state: "ended",
    recordStatus: "incomplete",
    createdAt: 1,
    recording: {
      recordingId: "saved-session:recording",
      url: "https://synthetic-audio.invalid/saved.wav",
      mimeType: "audio/wav",
      startOffsetMs: 2000,
      durationMs: 30000,
    },
    events: canonical.events.map((event, order) => ({
      id: event._id,
      eventKey: `key-${order}`,
      order,
      atMs: event.atMs,
      evidence: event.evidence,
      timeline: event.timeline as TimelineEvent | undefined,
    })),
  };
  return { canonical, record, rows, attempt, history, responseId: response._id };
}
