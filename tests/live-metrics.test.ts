import { describe, expect, it } from "vitest";
import { diagnosticsTimelines, metrics } from "../scripts/live/metrics.mjs";

describe("reactive answer timing metrics", () => {
  it("attributes a response before the next answer begins", () => {
    const rows = diagnosticsTimelines([
      { at: 2000, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One", transcript_at: 1900 } },
      { at: 2500, type: "answer.requesting", detail: { sceneIndex: 0, version: "10:One" } },
      {
        at: 2900,
        type: "answer.response_gate_released",
        detail: { scene_index: 0, answer_version: "10:One" },
      },
      { at: 2950, type: "transcript.sprout", detail: { delta: "Nice!" } },
      { at: 3010, type: "answer.candidate", detail: { sceneIndex: 0, version: "20:Two", transcript_at: 3000 } },
    ]);
    expect(rows[0]).toMatchObject({
      answerVersion: "10:One",
      firstObservedSproutResponseAtMs: 2950,
      tutorResponseDelayAfterReleaseMs: 50,
      finalTranscriptToFirstObservedResponseMs: 1050,
    });
  });

  it("does not attribute a response after the next answer begins", () => {
    const rows = diagnosticsTimelines([
      { at: 2000, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One", transcript_at: 1900 } },
      {
        at: 2900,
        type: "answer.response_gate_released",
        detail: { scene_index: 0, answer_version: "10:One" },
      },
      { at: 3000, type: "answer.candidate", detail: { sceneIndex: 0, version: "20:Two" } },
      { at: 3050, type: "transcript.sprout", detail: { delta: "Let's count." } },
    ]);
    expect(rows[0]).toMatchObject({
      answerVersion: "10:One",
      firstObservedSproutResponseAtMs: null,
      tutorResponseDelayAfterReleaseMs: null,
      finalTranscriptToFirstObservedResponseMs: null,
    });
  });

  it("allows the later answer to receive its own response", () => {
    const rows = diagnosticsTimelines([
      { at: 2000, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One", transcript_at: 1900 } },
      {
        at: 2900,
        type: "answer.response_gate_released",
        detail: { scene_index: 0, answer_version: "10:One" },
      },
      { at: 3010, type: "answer.candidate", detail: { sceneIndex: 0, version: "20:Two", transcript_at: 3000 } },
      {
        at: 3400,
        type: "answer.response_gate_released",
        detail: { scene_index: 0, answer_version: "20:Two" },
      },
      { at: 3500, type: "transcript.sprout", detail: { delta: "Two ducks!" } },
    ]);
    expect(rows[0]).toMatchObject({
      answerVersion: "10:One",
      firstObservedSproutResponseAtMs: null,
      tutorResponseDelayAfterReleaseMs: null,
      finalTranscriptToFirstObservedResponseMs: null,
    });
    expect(rows[1]).toMatchObject({
      answerVersion: "20:Two",
      firstObservedSproutResponseAtMs: 3500,
      tutorResponseDelayAfterReleaseMs: 100,
      finalTranscriptToFirstObservedResponseMs: 500,
    });
  });

  it("correlates one answer through release and next observed Sprout transcript", () => {
    const events = [
      {
        at: 100,
        type: "answer.candidate",
        detail: { sceneIndex: 0, version: "10:One", transcript_at: 95, utterance: "One" },
      },
      { at: 120, type: "answer.requesting", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 300, type: "answer.evaluated", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 2800, type: "advance.committed", detail: { scene_index: 0, answer_version: "10:One" } },
      { at: 2820, type: "advance.displayed", detail: { scene_index: 0, answer_version: "10:One" } },
      { at: 2900, type: "answer.response_gate_released", detail: { scene_index: 0, answer_version: "10:One" } },
      { at: 3050, type: "transcript.sprout", detail: { scene: "duck-friends", delta: "Great!" } },
    ];
    expect(diagnosticsTimelines(events)[0]).toMatchObject({
      sceneIndex: 0,
      answerVersion: "10:One",
      finalChildTranscriptAtMs: 95,
      evaluationRequestedAtMs: 120,
      evaluationCompletedAtMs: 300,
      sceneCommitAtMs: 2800,
      sceneDisplayedAtMs: 2820,
      applicationResponseReleasedAtMs: 2900,
      firstObservedSproutResponseAtMs: 3050,
      stabilizationWaitAfterEvaluationMs: 2500,
      tutorResponseDelayAfterReleaseMs: 150,
      finalTranscriptToEvaluationRequestMs: 25,
      finalTranscriptToEvaluationCompletionMs: 205,
      finalTranscriptToSceneCommitMs: 2705,
      finalTranscriptToFirstObservedResponseMs: 2955,
    });
  });

  it("keeps stages unavailable and refuses to join events from another scene or answer", () => {
    const rows = diagnosticsTimelines([
      { at: 100, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One", transcript_at: 95 } },
      { at: 120, type: "answer.requesting", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 500, type: "answer.evaluated", detail: { sceneIndex: 1, version: "10:One" } },
      { at: 700, type: "answer.response_gate_released", detail: { scene_index: 0, answer_version: "different" } },
      { at: 800, type: "transcript.sprout", detail: { delta: "unrelated" } },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toHaveProperty("sceneCommitAtMs");
    expect(rows[0]).not.toHaveProperty("evaluationCompletedAtMs");
    expect(rows[0]).not.toHaveProperty("sceneDisplayedAtMs");
    expect(rows[0]).not.toHaveProperty("applicationResponseReleasedAtMs");
    expect(rows[0]).toMatchObject({
      firstObservedSproutResponseAtMs: null,
      stabilizationWaitAfterEvaluationMs: null,
      tutorResponseDelayAfterReleaseMs: null,
      finalTranscriptToSceneCommitMs: null,
    });
    expect(rows[1]).toMatchObject({ sceneIndex: 1, answerVersion: "10:One" });
    expect(rows[2].answerVersion).toBe("different");
  });

  it("keeps browser log metrics while marking app diagnostics unavailable", () => {
    const summary = metrics([{ dir: "evaluate", request: { utterance: "One", sceneIndex: 0 }, at: 300, askedAt: 100 }]);
    expect(summary.evaluations[0].latencyMs).toBe(200);
    expect(summary.timingClock).toBeNull();
    expect(summary.answerTimelines).toBeNull();
  });

  it("derives overlapping condition intervals, deadline changes, revision identity, and missing terminal evidence", () => {
    const rows = diagnosticsTimelines([
      { at: 10, type: "answer.candidate", detail: { sceneIndex: 0, revision: 1, version: "10:One", transcript_at: 9 } },
      {
        at: 20,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          conditions: ["correction_window", "output_transcript_quiet"],
          output_blocked: true,
          correction_ready_at: 30,
          output_quiet_at: 80,
          trigger: "decision",
        },
      },
      {
        at: 30,
        type: "answer.response_gate_deadline_updated",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          previous_deadline_at: 80,
          deadline_at: 100,
          extension_ms: 20,
        },
      },
      {
        at: 30,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          conditions: ["output_transcript_quiet"],
          output_blocked: true,
          correction_ready_at: 30,
          output_quiet_at: 100,
          trigger: "deadline_updated",
        },
      },
      {
        at: 40,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          conditions: ["output_transcript_quiet"],
          output_blocked: true,
          output_quiet_at: 100,
          blocked_output_activity: true,
          trigger: "blocked_provider_transcript",
        },
      },
      {
        at: 60,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          conditions: [],
          output_blocked: false,
          output_quiet_at: 100,
          trigger: "released",
        },
      },
      {
        at: 60,
        type: "answer.response_gate_released",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          decision: "STAY",
          reason: "correction_window",
          context_sent_at: 60,
          eligible_at: 50,
        },
      },
      {
        at: 70,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 1,
          answer_version: "10:One",
          conditions: [],
          output_blocked: false,
          trigger: "identity_superseded",
          superseded_by_transcript_revision: 2,
        },
      },
      {
        at: 70,
        type: "answer.response_gate_observed",
        detail: {
          scene_index: 0,
          transcript_revision: 2,
          answer_version: "10:One",
          conditions: ["answer_evaluation"],
          output_blocked: true,
          trigger: "identity_updated",
        },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      transcriptRevision: 1,
      conditionDurationMs: {
        correction_window: { durationMs: 10 },
        output_transcript_quiet: { durationMs: 40 },
      },
      observedBlockedUnionMs: 40,
      blockedProviderOutputActivityCount: 1,
      outputQuietDeadlineUpdates: [{ previousDeadlineAtMs: 80, deadlineAtMs: 100, extensionMs: 20 }],
      gateReleaseReason: "correction_window",
      gateDecision: "STAY",
      gateContextSentAtMs: 60,
      providerOutputCompletionAtMs: null,
      audibleOnsetAtMs: null,
      conditionDurationsAreOverlapping: true,
      gateSupersededAtMs: 70,
    });
    expect(rows[0].conditionDurationMs.correction_window.intervals[0]).toMatchObject({
      startAtMs: 20,
      endAtMs: 30,
      durationMs: 10,
    });
    expect(rows[1]).toMatchObject({ transcriptRevision: 2, gateObservations: expect.any(Array) });
    expect(rows[1]).not.toHaveProperty("applicationResponseReleasedAtMs");
  });

  it("joins historical revisionless stages only when revision evidence is unique", () => {
    const rows = diagnosticsTimelines([
      { at: 100, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One", transcript_at: 90 } },
      { at: 120, type: "answer.requesting", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 300, type: "answer.evaluated", detail: { sceneIndex: 0, revision: 1, version: "10:One" } },
      { at: 400, type: "advance.committed", detail: { scene_index: 0, answer_version: "10:One" } },
      { at: 410, type: "advance.displayed", detail: { scene_index: 0, answer_version: "10:One" } },
      {
        at: 420,
        type: "answer.response_gate_observed",
        detail: { scene_index: 0, transcript_revision: 1, answer_version: "10:One", conditions: [] },
      },
      {
        at: 430,
        type: "answer.response_gate_released",
        detail: { scene_index: 0, transcript_revision: 1, answer_version: "10:One" },
      },
      { at: 450, type: "transcript.sprout", detail: { delta: "Great" } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transcriptRevision: 1,
      revisionCorrelation: "inferred_unique_revision",
      evaluationRequestedAtMs: 120,
      sceneCommitAtMs: 400,
      sceneDisplayedAtMs: 410,
      finalTranscriptToFirstObservedResponseMs: 360,
    });
  });

  it("keeps revisionless evidence unknown when a repeated answer version has multiple revisions", () => {
    const rows = diagnosticsTimelines([
      { at: 10, type: "answer.candidate", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 20, type: "answer.requesting", detail: { sceneIndex: 0, version: "10:One" } },
      { at: 30, type: "answer.candidate", detail: { sceneIndex: 0, revision: 1, version: "10:One" } },
      {
        at: 40,
        type: "answer.response_gate_observed",
        detail: { scene_index: 0, transcript_revision: 1, answer_version: "10:One", conditions: [] },
      },
      {
        at: 50,
        type: "answer.response_gate_observed",
        detail: { scene_index: 0, transcript_revision: 2, answer_version: "10:One", conditions: [] },
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.revisionCorrelation === "ambiguous_revision")).toMatchObject({
      transcriptRevision: null,
      evaluationRequestedAtMs: 20,
    });
  });
});
