import { describe, expect, it } from "vitest";
import {
  validateMathExpression as validate,
  MATH_VALIDATION_LIMITS,
  type MathValidationContext,
} from "../lib/calculus/math-validator";
import {
  CALCULUS_PROBLEM_IDS,
  getCalculusPresentation,
  getCalculusReviewKey,
  type CalculusProblemId,
} from "../lib/calculus/problems";
import type { MathExpression as E } from "../lib/calculus/math-expression";

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const add = (...args: E[]): E => ({ op: "add", args });
const mul = (...args: E[]): E => ({ op: "multiply", args });
const sub = (left: E, right: E): E => ({ op: "subtract", left, right });
const div = (left: E, right: E): E => ({ op: "divide", left, right });
const d = (argument: E): E => ({ op: "derivative", argument });
const eq = (left: E, right: E): E => ({ op: "equal", left, right });
const sin: E = { op: "sin", argument: x },
  cos: E = { op: "cos", argument: x };
const final = (id: CalculusProblemId) => getCalculusReviewKey(id).finalForms[0];
const original = (id: CalculusProblemId) => getCalculusPresentation(id).functionExpression;
const context = (problemId: CalculusProblemId): MathValidationContext => ({ problemId, operation: "differentiate" });
function reorder(e: E): E {
  switch (e.op) {
    case "add":
    case "multiply":
      return { ...e, args: [...e.args].reverse().map(reorder) };
    case "subtract":
    case "divide":
    case "equal":
      return { ...e, left: reorder(e.left), right: reorder(e.right) };
    case "power":
      return { ...e, base: reorder(e.base) };
    case "sin":
    case "cos":
    case "negate":
    case "derivative":
      return { ...e, argument: reorder(e.argument) };
    default:
      return e;
  }
}

describe("bounded authored mathematics", () => {
  it.each(CALCULUS_PROBLEM_IDS)("verifies every final and reordered/factored/expanded alternate: %s", id => {
    for (const e of getCalculusReviewKey(id).finalForms)
      for (const candidate of [e, reorder(e)]) {
        const result = validate(candidate, context(id));
        expect(result.correctness).toBe("valid");
        expect(result.completeDerivative).toBe(true);
        expect(result.expression).toEqual(candidate);
        expect(result.expression).not.toBe(candidate);
      }
  });
  it.each(CALCULUS_PROBLEM_IDS)("checks each authored intermediate and all route transitions: %s", id => {
    for (const route of getCalculusReviewKey(id).routes) {
      let current: { expression: E; role: "function" | "derivative" } = { expression: original(id), role: "function" };
      for (const step of route.steps) {
        // The two expansion/rewrite routes initially retain the function's value.
        const rewritesOriginal =
          ((id === "cubic-minus-linear" && route === getCalculusReviewKey(id).routes[1]) ||
            (id === "composite-fifth" && route === getCalculusReviewKey(id).routes[1])) &&
          step === route.steps[0];
        const operation = current.role === "function" && !rewritesOriginal ? "differentiate" : "rewrite";
        const result = validate(step.expression, { problemId: id, current, operation });
        expect(result.correctness, `${id}: ${step.explanation}`).toBe("valid");
        expect(validate(reorder(step.expression), { problemId: id, current, operation }).correctness).toBe("valid");
        current = { expression: step.expression, role: rewritesOriginal ? "function" : "derivative" };
      }
      expect(validate(current.expression, { problemId: id, current, operation: "rewrite" }).completeDerivative).toBe(
        true,
      );
    }
  });
  it.each(CALCULUS_PROBLEM_IDS)("proves authored errors incorrect in the supported domain: %s", id => {
    for (const error of getCalculusReviewKey(id).commonErrors) {
      const result = validate(error.expression, context(id));
      expect(result.expressionCorrectness, error.description).toBe("incorrect");
      expect(result.transformationCorrectness).toBe("incorrect");
      expect(result.expression).toEqual(error.expression);
      expect(result.completeDerivative).toBe(false);
    }
  });
  it("handles signed arithmetic, grouping, exact scalar division and distribution", () => {
    const candidate = div(add(mul(n(6), pow(x, 2)), { op: "negate", argument: n(8) }), n(2));
    expect(validate(candidate, context("cubic-minus-linear")).correctness).toBe("valid");
    expect(validate(mul(x, add(mul(n(2), sin), mul(x, cos))), context("quadratic-sine")).correctness).toBe("valid");
    expect(validate(add(mul(x, x, n(3)), mul(n(-1), n(4))), context("cubic-minus-linear")).correctness).toBe("valid");
  });
});

describe("current work and assertions", () => {
  const id = "quadratic-sine";
  it("does not let a correct final excuse an invalid rewrite of the original", () => {
    const result = validate(final(id), { problemId: id, operation: "rewrite" });
    expect(result.expressionCorrectness).toBe("incorrect"); // As a function rewrite, its target is the function.
    expect(result.transformationCorrectness).toBe("incorrect");
    expect(result.completeDerivative).toBe(false);
  });
  it("separates a correct derivative expression from a false transition out of a wrong step", () => {
    const current = { role: "derivative", expression: getCalculusReviewKey(id).commonErrors[2].expression } as const;
    const result = validate(final(id), { problemId: id, operation: "rewrite", current });
    expect(result.expressionCorrectness).toBe("valid");
    expect(result.transformationCorrectness).toBe("incorrect");
    expect(result.correctness).toBe("incorrect");
    expect(result.completeDerivative).toBe(false);
    // Repeating an incorrect step can preserve its value, without fixing correctness.
    const repeat = validate(current.expression, { problemId: id, operation: "rewrite", current });
    expect(repeat.expressionCorrectness).toBe("incorrect");
    expect(repeat.transformationCorrectness).toBe("valid");
  });
  it("keeps derivative-bearing steps valid but unfinished and prevents double differentiation", () => {
    const intermediate = getCalculusReviewKey(id).routes[0].steps[0].expression;
    expect(validate(intermediate, context(id))).toMatchObject({ correctness: "valid", completeDerivative: false });
    expect(validate(d(original(id)), context(id))).toMatchObject({ correctness: "valid", completeDerivative: false });
    expect(
      validate(final(id), { ...context(id), current: { expression: intermediate, role: "derivative" } }),
    ).toMatchObject({
      expressionCorrectness: "valid",
      transformationCorrectness: "unsupported",
      completeDerivative: false,
    });
  });
  it("checks both equality sides and their relationship to the requested operation", () => {
    expect(validate(eq(d(original(id)), final(id)), context(id))).toMatchObject({
      correctness: "valid",
      completeDerivative: true,
    });
    expect(validate(eq(original(id), final(id)), context(id)).correctness).toBe("incorrect");
    expect(validate(eq(n(0), n(0)), context(id)).correctness).toBe("incorrect");
    expect(validate(eq(eq(n(1), n(1)), final(id)), context(id)).correctness).toBe("unsupported");
    expect(validate(eq(d(pow(x, 2)), final(id)), context(id)).correctness).toBe("incorrect");
    expect(validate(eq(div(x, x), n(1)), context(id))).toMatchObject({
      correctness: "unsupported",
      expressionCorrectness: "incorrect",
      transformationCorrectness: "unsupported",
    });
    expect(validate(eq(div(n(1), n(0)), final(id)), context(id))).toMatchObject({
      correctness: "unsupported",
      completeDerivative: false,
    });
  });
  it("abstains on non-authored derivative arguments and malformed/ambiguous current context", () => {
    expect(validate(d(d(original(id))), context(id)).correctness).toBe("unsupported");
    expect(validate(d(cos), context(id)).correctness).toBe("unsupported");
    expect(validate(final(id), { ...context(id), current: { expression: pow(x, 4), role: "function" } })).toMatchObject(
      { expressionCorrectness: "valid", transformationCorrectness: "unsupported" },
    );
    expect(
      validate(final(id), { ...context(id), current: { expression: eq(original(id), original(id)), role: "function" } })
        .correctness,
    ).toBe("unsupported");
  });
});

describe("conservative domain and resource boundaries", () => {
  const id = "cubic-minus-linear";
  const unresolved = (e: E) => {
    const result = validate(e, context(id));
    expect(result.correctness).toBe("unsupported");
    expect(result.completeDerivative).toBe(false);
    expect(result.expression).toEqual(e);
  };
  it("leaves a valid trigonometric identity form unresolved", () => {
    // (3x²-4)(sin²x+cos²x) is the correct derivative, but trig identities are outside support.
    unresolved(mul(final(id), add(pow(sin, 2), pow(cos, 2))));
    unresolved(add(final(id), sub({ op: "sin", argument: add(x, n(0)) }, sin)));
  });
  it("does not cancel domain holes or erase undefined/unsupported subexpressions", () => {
    for (const hidden of [div(x, x), div(n(0), n(0)), pow(x, -1), pow(n(0), 0), pow(x, 0), d(cos), pow(sin, 2)]) {
      unresolved(add(final(id), mul(n(0), hidden)));
      unresolved(add(final(id), sub(hidden, hidden)));
    }
    unresolved(div(mul(final(id), x), x));
    unresolved(mul(final(id), pow(x, 1), pow(x, -1)));
    unresolved(div(final(id), sub(x, x)));
  });
  it("allows verified constant zero powers while declining nonintegral scalar coefficients", () => {
    expect(validate(mul(final(id), pow(n(2), 0)), context(id)).correctness).toBe("valid");
    unresolved(add(final(id), sub(div(n(1), n(2)), div(n(1), n(2)))));
    // Integral quotient values remain exact, including negative divisors.
    expect(validate(div(mul(n(-2), final(id)), n(-2)), context(id)).correctness).toBe("valid");
  });
  it("bounds degree, coefficient growth, node counts, and expansion before cancellation", () => {
    expect(MATH_VALIDATION_LIMITS.products).toBe(4096);
    unresolved(add(final(id), mul(n(0), pow(pow(x, 12), 12))));
    unresolved(add(final(id), mul(n(0), pow(n(999999), 12))));
    unresolved(pow(add(n(1), x, pow(x, 2), pow(x, 3), pow(x, 4), pow(x, 5), pow(x, 6), pow(x, 7)), 12));
    let deep: E = x;
    for (let i = 0; i < 20; i++) deep = { op: "negate", argument: deep };
    expect(validate(deep, context(id)).correctness).toBe("unsupported");
  });
  it("cannot equate distinct supported linear trigonometric polynomials", () => {
    expect(validate(add(mul(n(2), x, cos), mul(pow(x, 2), sin)), context("quadratic-sine")).correctness).toBe(
      "incorrect",
    );
    expect(validate(add(final(id), mul(sub(pow(x, 2), x), sin)), context(id)).correctness).toBe("incorrect");
  });
  it("abstains on malformed syntax and distinguishes missing execution", () => {
    for (const e of [undefined, null])
      expect(validate(e, context(id))).toMatchObject({ correctness: "incomplete", completeDerivative: false });
    for (const e of [
      { op: "add", args: [x] },
      { op: "sqrt", argument: x },
      { op: "subtract", left: x },
    ])
      expect(validate(e, context(id))).toMatchObject({ correctness: "unsupported", completeDerivative: false });
  });
});

describe("mathematical validation preserves execution and syntax", () => {
  const id = "quadratic-sine";
  it("validates a product-rule alternative for the cubic", () => {
    const problemId = "cubic-minus-linear";
    // x^3 - 4x = x(x^2 - 4); product rule gives (x^2 - 4) + x(2x).
    const current = { expression: mul(x, sub(pow(x, 2), n(4))), role: "function" } as const;
    expect(validate(current.expression, { problemId, operation: "rewrite" }).correctness).toBe("valid");
    const result = validate(add(sub(pow(x, 2), n(4)), mul(x, n(2), x)), {
      problemId,
      operation: "differentiate",
      current,
    });
    expect(result).toMatchObject({
      correctness: "valid",
      expressionCorrectness: "valid",
      transformationCorrectness: "valid",
      completeDerivative: true,
    });
    expect(validate(undefined, { problemId, operation: "differentiate", current })).toMatchObject({
      correctness: "incomplete",
      completeDerivative: false,
    });
  });
  it("preserves exact proposed work and is deterministic without mutating any input", () => {
    const proposed = reorder(final(id));
    const before = JSON.stringify(proposed);
    const first = validate(proposed, context(id));
    expect(validate(proposed, context(id))).toEqual(first);
    expect(JSON.stringify(proposed)).toBe(before);
    expect(first.expression).toEqual(proposed);
    expect(first.expression).not.toBe(proposed);
  });
});
