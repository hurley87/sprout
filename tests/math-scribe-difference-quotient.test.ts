import { describe, expect, it } from "vitest";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { formatExpression } from "../lib/math-audit/format";
import { scribeInstruction } from "../lib/lesson-runtime/math-scribe-runtime";
import { listParts } from "../lib/math-scribe/parts";
import { createSession, reduceSession, type Interpretation, type SessionState } from "../lib/math-scribe/session";
import type { ScribeOperation } from "../lib/math-scribe/operations";

const original = String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`;
const answer = String.raw`-\frac{1}{(x+1)(x+h+1)}`;
function read(latex: string) {
  const parsed = readAlgebraLatex(latex);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.expression;
}
function start() {
  const result = createSession({ problemId: "difference-quotient", latex: original });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function part(state: SessionState, description: string) {
  const expression = state.pending?.versions[state.pending.current].expression ?? state.base;
  const found = listParts(expression).find(item => item.description === description);
  if (!found) throw new Error(description);
  return found.id;
}
function say(state: SessionState, interpretation: Interpretation) {
  return reduceSession(state, {
    type: "interpretation",
    requestId: `${state.revision}`,
    basedOnRevision: state.revision,
    interpretation,
    at: state.revision + 1,
  });
}
function check(state: SessionState) {
  return reduceSession(state, { type: "ui", action: "check", at: state.revision + 1 });
}
function proposal(state: SessionState, operation: ScribeOperation, quote: string) {
  return say(state, { intent: "propose", source: "instruction", operation, quote });
}
function verified(state: SessionState, operation: ScribeOperation, quote: string) {
  const proposed = proposal(state, operation, quote);
  expect(proposed.notice.kind).toBe("proposed");
  const result = check(proposed.state);
  expect(result.notice).toMatchObject({ verdict: "equivalent", domainStatus: "preserved" });
  expect(scribeInstruction(result.notice)).not.toContain(answer);
  return result.state;
}
function combined() {
  const state = start();
  return verified(
    state,
    { kind: "combine-fractions", partId: part(state, "numerator") },
    "combine the fractions on top",
  );
}
function flattened() {
  return verified(combined(), { kind: "flatten-nested-fraction", partId: "p0" }, "bring h down");
}

describe("difference quotient session", () => {
  it("applies a confirmed offered expansion to the pending first expansion and checks it", () => {
    const state = flattened();
    const first = proposal(
      state,
      { kind: "replace-part", partId: part(state, "term 1 of numerator"), expression: read("x^2+hx+x") },
      "expand the first product",
    ).state;
    const operation = {
      kind: "replace-part" as const,
      partId: part(first, "term 2 of numerator"),
      expression: read("x^2+hx+h+x"),
    };
    const offered = say(first, { intent: "clarify", question: "Should I expand the second product?", operation }).state;
    const accepted = say(offered, { intent: "confirm", quote: "Yes" });
    expect(accepted.notice.kind).toBe("proposed");
    expect(accepted.state.pending?.versions.at(-1)).toMatchObject({
      operation,
      quote: "Yes",
      origin: "spoken-expression",
    });
    expect(formatExpression(accepted.state.pending!.versions.at(-1)!.expression)).toContain("x^2+hx+h+x");
    expect(check(accepted.state).notice).toMatchObject({ verdict: "equivalent" });
    expect(accepted.state.log.at(-1)).toMatchObject({ intent: "propose", outcome: "proposed", quote: "Yes" });
  });

  it("does not apply stale offers, clears rejected offers, and preserves ordinary confirmation", () => {
    const state = proposal(
      flattened(),
      { kind: "replace-part", partId: "p0", expression: read(String.raw`\frac{x^2+hx+x-(x+h)(x+1)}{h(x+1)(x+h+1)}`) },
      "first",
    ).state;
    const operation = { kind: "replace-part" as const, partId: "p10", expression: read("x^2+hx+h+x") };
    const offered = say(state, { intent: "clarify", question: "Expand it?", operation }).state;
    const stale = { ...offered, revision: offered.revision + 1 };
    expect(say(stale, { intent: "confirm", quote: "yes" }).state.pending?.versions).toHaveLength(1);
    const rejected = say(offered, { intent: "describe-strategy", quote: "no" }).state;
    expect(rejected.clarification).toBeNull();
    expect(say(rejected, { intent: "confirm", quote: "yes" }).notice.kind).toBe("confirmed");
  });
  it("verifies contextual reference path and retains the given domain", () => {
    let state = flattened();
    state = verified(
      state,
      { kind: "replace-part", partId: part(state, "numerator"), expression: read("-h") },
      "that numerator should be negative h",
    );
    state = verified(state, { kind: "cancel-common-factor", factor: read("h") }, "cancel h");
    expect(formatExpression(state.base)).toBe(answer);
    expect(state.problemDomain.restrictions).toContain("h ≠ 0");
    expect(state.history.every(line => line.status === "verified")).toBe(true);
    expect(state.history.at(-1)?.domainChanges).toBeUndefined();
    expect(
      state.history
        .flatMap(line => line.pending?.versions ?? [])
        .every(version => version.operation.kind !== "replace-line"),
    ).toBe(true);
  });

  it("accepts expanded numerator and reordered factors without checkpoints", () => {
    let state = flattened();
    state = verified(
      state,
      { kind: "replace-part", partId: part(state, "numerator"), expression: read("x^2+xh+x-x^2-x-xh-h") },
      "the numerator is x squared plus x h plus x minus x squared minus x minus x h minus h",
    );
    state = verified(
      state,
      { kind: "replace-part", partId: part(state, "numerator"), expression: read("-h") },
      "negative h",
    );
    state = verified(state, { kind: "cancel-common-factor", factor: read("h") }, "cancel h");
    state = verified(
      state,
      { kind: "replace-line", expression: read(String.raw`-\frac{1}{(x+h+1)(x+1)}`) },
      "reorder the factors",
    );
    expect(state.history.at(-1)?.status).toBe("verified");
  });

  it("accepts a complete alternate route that scales each fraction first", () => {
    let state = start();
    state = verified(
      state,
      { kind: "scale-fraction", partId: part(state, "first fraction on top"), factor: read("x+h+1") },
      "multiply the first fraction top and bottom by x plus h plus one",
    );
    state = verified(
      state,
      { kind: "scale-fraction", partId: part(state, "second fraction on top"), factor: read("x+1") },
      "multiply the second fraction top and bottom by x plus one",
    );
    state = verified(state, { kind: "combine-fractions", partId: part(state, "numerator") }, "combine them");
    state = verified(state, { kind: "flatten-nested-fraction", partId: "p0" }, "bring the h down");
    state = verified(
      state,
      { kind: "replace-part", partId: part(state, "numerator"), expression: read("-h") },
      "the top is negative h",
    );
    state = verified(state, { kind: "cancel-common-factor", factor: read("h") }, "cancel the h");
    expect(state.history).toHaveLength(7);
    expect(formatExpression(state.base)).toBe(answer);
  });

  it("names the top fraction once the fractions on top are combined", () => {
    const parts = listParts(combined().base);
    expect(parts.find(item => item.path.length === 0)?.aliases).toEqual([]);
    expect(parts.find(item => item.description === "top fraction")?.aliases).toContain("the top fraction");
    expect(parts.find(item => item.description === "denominator")?.aliases).toContain("the outside denominator");
    expect(parts.some(item => item.description === "numerator of the top fraction")).toBe(true);
    expect(parts.flatMap(item => item.aliases)).not.toContain("the first fraction");
  });

  it("accepts flattening first by multiplying by the reciprocal", () => {
    const state = start();
    const next = verified(state, { kind: "division-to-reciprocal", partId: "p0" }, "multiply by one over h");
    expect(next.history).toHaveLength(2);
    expect(next.problemDomain.restrictions).toContain("h ≠ 0");
  });

  it("rejects a dictated derivative without replacing the verified line", () => {
    const state = start();
    const proposed = proposal(
      state,
      { kind: "replace-line", expression: read(String.raw`-\frac{1}{(x+1)^2}`) },
      "negative one over x plus one squared",
    );
    const result = check(proposed.state);
    expect(result.notice).toMatchObject({ verdict: "not-equivalent" });
    expect(result.state.pending?.status).toBe("invalid");
    expect(result.state.base).toEqual(state.base);
    expect(scribeInstruction(result.notice)).not.toContain(answer);
  });

  it("clarifies premature cancellation before and after combining", () => {
    for (const state of [start(), combined()]) {
      const result = proposal(state, { kind: "cancel-common-factor", factor: read("h") }, "cancel the h");
      expect(result.notice.kind).toBe("clarify");
      expect(result.state.pending).toBeNull();
      expect(result.state.base).toEqual(state.base);
    }
  });

  it("records recognition correction before verifying minus h", () => {
    const state = flattened();
    const id = part(state, "numerator");
    const mistaken = proposal(state, { kind: "replace-part", partId: id, expression: read("h") }, "minus h");
    const corrected = say(mistaken.state, {
      intent: "correct",
      operation: { kind: "replace-part", partId: id, expression: read("-h") },
      quote: "no, I meant minus h",
    });
    expect(corrected.state.pending?.versions.at(-1)?.cause).toBe("recognition-correction");
    expect(check(corrected.state).notice).toMatchObject({ verdict: "equivalent" });
  });

  it("recognizes calculus drift without proposing a step", () => {
    const state = start();
    const result = say(state, {
      intent: "propose",
      source: "instruction",
      operation: { kind: "non-unique", name: "calculus" },
      quote: "take the limit as h goes to zero",
    });
    expect(result.notice).toMatchObject({ kind: "logged", intent: "calculus" });
    expect(scribeInstruction(result.notice)).toContain("not take a limit or derivative");
    expect(result.state.pending).toBeNull();
    expect(result.state.history).toHaveLength(1);
  });

  it("rejects an inner sign error without leaking an expression", () => {
    const state = start();
    const result = check(
      proposal(
        state,
        { kind: "set-sign", partId: part(state, "second fraction on top"), sign: "plus" },
        "change minus to plus",
      ).state,
    );
    expect(result.notice).toMatchObject({ verdict: "not-equivalent" });
    expect(result.state.pending?.status).toBe("invalid");
    expect(result.state.base).toEqual(state.base);
    expect(scribeInstruction(result.notice)).toContain("doesn't follow");
    expect(scribeInstruction(result.notice)).not.toMatch(/\\frac|x\+h/);
  });

  it("preserves a dropped term in the invalid attempted numerator", () => {
    const state = flattened();
    const attempted = read("x^2+xh+x-x^2-x-h");
    const result = check(
      proposal(
        state,
        { kind: "replace-part", partId: part(state, "numerator"), expression: attempted },
        "x squared plus x h plus x minus x squared minus x minus h",
      ).state,
    );
    expect(result.notice).toMatchObject({ verdict: "not-equivalent" });
    expect(result.state.pending?.versions.at(-1)?.expression).toEqual(
      proposal(
        state,
        { kind: "replace-part", partId: part(state, "numerator"), expression: attempted },
        "attempt",
      ).state.pending?.versions.at(-1)?.expression,
    );
    expect(result.state.base).toEqual(state.base);
    expect(scribeInstruction(result.notice)).toContain("Please look at the numerator again.");
    expect(scribeInstruction(result.notice)).not.toMatch(/\\|\^|xh/);
  });

  it("rejects a dictated premature cancellation", () => {
    const state = start();
    const result = check(
      proposal(state, { kind: "replace-line", expression: read(String.raw`\frac{x}{x+1}-\frac{x}{x+1}`) }, "cancel h")
        .state,
    );
    expect(result.notice).toMatchObject({ verdict: "not-equivalent" });
    expect(result.state.pending?.status).toBe("invalid");
    expect(result.state.base).toEqual(state.base);
  });

  it.each(["cancel the denominator", "change the top", "one over"])("clarifies ambiguous speech: %s", quote => {
    const state = start();
    const result = say(state, { intent: "clarify", question: "Which part do you mean?", quote });
    expect(result.notice.kind).toBe("clarify");
    expect(result.state.pending).toBeNull();
    expect(result.state.base).toEqual(state.base);
  });

  it("keeps verified state through hint, check and undo", () => {
    const state = combined();
    const hint = say(state, { intent: "request-help", quote: "give me a hint" });
    expect(scribeInstruction(hint.notice)).not.toMatch(/\\|[=]/);
    expect(hint.state.base).toEqual(state.base);
    const checked = say(hint.state, { intent: "request-check", quote: "check that step" });
    expect(checked.state.base).toEqual(state.base);
    const pending = proposal(checked.state, { kind: "flatten-nested-fraction", partId: "p0" }, "bring h down");
    const undone = say(pending.state, { intent: "undo", quote: "undo" });
    expect(undone.state.base).toEqual(state.base);
    expect(undone.state.pending).toBeNull();
  });
});
