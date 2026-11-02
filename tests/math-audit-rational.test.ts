import { describe, expect, it } from "vitest";
import {
  ALGEBRA_EXPRESSION_LIMITS,
  parseAlgebraExpression,
  type AlgebraExpression as Expression,
} from "../lib/math-audit/expression";
import {
  add,
  constant,
  constantValue,
  divides,
  equals,
  evaluate,
  isZero,
  multiply,
  negate,
  polynomialBudget,
  PolynomialLimitError,
  primitiveSignature,
  subtract,
  variable,
} from "../lib/math-audit/polynomial";
import { reduceRational } from "../lib/math-audit/rational";

const number = (value: number): Expression => ({ op: "number", value });
const x: Expression = { op: "variable", name: "x" },
  y: Expression = { op: "variable", name: "y" };
const plus = (...args: Expression[]): Expression => ({ op: "add", args });
const times = (...args: Expression[]): Expression => ({ op: "multiply", args });
const minus = (left: Expression, right: Expression): Expression => ({ op: "subtract", left, right });
const over = (left: Expression, right: Expression): Expression => ({ op: "divide", left, right });
const power = (base: Expression, exponent: number): Expression => ({ op: "power", base, exponent });

describe("algebra expression parsing", () => {
  it("accepts the supported bounded tree", () => expect(parseAlgebraExpression(plus(x, power(y, -2))).ok).toBe(true));
  it("rejects malformed and unsupported syntax distinctly", () => {
    expect(parseAlgebraExpression({ ...x, extra: true })).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseAlgebraExpression({ op: "sin", argument: x })).toMatchObject({
      ok: false,
      reason: "unsupported-operator",
    });
    expect(parseAlgebraExpression({ op: "variable", name: "z" })).toMatchObject({
      ok: false,
      reason: "unsupported-variable",
    });
    expect(parseAlgebraExpression(number(1.5))).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseAlgebraExpression({ op: "add", args: [x, , y] })).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseAlgebraExpression(Object.assign(new Date(), { op: "variable", name: "x" }))).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(parseAlgebraExpression(plus(...Array(ALGEBRA_EXPRESSION_LIMITS.operands + 1).fill(x)))).toMatchObject({
      ok: false,
      reason: "limit",
    });
    let tree: Expression = x;
    for (let index = 0; index < ALGEBRA_EXPRESSION_LIMITS.depth; index++) tree = { op: "negate", argument: tree };
    expect(parseAlgebraExpression(tree)).toMatchObject({ ok: false, reason: "limit" });
  });
});

describe("exact polynomials", () => {
  const px = variable("x"),
    py = variable("y");
  it("adds, subtracts, multiplies, detects constants and evaluates exactly", () => {
    const sum = add(px, py);
    expect(
      equals(
        subtract(multiply(sum, sum), add(multiply(px, px), multiply(py, py))),
        multiply(constant(BigInt(2)), multiply(px, py)),
      ),
    ).toBe(true);
    expect(isZero(add(sum, negate(sum)))).toBe(true);
    expect(constantValue(constant(-BigInt(3)))).toBe(-BigInt(3));
    expect(constantValue(sum)).toBeNull();
    expect(
      evaluate(sum, {
        x: { numerator: BigInt(1), denominator: BigInt(2) },
        y: { numerator: BigInt(1), denominator: BigInt(3) },
      }),
    ).toEqual({
      numerator: BigInt(5),
      denominator: BigInt(6),
    });
  });
  it("decides rational divisibility with content and reports exhausted budgets", () => {
    const first = add(multiply(constant(BigInt(4)), px), multiply(constant(BigInt(10)), py));
    const second = add(multiply(constant(BigInt(12)), px), multiply(constant(BigInt(30)), py));
    expect(divides(first, second)).toBe(true);
    expect(divides(px, add(px, py))).toBe(false);
    expect(divides(px, multiply(px, py), { products: 4096 })).toBe("unknown");
    expect(() => multiply(px, py, { products: 4096 })).toThrow(PolynomialLimitError);
    expect(polynomialBudget().products).toBe(0);
  });
});

describe("rational reduction", () => {
  it("tracks fixture divisors, deduplicating proportional restrictions", () => {
    const first = plus(times(number(4), x), times(number(10), y));
    const second = plus(times(number(12), x), times(number(30), y));
    const third = minus(times(number(12), power(x, 2)), times(number(10), x, y));
    const expression = over(
      over(minus(times(number(6), x, y), times(number(5), power(y, 2))), first),
      over(third, second),
    );
    const result = reduceRational(expression);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const signatures = result.restrictions.map(primitiveSignature);
    for (const restriction of [first, second, third]) {
      const reduced = reduceRational(restriction);
      if (!reduced.ok) throw new Error("Fixture reduction failed");
      expect(signatures).toContain(primitiveSignature(reduced.numerator));
    }
    expect(signatures).toHaveLength(2);
  });
  it("handles negative powers and retains cancellation restrictions", () => {
    const base = plus(power(x, 2), times(number(2), x));
    const result = reduceRational(times(power(plus(number(2), times(number(3), power(x, 2))), 3), power(base, -2)));
    const reducedBase = reduceRational(base);
    expect(result.ok && reducedBase.ok && result.restrictions.map(primitiveSignature)).toContain(
      reducedBase.ok && primitiveSignature(reducedBase.numerator),
    );
    const cancelled = reduceRational(over(minus(power(x, 2), number(1)), minus(x, number(1))));
    expect(cancelled.ok && cancelled.restrictions).toHaveLength(1);
    expect(cancelled.ok && cancelled.denominator.size).toBe(2);
  });
  it("abstains on undefined, unsupported and oversized expressions", () => {
    for (const divisor of [number(0), minus(x, x)])
      expect(reduceRational(over(number(1), divisor))).toMatchObject({ ok: false, reason: "undefined" });
    expect(reduceRational(power(x, 0))).toMatchObject({ ok: false, reason: "unsupported" });
    expect(reduceRational(power(number(2), 0))).toMatchObject({ ok: true });
    expect(reduceRational(power(power(x, 12), 3))).toMatchObject({ ok: false, reason: "limit" });
    expect(reduceRational(times(number(0), over(number(1), number(0))))).toMatchObject({
      ok: false,
      reason: "undefined",
    });
  });
});
