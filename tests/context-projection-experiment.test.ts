import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import baselineReport from "../docs/issue-57-simplified-observer-comparison.json";
import report from "../docs/issue-57-context-projection-comparison.json";
import { JEV_MODEL } from "../lib/jev";
import {
  CONTEXT_PROJECTION_QUESTIONS,
  compareProjectionDecisions,
  contextProjectionRequest,
  fullTranscriptObserverState,
} from "../lib/experiments/issue-57/context-projection";
import {
  SIMPLIFIED_QUESTIONS,
  mapSimplifiedObservation,
  simplifiedObserverState,
  type SimplifiedOutputs,
} from "../lib/experiments/issue-57/simplified-observer";
import { isCountingNodeId } from "../lib/lesson-runtime/counting-lesson";
import { CONVERSATION_CLASSIFICATION_THRESHOLDS } from "../lib/lesson-runtime/classification-decision";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const input = {
  nodeId: "count-1-duck" as const,
  transcriptRevision: 2,
  transcript: "Child: One\nTutor: Yes, one duck.",
};
const states = (
  objective: SimplifiedOutputs["objectiveState"]["choice"],
  tutor: SimplifiedOutputs["tutorState"]["choice"],
): SimplifiedOutputs => ({
  objectiveState: {
    choice: objective,
    confidence: 1,
    probabilities: Object.fromEntries(
      Object.keys(SIMPLIFIED_QUESTIONS.objectiveState.criteria).map(option => [option, option === objective ? 1 : 0]),
    ) as SimplifiedOutputs["objectiveState"]["probabilities"],
  },
  tutorState: {
    choice: tutor,
    confidence: 1,
    probabilities: Object.fromEntries(
      Object.keys(SIMPLIFIED_QUESTIONS.tutorState.criteria).map(option => [option, option === tutor ? 1 : 0]),
    ) as SimplifiedOutputs["tutorState"]["probabilities"],
  },
});

it.each(baselineReport.cases)(
  "isolates only projection fields for $id without changing transcript/history",
  example => {
    if (!isCountingNodeId(example.input.nodeId)) throw new Error("Invalid review node");
    const snapshot = { ...example.input, nodeId: example.input.nodeId };
    const a = contextProjectionRequest(snapshot, "A")!;
    const b = contextProjectionRequest(snapshot, "B")!;
    expect(a.state).toEqual(simplifiedObserverState(snapshot));
    const { tutorObservation: _tutor, supportEvidence: _support, ...full } = simplifiedObserverState(snapshot)!;
    expect(_tutor).toBeDefined();
    expect(_support).toBeDefined();
    expect(b.state).toEqual(full);
    expect(b.state.transcript).toBe(a.state.transcript);
    expect(a.questions).toBe(b.questions);
    expect(a.model).toBe(JEV_MODEL);
    expect(b.model).toBe(a.model);
    expect(Object.keys(b.state)).toEqual(["nodeId", "scene", "learningObjective", "transcript", "transcriptRevision"]);
  },
);
it("retains baseline semantic questions and criteria with one shared locator adaptation", () => {
  expect(CONTEXT_PROJECTION_QUESTIONS.objectiveState).toBe(SIMPLIFIED_QUESTIONS.objectiveState);
  expect(CONTEXT_PROJECTION_QUESTIONS.tutorState.criteria).toBe(SIMPLIFIED_QUESTIONS.tutorState.criteria);
  expect(CONTEXT_PROJECTION_QUESTIONS.tutorState.type).toBe(SIMPLIFIED_QUESTIONS.tutorState.type);
  expect(CONTEXT_PROJECTION_QUESTIONS.tutorState.instructions).toBe(
    SIMPLIFIED_QUESTIONS.tutorState.instructions.replace(
      report.locatorAdaptation.baseline,
      report.locatorAdaptation.comparison,
    ),
  );
  expect(report.thresholds).toEqual(CONVERSATION_CLASSIFICATION_THRESHOLDS);
});
it("preserves the full follow-up history rather than treating its structural preceding block as the whole task", () => {
  const example = baselineReport.cases.find(c => c.id === "follow-up-after-tutor-response")!;
  const snapshot = { ...example.input, nodeId: "count-3-butterflies" as const };
  const a = simplifiedObserverState(snapshot)!;
  expect(a.tutorObservation.precedingChildAttempt).toBe("Is that all");
  expect(fullTranscriptObserverState(snapshot)!.transcript).toBe(example.input.transcript);
  // Structural preservation only: no transcript-to-success inference.
});
it("drops caller-supplied previous/future context and identity claims", () => {
  const request = contextProjectionRequest(
    {
      ...input,
      nextNode: "complete",
      graph: {},
      previousNodeTranscript: "Child: Two",
      runtimeId: "provider",
    } as typeof input,
    "B",
  )!;
  expect(Object.keys(request)).toEqual(["model", "state", "questions"]);
  expect(Object.keys(request.state)).toEqual([
    "nodeId",
    "scene",
    "learningObjective",
    "transcript",
    "transcriptRevision",
  ]);
});
it.each([-1, NaN, 1.5, Infinity])("rejects invalid revisions %s", transcriptRevision => {
  expect(contextProjectionRequest({ ...input, transcriptRevision }, "A")).toBeNull();
  expect(contextProjectionRequest({ ...input, transcriptRevision }, "B")).toBeNull();
});
it("rejects blank transcripts and unknown nodes", () => {
  expect(fullTranscriptObserverState({ ...input, transcript: " " })).toBeNull();
  expect(fullTranscriptObserverState({ ...input, nodeId: "future" } as unknown as typeof input)).toBeNull();
});
it("makes no semantic performance claim from missing model outputs", () => {
  expect(compareProjectionDecisions(null, null, null)).toMatchObject({
    classification: "still ambiguous",
    contamination: null,
  });
  expect(report.summary.performanceMeasured).toBe(false);
  for (const row of report.cases) {
    expect(row.A).toEqual([]);
    expect(row.B).toEqual([]);
    expect(row.comparison.classification).toBe("still ambiguous");
  }
});
it("requires reviewed expectations before interpreting differences (synthetic states)", () => {
  const success = mapSimplifiedObservation(input, states("completed", "confirmed_completion"));
  const hold = mapSimplifiedObservation(input, states("completed", "other"));
  const expected = { objectiveState: "completed" as const, tutorState: "confirmed_completion" as const };
  expect(compareProjectionDecisions(hold, success, null).classification).toBe("still ambiguous");
  expect(compareProjectionDecisions(hold, success, expected).classification).toBe("improved");
  expect(compareProjectionDecisions(success, hold, expected)).toMatchObject({
    classification: "regressed",
    contamination: null,
  });
  expect(compareProjectionDecisions(success, success, expected).classification).toBe("unchanged");
});
it.each(["incorrect", "unresolved_help", "unclear_or_incomplete", "no_attempt"] as const)(
  "shares negative completion mapping: %s",
  objective => {
    const decision = mapSimplifiedObservation(input, states(objective, "confirmed_completion"));
    expect(decision.proposal).toBeNull();
    expect(decision.outcome).toBe("unresolved");
  },
);
it("freezes the same cases, identical questions and exact bounded request manifest", () => {
  expect(report.cases.map(c => ({ id: c.id, input: c.input }))).toEqual(
    baselineReport.cases.map(c => ({ id: c.id, input: c.input })),
  );
  expect(report.source.caseSetHash).toBe(hash(baselineReport.cases.map(c => ({ id: c.id, input: c.input }))));
  expect(report.contractHash).toBe(hash({ model: JEV_MODEL, questions: CONTEXT_PROJECTION_QUESTIONS }));
  expect(report.evaluationPlan.calls).toBe(168);
  expect(new Set(report.evaluationPlan.requests.map(r => r.id)).size).toBe(168);
  for (const row of report.cases)
    for (const arm of ["A", "B"] as const) {
      expect(row.projections[arm].inputHash).toBe(hash(row.projections[arm].state));
      expect(
        Buffer.byteLength(JSON.stringify({ ...report.contract, state: row.projections[arm].state }), "utf8"),
      ).toBeLessThanOrEqual(report.evaluationPlan.maximumSerializedRequestBytes);
      expect(
        report.evaluationPlan.requests.filter(r => r.caseId === row.id && r.arm === arm).map(r => r.repeat),
      ).toEqual([1, 2]);
    }
});

// Synthetic normalized results verify offline ingestion, never measured Jev performance.
function importResults(observations: unknown[], expectations: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "sprout-projection-test-"));
  try {
    const results = join(dir, "results.json"),
      labels = join(dir, "expectations.json");
    writeFileSync(results, JSON.stringify(observations));
    writeFileSync(labels, JSON.stringify(expectations));
    return spawnSync(
      process.execPath,
      ["scripts/issue-57-context-projection-comparison.mjs", "--results", results, "--expectations", labels],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it("imports bounded results and reviewed labels without calling a provider (synthetic)", () => {
  const row = report.cases[0];
  const observations = report.evaluationPlan.requests
    .filter(r => r.caseId === row.id)
    .map(request => ({
      id: request.id,
      model: JEV_MODEL,
      inputHash: request.inputHash,
      contractHash: request.contractHash,
      latencyMs: 250,
      normalizedOutput: states("completed", request.arm === "A" ? "other" : "confirmed_completion"),
    }));
  const result = importResults(observations, [
    { caseId: row.id, humanReviewed: true, objectiveState: "completed", tutorState: "confirmed_completion" },
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    importedObservations: 4,
    improvements: 1,
    performanceMeasured: false,
  });
});
it("rejects duplicate or wrong-input results rather than comparing mismatched snapshots", () => {
  const request = report.evaluationPlan.requests[0];
  const observation = {
    ...request,
    model: JEV_MODEL,
    latencyMs: 250,
    normalizedOutput: states("completed", "confirmed_completion"),
  };
  expect(importResults([observation, observation]).status).not.toBe(0);
  expect(importResults([{ ...observation, inputHash: "different-snapshot" }]).status).not.toBe(0);
});
it("keeps provider failures unresolved with no retry or inferred semantic regression", () => {
  const row = report.cases[0];
  const observations = report.evaluationPlan.requests
    .filter(r => r.caseId === row.id)
    .map(request => ({
      id: request.id,
      model: JEV_MODEL,
      inputHash: request.inputHash,
      contractHash: request.contractHash,
      latencyMs: 10000,
      normalizedOutput: null,
      failureReason: "timeout",
    }));
  const result = importResults(observations);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    importedObservations: 4,
    improvements: 0,
    regressions: 0,
    stillAmbiguous: 42,
  });
});
