import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { aggregateResults } from "../lib/experiments/issue-42/provider-comparison";
import type { FactoredObservation } from "../lib/experiments/issue-42/factored-decisions";
import type { ChoiceOutput, ConversationStateOutputs } from "../lib/lesson-runtime/conversation-observer-contract";

// Synthetic normalized observations only: no transport, run authorization or measured evidence.
const answer = <T extends string>(choice: T, ...alternatives: T[]) => ({
  choice,
  confidence: 0.87,
  probabilities: Object.fromEntries([
    [choice, 0.96],
    ...alternatives.map(a => [a, 0.04 / alternatives.length]),
  ]) as Record<T, number>,
});
const factored = (): FactoredObservation => ({
  objectiveState: answer("completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"),
  tutorState: answer("confirmed_completion", "asking", "helping", "clarifying", "other"),
  demonstration: { "demonstration_engram-biological": answer("demonstrated", "incorrect") },
  prompting: { "prompting_engram-biological": answer("independent", "prompted") },
  sources: { "source_engram-biological": answer("message_1", "none") },
});
const direct = (): ConversationStateOutputs => ({
  objectiveState: answer("completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"),
  tutorState: answer("confirmed_completion", "asking", "helping", "clarifying", "other"),
  concepts: {
    "concept_engram-biological": answer("demonstrated_independent", "partial", "not_yet", "demonstrated_prompted"),
  },
  sources: { "source_engram-biological": answer("message_1", "none") },
});
type Row = Parameters<typeof aggregateResults>[0][number];
function row(raw: FactoredObservation | ConversationStateOutputs): Row {
  return {
    arm: "decisions",
    caseId: "synthetic-case",
    kind: "fresh_provider_measurement",
    category: "raw_observation_unmapped",
    normalized: "demonstration" in raw ? null : raw,
    factored: "demonstration" in raw ? raw : null,
    measurement: { requestCount: 1, latencyMs: 1, usage: null, costUsd: null, failure: null },
  };
}
function stability(rows: Row[]) {
  return aggregateResults(rows).decisions.stability;
}
function varyScores(raw: FactoredObservation | ConversationStateOutputs, dimension: "confidence" | "probability") {
  const answers: ChoiceOutput<string>[] = [
    raw.objectiveState,
    raw.tutorState,
    ...Object.values(raw.sources ?? {}),
    ...("demonstration" in raw
      ? [...Object.values(raw.demonstration), ...Object.values(raw.prompting)]
      : Object.values(raw.concepts ?? {})),
  ];
  for (const a of answers) {
    if (dimension === "confidence") a.confidence = 0.86;
    else
      for (const key of Object.keys(a.probabilities))
        a.probabilities[key] = key === a.choice ? 0.95 : 0.05 / (Object.keys(a.probabilities).length - 1);
  }
}

it.each([factored, direct])(
  "ignores confidence-only and distribution-only variation for selected-label stability (%#)",
  make => {
    for (const dimension of ["confidence", "probability"] as const) {
      const first = make();
      const second = structuredClone(first);
      varyScores(second, dimension);
      expect(stability([row(first), row(second)])).toEqual([
        { caseId: "synthetic-case", validObservations: 2, stable: true },
      ]);
    }
  },
);
it.each([
  [
    "objective",
    (r: FactoredObservation) => {
      r.objectiveState.choice = "incorrect";
    },
  ],
  [
    "tutor",
    (r: FactoredObservation) => {
      r.tutorState.choice = "asking";
    },
  ],
  [
    "demonstration",
    (r: FactoredObservation) => {
      r.demonstration["demonstration_engram-biological"].choice = "incorrect";
    },
  ],
  [
    "prompting",
    (r: FactoredObservation) => {
      r.prompting["prompting_engram-biological"].choice = "prompted";
    },
  ],
  [
    "source",
    (r: FactoredObservation) => {
      r.sources["source_engram-biological"].choice = "none";
    },
  ],
  [
    "missing conditional stage",
    (r: FactoredObservation) => {
      r.prompting = {};
    },
  ],
] as const)("detects changed factored %s selections", (_name, change) => {
  const first = factored();
  const second = structuredClone(first);
  change(second);
  expect(stability([row(first), row(second)])[0].stable).toBe(false);
});
it("retains distinct incorrect and not-attempted labels despite their shared proposal mapping", () => {
  const first = factored();
  first.demonstration["demonstration_engram-biological"].choice = "incorrect";
  first.prompting = {};
  const second = structuredClone(first);
  second.demonstration["demonstration_engram-biological"].choice = "not_attempted";
  expect(stability([row(first), row(second)])[0].stable).toBe(false);
  expect(stability([row(first), row(structuredClone(first))])[0].stable).toBe(true);
});
it.each(["objectiveState", "tutorState", "concepts", "sources"] as const)(
  "preserves direct %s label sensitivity for both arms",
  field => {
    const first = direct();
    const second = structuredClone(first);
    if (field === "objectiveState") second.objectiveState.choice = "incorrect";
    else if (field === "tutorState") second.tutorState.choice = "asking";
    else if (field === "concepts")
      second.concepts = {
        "concept_engram-biological": answer("partial", "demonstrated_independent", "not_yet", "demonstrated_prompted"),
      };
    else second.sources = { "source_engram-biological": answer("none", "message_1") };
    for (const arm of ["jev", "decisions"] as const) {
      const rows = [row(first), row(second)].map(r => ({ ...r, arm }));
      expect(aggregateResults(rows)[arm].stability[0].stable).toBe(false);
    }
  },
);
it.each([factored, direct])("requires two fresh valid observations and isolates cases (%#)", make => {
  const valid = row(make());
  const invalid = { ...valid, normalized: null, factored: null, category: "timeout" };
  const mock = { ...valid, kind: "synthetic_mock" };
  expect(stability([])).toEqual([]);
  expect(stability([invalid, mock])).toEqual([{ caseId: "synthetic-case", validObservations: 0, stable: null }]);
  expect(stability([valid, invalid, mock])).toEqual([{ caseId: "synthetic-case", validObservations: 1, stable: null }]);
  expect(stability([valid, { ...valid, caseId: "other-case" }]).map(s => s.stable)).toEqual([null, null]);
});
