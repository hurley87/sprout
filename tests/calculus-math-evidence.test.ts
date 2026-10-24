import { describe, expect, it } from "vitest";
import { collectMathEvidence, type MathReview, type MathSourceEvent } from "../lib/calculus/math-evidence";
import {
  acceptMathBatch,
  applyMathBatch,
  createMathState,
  currentMathProgress,
  updateMathAuthority,
} from "../lib/calculus/math-state";
const identity = {
  runtimeId: "run",
  problemId: "quadratic-sine",
  visitId: "v1",
  transcriptRevision: 1,
  baseBoardRevision: 0,
} as const;
const turns = [
  { id: "u", speaker: "learner", text: "answer", order: 5 },
  { id: "t", speaker: "tutor", text: "answer", order: 2 },
] as const;
const sources = [{ turnId: "u", start: 0, end: 6, quote: "answer" }];
const review: MathReview = {
  faithful: true,
  assessment: { disposition: "accepted", correctness: "valid", reasoning: "supported", assistance: "independent" },
  independenceEstablished: true,
  mathematicallyComplete: true,
};
const event = (kind: MathSourceEvent["kind"], order = 1): MathSourceEvent => ({
  id: `e${order}`,
  kind,
  order,
  text: "context",
});
const evidence = (events: MathSourceEvent[] = [], r = review) =>
  collectMathEvidence(identity, sources, turns, events, r);

describe("explicit help and reasoning provenance", () => {
  it("does not infer independence from quote membership, praise or tutor echoes", () => {
    for (const events of [[], [event("tutor-context")]]) {
      const result = evidence(events, { ...review, independenceEstablished: false });
      expect(result.assessment.assistance).toBe("unknown");
      expect(result.demonstratedIndependent).toBe(false);
    }
    expect(() => collectMathEvidence(identity, [{ ...sources[0], turnId: "t" }], turns, [], review)).toThrow();
    expect(() => collectMathEvidence(identity, [{ ...sources[0], quote: "madeup" }], turns, [], review)).toThrow();
  });
  it("distinguishes neutral probes from hints and answer-giving", () => {
    expect(
      evidence([], { ...review, assessment: { ...review.assessment, assistance: "unknown" } }).demonstratedIndependent,
    ).toBe(false);
    expect(
      evidence([], { ...review, assessment: { ...review.assessment, assistance: "hinted" } }).assessment.assistance,
    ).toBe("unknown");
    expect(evidence([event("neutral-probe")]).assessment.assistance).toBe("neutral-probe");
    expect(evidence([event("neutral-probe")]).demonstratedIndependent).toBe(true);
    expect(evidence([event("hint")]).assessment.assistance).toBe("hinted");
    expect(evidence([event("supplied-answer")]).demonstratedIndependent).toBe(false);
    expect(evidence([event("unknown-help")]).assessment.assistance).toBe("unknown");
    expect(evidence([event("unknown-help")]).demonstratedIndependent).toBe(false);
  });
  it("links sources in timeline order and excludes future help", () => {
    const result = evidence([event("hint"), event("supplied-answer", 3), event("unknown-help", 8)]);
    expect(result.sourceEventIds).toEqual(["e1", "e3"]);
    expect(result.assessment.assistance).toBe("answer-supplied");
    expect(evidence([event("supplied-answer", 8)]).assessment.assistance).toBe("independent");
  });
  it("includes intervening help across ordered learner turns, without treating tutor context as learner work", () => {
    const multiTurns = [...turns, { id: "u2", speaker: "learner" as const, text: "because", order: 9 }];
    const multiSources = [...sources, { turnId: "u2", start: 0, end: 7, quote: "because" }];
    const result = collectMathEvidence(identity, multiSources, multiTurns, [event("supplied-answer", 7)], review);
    expect(result.assessment.assistance).toBe("answer-supplied");
    expect(result.sources).toEqual(multiSources);
    expect(() => collectMathEvidence(identity, [...multiSources].reverse(), multiTurns, [], review)).toThrow();
    expect(() => collectMathEvidence(identity, sources, [...turns, turns[0]], [], review)).toThrow();
    expect(
      evidence([event("neutral-probe")], { ...review, independenceEstablished: false }).demonstratedIndependent,
    ).toBe(false);
  });
  it("requires reasoning support separately from correct math and method names", () => {
    for (const reasoning of ["missing", "strategy-only", "misleading", "unassessed"] as const) {
      const result = evidence([], { ...review, assessment: { ...review.assessment, reasoning } });
      expect(result.mathematicallyComplete).toBe(true);
      expect(result.demonstratedIndependent).toBe(false);
    }
  });
  it("retains hint and answer attribution through corrections and undo", () => {
    let state = updateMathAuthority(createMathState(identity), { kind: "source-event", event: event("hint") });
    function commit(kind: "append" | "replace" | "undo") {
      const action = {
        kind,
        sources,
        ...(kind === "undo" ? {} : { expression: { op: "number", value: 2 } }),
        ...(kind === "append" ? {} : { targetStepId: "s1" }),
      };
      state = applyMathBatch(
        state,
        acceptMathBatch(
          state,
          `d${state.revision}`,
          { identity: state.identity, actions: [action] },
          { turns, reviews: [review] },
        ),
      );
    }
    commit("append");
    state = updateMathAuthority(state, { kind: "source-event", event: event("supplied-answer", 3) });
    commit("replace");
    commit("replace");
    expect(state.steps[0].versions.map(v => v.evidence.assessment.assistance)).toEqual([
      "hinted",
      "answer-supplied",
      "answer-supplied",
    ]);
    commit("undo");
    expect(currentMathProgress(state).demonstratedIndependent).toBe(false);
    expect(state.steps[0].versions[0].evidence.sourceEventIds).toEqual(["e1"]);
  });
});
