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
});
