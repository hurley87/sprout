import { expect, it } from "vitest";
import { projectMathDiagnostics, summarizeMathEvaluation } from "../lib/calculus/math-diagnostics";
import type { LessonDiagnostic } from "../lib/lesson-runtime/diagnostic-journal";
import { createMathState } from "../lib/calculus/math-state";

const before = createMathState({
  runtimeId: "runtime",
  problemId: "cubic-minus-linear",
  visitId: "visit_1",
  transcriptRevision: 3,
  baseBoardRevision: 0,
});
const batch = {
  identity: before.identity,
  actions: [
    {
      kind: "append",
      expression: { op: "number", value: 7 },
      sources: [
        { turnId: "turn_1_1_from_0", start: 0, end: 5, quote: "seven" },
        { turnId: "turn_2_2_from_0", start: 0, end: 5, quote: "times" },
      ],
    },
  ],
};
const event = (type: string, atMs: number, detail: unknown = null, childTurnId = 1): LessonDiagnostic => ({
  type,
  atMs,
  detail,
  childTurnId,
  visitId: 1,
  runtimeId: "runtime",
  nodeId: "cubic-minus-linear",
  transcriptRevision: 3,
  transcriptSpeaker: "child",
  timestamp: "synthetic",
});
const fixture = () => [
  event("math.transcript_available", 5),
  event("microphone.speech_stopped", 10),
  event("math.transcript_available", 15, null, 2),
  event("microphone.speech_stopped", 20, null, 2),
  event("math.interpretation_started", 30, {
    requestId: "r",
    before,
    turns: [
      { id: "turn_1_1_from_0", text: "seven", speaker: "learner", order: 1 },
      { id: "turn_2_2_from_0", text: "times", speaker: "learner", order: 2 },
    ],
  }),
  event("math.interpretation_ended", 50, { requestId: "r", disposition: "proposed", proposal: batch, id: "p" }),
  event("math.proposal_displayed", 60, { id: "p", token: "proposal-token" }),
  // Unrelated tutor/confirmation speech cannot move the original source anchor.
  event("microphone.speech_stopped", 90, null, 3),
  event("math.committed", 100, { id: "p", after: before }),
  event("math.confirmation", 100, { id: "p", method: "ui", accepted: true }),
  event("math.feedback_displayed", 110, { deliveryId: "p", target: "board", token: "board-token" }),
  event("gpt_live.math_feedback_append", 120, { deliveryId: "p", token: "board-token" }),
  event("output.activity", 130, { state: "quiet" }),
];
it("synthetic multi-turn timings separate pending display, confirmation delay and committed display", () => {
  const events = fixture();
  events.splice(4, 0, { ...event("math.transcript_available", 25, null, 2), transcriptSpeaker: "tutor" });
  const report = projectMathDiagnostics(events);
  expect(report.requests[0].actions[0].timing).toEqual({
    sourceSpeechEndMs: 20,
    transcriptAvailableMs: 15,
    interpretationStartMs: 30,
    interpretationEndMs: 50,
    proposalFirstDisplayedMs: 60,
    authoritativeCommitMs: 100,
    committedBoardFirstDisplayedMs: 110,
    tutorFeedbackAppendMs: 120,
    tutorConversationCompletedMs: null,
    tutorAudioCompletedMs: null,
    speechEndToProposalDisplayMs: 40,
    confirmationDelayMs: 40,
    commitToBoardDisplayMs: 10,
    speechEndToCommittedDisplayMs: 90,
  });
  expect(report.requests[0].confirmations[0].detail.token).toBe("proposal-token");
  expect(report.requests[0].confirmations[0].spokenEvidence).toBeNull();
  expect(report.evaluation.falseCommitRate).toBeNull();
  expect(report.displayMeasurement).toContain("not physical paint");
});
it("missing local measurements stay null, even when provider media timestamps exist", () => {
  const events = fixture().filter(e => e.type !== "microphone.speech_stopped" && e.type !== "math.feedback_displayed");
  events.push(event("transcript.snapshot", 200, { startMs: 999999, endMs: 1000000 }));
  const timing = projectMathDiagnostics(events).requests[0].actions[0].timing;
  expect(timing.sourceSpeechEndMs).toBeNull();
  expect(timing.speechEndToProposalDisplayMs).toBeNull();
  expect(timing.commitToBoardDisplayMs).toBeNull();
});
it.each(["malformed", "rejected", "unavailable", "stale"])(
  "exports %s without trusting invalid proposal structure",
  disposition => {
    const events = fixture().slice(0, 5);
    events.push(
      event("math.interpretation_ended", 50, { requestId: "r", disposition, proposal: { actions: "invalid" } }),
    );
    const request = projectMathDiagnostics(events).requests[0];
    expect(request.disposition).toBe(disposition);
    expect(request.actions).toEqual([]);
    expect(request.after).toBeNull();
  },
);
it("manual labelled review can disagree with parser acceptance and mathematical correctness", () => {
  expect(summarizeMathEvaluation([]).falseCommitCount).toBeNull();
  const annotation = {
    caseId: "synthetic-wrong-sign",
    groundTruth: "Learner said minus four; fixture rendered plus four",
    evidence: "synthetic-fixture" as const,
    interpretationFaithful: false,
    falseCommit: true,
    correctionCount: 1,
  };
  expect(summarizeMathEvaluation([annotation])).toMatchObject({
    faithfulCount: 0,
    falseCommitCount: 1,
    falseCommitRate: 1,
    correctionCount: 1,
  });
  expect(summarizeMathEvaluation([{ ...annotation, interpretationFaithful: null }]).falseCommitRate).toBeNull();
  expect(summarizeMathEvaluation([{ ...annotation, groundTruth: "" }]).falseCommitRate).toBeNull();
});

it("does not attribute later proposal feedback to an earlier board when its append was absent", () => {
  const events = fixture().filter(e => e.type !== "gpt_live.math_feedback_append");
  const board = events.find(e => e.type === "math.feedback_displayed")!;
  board.detail = { ...(board.detail as object), token: "board-token" };
  events.push(event("gpt_live.math_feedback_append", 200, { deliveryId: "p", token: "later-proposal-token" }));
  expect(projectMathDiagnostics(events).requests[0].actions[0].timing.tutorFeedbackAppendMs).toBeNull();
  events.push(event("gpt_live.math_feedback_append", 210, { deliveryId: "p", token: "board-token" }));
  expect(projectMathDiagnostics(events).requests[0].actions[0].timing.tutorFeedbackAppendMs).toBe(210);
});
