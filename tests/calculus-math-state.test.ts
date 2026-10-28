import { describe, expect, it } from "vitest";
import {
  acceptMathBatch,
  applyMathBatch,
  createMathState,
  currentMathProgress,
  updateMathAuthority,
  type MathState,
  type MathAcceptance,
} from "../lib/calculus/math-state";
import type { MathProposal } from "../lib/calculus/math-action";
import type { MathReview } from "../lib/calculus/math-evidence";

const identity = {
  runtimeId: "run",
  problemId: "cubic-minus-linear",
  visitId: "v1",
  transcriptRevision: 1,
  baseBoardRevision: 0,
} as const;
const sources = [{ turnId: "u1", start: 0, end: 4, quote: "work" }];
const turns = [{ id: "u1", speaker: "learner", text: "work", order: 10 }] as const;
const expression = { op: "number", value: 2 } as const;
const review: MathReview = {
  faithful: true,
  assessment: { disposition: "accepted", correctness: "valid", reasoning: "supported", assistance: "independent" },
  mathematicallyComplete: true,
  independenceEstablished: true,
};
const append = (): MathProposal => ({ kind: "append", sources, expression });
const replace = (targetStepId = "s1"): MathProposal => ({ kind: "replace", sources, expression, targetStepId });
const undo = (targetStepId = "s1"): MathProposal => ({ kind: "undo", sources, targetStepId });
function accept(
  state: MathState,
  actions: readonly MathProposal[],
  reviews = actions.map(() => review),
  id = `d${state.revision}`,
) {
  return acceptMathBatch(state, id, { identity: state.identity, actions }, { turns, reviews });
}
function apply(state: MathState, actions: readonly MathProposal[], reviews?: MathReview[]) {
  return applyMathBatch(state, accept(state, actions, reviews));
}

describe("mathematical attempt history", () => {
  it("reviews each action against the real staged board and app-generated version ID", () => {
    const state = apply(createMathState(identity), [append()]);
    const seen: { versionId: string | null; current: (string | null)[]; history: string[] }[] = [];
    const actions = [replace(), undo(), undo(), append(), append()];
    const token = acceptMathBatch(
      state,
      "reviewed",
      { identity: state.identity, actions },
      {
        turns,
        reviews: (_action, _index, board, versionId) => {
          seen.push({
            versionId,
            current: board.steps.map(step => step.currentVersionId),
            history: board.history.map(entry => entry.id),
          });
          return review;
        },
      },
    );
    expect(seen).toEqual([]);
    const next = applyMathBatch(state, token);
    expect(seen.map(entry => [entry.versionId, entry.current])).toEqual([
      ["s1v2", ["s1v1"]],
      [null, ["s1v2"]],
      [null, ["s1v1"]],
      ["s2v1", [null, null]],
      ["s3v1", [null, "s2v1", null]],
    ]);
    expect(seen.map(entry => entry.history.at(-1))).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(next).toEqual(
      applyMathBatch(
        state,
        accept(
          state,
          actions,
          actions.map(() => review),
          "reviewed",
        ),
      ),
    );
    const frozen = updateMathAuthority(next, { kind: "lifecycle", status: "stopped" });
    expect(applyMathBatch(frozen, token)).toBe(frozen);
    expect(seen).toHaveLength(5);
  });
  it("preserves reviewed delivery fingerprints and rejects reviewed tails atomically", () => {
    const state = createMathState(identity);
    const actions = [append(), append()];
    const reviewed = (reviews: MathReview[]) =>
      acceptMathBatch(
        state,
        "reviewed",
        { identity, actions },
        {
          turns,
          reviews: (_action, index) => reviews[index],
        },
      );
    const next = applyMathBatch(state, reviewed([review, review]));
    expect(applyMathBatch(next, reviewed([review, review]))).toBe(next);
    expect(() => applyMathBatch(next, reviewed([review, { ...review, mathematicallyComplete: false }]))).toThrow(
      "Conflicting delivery",
    );
    expect(() =>
      applyMathBatch(
        state,
        reviewed([review, { ...review, assessment: { ...review.assessment, disposition: "clarification-required" } }]),
      ),
    ).toThrow("Board action not accepted");
    expect(state.steps).toEqual([]);
    expect(state.history).toEqual([]);
  });
  it("retains attribution through incorrect replacement, correction and undo", () => {
    const initial = createMathState(identity);
    const first = apply(initial, [append()]);
    const incorrect = { ...review, assessment: { ...review.assessment, correctness: "incorrect" as const } };
    const wrong = apply(first, [replace()], [incorrect]);
    const corrected = apply(wrong, [replace()], [{ ...review, independenceEstablished: false }]);
    expect(currentMathProgress(first).demonstratedIndependent).toBe(true);
    expect(currentMathProgress(wrong).mathematicallyComplete).toBe(false);
    expect(currentMathProgress(corrected)).toEqual({ mathematicallyComplete: true, demonstratedIndependent: false });
    const undone = apply(corrected, [undo()]);
    expect(undone.steps[0].currentVersionId).toBe("s1v2");
    expect(undone.steps[0].versions).toHaveLength(3);
    expect(undone.history.at(-1)?.withdrawsActionId).toBe("a3");
    expect(currentMathProgress(undone).mathematicallyComplete).toBe(false);
    const original = apply(undone, [undo()]);
    expect(original.steps[0].currentVersionId).toBe("s1v1");
    const withdrawn = apply(original, [undo()]);
    expect(withdrawn.steps[0].currentVersionId).toBeNull();
    expect(withdrawn.history).toHaveLength(6);
    expect(currentMathProgress(withdrawn).demonstratedIndependent).toBe(false);
    expect(() => apply(withdrawn, [replace()])).toThrow();
    expect(first.steps[0].versions).toHaveLength(1);
    expect(initial.history).toHaveLength(0);
  });
  it("keeps logical order and app-generated IDs after withdrawal", () => {
    let state = apply(createMathState(identity), [append(), append()]);
    expect(state.steps.map(s => s.id)).toEqual(["s1", "s2"]);
    expect(state.identity.baseBoardRevision).toBe(1);
    expect(() => apply(state, [undo("s1")])).toThrow();
    state = apply(state, [undo("s2")]);
    state = apply(state, [append()]);
    expect(state.steps.map(s => s.currentVersionId)).toEqual(["s1v1", null, "s3v1"]);
  });
  it("rejects ordered tails atomically when an earlier edit invalidates latest undo", () => {
    const state = apply(createMathState(identity), [append()]);
    const snapshot = structuredClone(state);
    for (const actions of [
      [append(), undo()],
      [replace(), undo(), undo()],
    ]) {
      // The repeated undo in the latter batch legitimately reverses replacement
      // and then append; it must succeed, unlike append -> old-target undo.
      if (actions.length === 3) {
        expect(apply(state, actions).steps[0].currentVersionId).toBeNull();
      } else expect(() => apply(state, actions)).toThrow();
    }
    expect(state).toEqual(snapshot);
    expect(() =>
      acceptMathBatch(
        state,
        "bad",
        { identity: state.identity, actions: [append(), { kind: "append", sources }] },
        { turns, reviews: [review, review] },
      ),
    ).toThrow();
    expect(() => apply(state, [append(), replace("missing")])).toThrow();
    expect(state).toEqual(snapshot);
  });
  it("permits provisional/incorrect math but never invents a clarification equation", () => {
    const state = apply(
      createMathState(identity),
      [append(), { kind: "clarify", reason: "ambiguous", sources }],
      [
        { ...review, assessment: { ...review.assessment, disposition: "unresolved", correctness: "unsupported" } },
        review,
      ],
    );
    expect(state.steps).toHaveLength(1);
    expect(state.clarification?.reason).toBe("ambiguous");
    expect(currentMathProgress(state).mathematicallyComplete).toBe(false);
    expect(apply(state, [replace()]).clarification).toBeNull();
  });
});

describe("application authority and delivery", () => {
  it("requires a genuine capability and separate app-owned review", () => {
    const state = createMathState(identity);
    expect(() => applyMathBatch(state, {} as MathAcceptance)).toThrow();
    expect(() =>
      acceptMathBatch(
        state,
        "x",
        { identity, actions: [{ ...append(), assessment: review }] },
        { turns, reviews: [review] },
      ),
    ).toThrow();
    expect(() => accept(state, [append()], [{ ...review, faithful: false } as unknown as MathReview])).toThrow();
    expect(() => accept(state, [append()], [])).toThrow();
  });
  it("handles exact delivery twice without adding revisions; conflicts reject", () => {
    const state = createMathState(identity);
    const token = accept(state, [append()], [review], "delivery");
    const changed = applyMathBatch(state, token);
    expect(applyMathBatch(changed, token)).toBe(changed);
    const conflict = accept(state, [{ kind: "help", sources }], [review], "delivery");
    expect(() => applyMathBatch(changed, conflict)).toThrow();
    const stopped = updateMathAuthority(changed, { kind: "lifecycle", status: "stopped" });
    expect(applyMathBatch(stopped, token)).toBe(stopped);
  });
  it.each(["runtimeId", "problemId", "visitId", "transcriptRevision", "baseBoardRevision"])(
    "rejects stale/wrong %s",
    field => {
      const state = createMathState(identity);
      expect(() =>
        acceptMathBatch(
          state,
          "bad",
          { identity: { ...identity, [field]: field.includes("Revision") ? 99 : "other" }, actions: [append()] },
          { turns, reviews: [review] },
        ),
      ).toThrow();
    },
  );
  it("revokes acceptance on learner revision, board edit and source change", () => {
    const state = createMathState(identity),
      token = accept(state, [append()], [review], "pending");
    const revised = updateMathAuthority(state, { kind: "learner-revision", transcriptRevision: 2 });
    const sourced = updateMathAuthority(state, {
      kind: "source-event",
      event: { id: "h1", order: 1, kind: "hint", text: "try the rule" },
    });
    for (const newer of [revised, sourced, apply(state, [append()])])
      expect(() => applyMathBatch(newer, token)).toThrow();
    expect(revised.identity.baseBoardRevision).toBe(0);
    expect(() => updateMathAuthority(revised, { kind: "learner-revision", transcriptRevision: 1 })).toThrow();
  });
  it.each(["stopped", "completed", "skipped", "ended"] as const)(
    "freezes %s without demonstrating mathematics",
    status => {
      const state = createMathState(identity),
        token = accept(state, [append()]);
      const frozen = updateMathAuthority(state, { kind: "lifecycle", status });
      expect(currentMathProgress(frozen)).toEqual({ mathematicallyComplete: false, demonstratedIndependent: false });
      expect(() => applyMathBatch(frozen, token)).toThrow();
      expect(() => updateMathAuthority(frozen, { kind: "learner-revision", transcriptRevision: 2 })).toThrow();
    },
  );
  it("records non-board intent with explicit revision and no mastery", () => {
    const state = createMathState(identity),
      pending = accept(state, [append()]);
    const next = apply(state, [
      { kind: "strategy", method: "other", sources },
      { kind: "help", sources },
      { kind: "next", sources },
    ]);
    expect(next.revision).toBe(1);
    expect(next.identity.baseBoardRevision).toBe(0);
    expect(next.nextRequested).toBe(true);
    expect(next.status).toBe("active");
    expect(currentMathProgress(next).demonstratedIndependent).toBe(false);
    expect(() => applyMathBatch(next, pending)).toThrow();
  });
  it("does not let an earlier completed line mask later unresolved work", () => {
    const state = apply(
      createMathState(identity),
      [append(), append()],
      [review, { ...review, assessment: { ...review.assessment, correctness: "incorrect" } }],
    );
    expect(currentMathProgress(state).mathematicallyComplete).toBe(false);
    expect(currentMathProgress(apply(state, [undo("s2")])).mathematicallyComplete).toBe(true);
  });
  it("rejects an assessed tail without exposing any staged append", () => {
    const state = createMathState(identity);
    const token = accept(
      state,
      [append(), append()],
      [review, { ...review, assessment: { ...review.assessment, disposition: "clarification-required" } }],
    );
    expect(() => applyMathBatch(state, token)).toThrow();
    expect(state.steps).toEqual([]);
    expect(state.revision).toBe(0);
  });
  it("freezes detached snapshots and prevents source mutation from changing accepted help", () => {
    const initialIdentity = { ...identity, runtimeId: String(identity.runtimeId) };
    const state = createMathState(initialIdentity);
    initialIdentity.runtimeId = "changed";
    expect(state.identity.runtimeId).toBe("run");
    expect(() => Object.assign(state.identity, { runtimeId: "forged" })).toThrow();
    const event = { id: "h1", order: 1, kind: "hint" as const, text: "hint" };
    const sourced = updateMathAuthority(state, { kind: "source-event", event });
    event.text = "changed";
    expect(sourced.sourceEvents[0].text).toBe("hint");
    expect(() => updateMathAuthority(sourced, { kind: "source-event", event })).toThrow();
    const committed = apply(sourced, [append()]);
    expect(() =>
      Object.assign(committed.steps[0].versions[0].evidence.assessment, { assistance: "independent" }),
    ).toThrow();
    expect(state.sourceEvents).toEqual([]);
  });
  it("detaches caller expression, reviews, events and earlier snapshots", () => {
    const state = createMathState(identity);
    const action = { ...append(), expression: { op: "number", value: 2 } };
    const token = acceptMathBatch(
      state,
      "detached",
      { identity, actions: [action] },
      { turns, reviews: [structuredClone(review)] },
    );
    action.expression.value = 99;
    const next = applyMathBatch(state, token);
    expect(next.steps[0].versions[0].expression).toEqual(expression);
    expect(state.history).toEqual([]);
  });
});
