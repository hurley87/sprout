import type { AlgebraExpression } from "./expression";
import {
  add,
  constant,
  constantValue,
  isZero,
  multiply,
  negate,
  polynomialBudget,
  PolynomialLimitError,
  primitiveSignature,
  subtract,
  variable,
  type Polynomial,
} from "./polynomial";

/** Exact rational functions in x,y,h without cancellation, bounded by polynomial budgets.
 * Restrictions record divisor and negative-power numerators up to scalar and sign.
 */
export type RationalReduction =
  | { ok: true; numerator: Polynomial; denominator: Polynomial; restrictions: Polynomial[] }
  | { ok: false; reason: "undefined" | "unsupported" | "limit"; detail: string };

class ReductionFailure extends Error {
  constructor(
    readonly reason: "undefined" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}
type Rational = { numerator: Polynomial; denominator: Polynomial };
export function reduceRational(expression: AlgebraExpression): RationalReduction {
  const budget = polynomialBudget();
  const restrictions = new Map<string, Polynomial>();
  const product = (left: Polynomial, right: Polynomial) => multiply(left, right, budget);
  function requireNonzero(value: Polynomial) {
    if (isZero(value)) throw new ReductionFailure("undefined", "Divisor or negative-power base is identically zero");
    const key = primitiveSignature(value);
    if (!restrictions.has(key)) restrictions.set(key, value);
  }
  function reduce(node: AlgebraExpression): Rational {
    switch (node.op) {
      case "number":
        return { numerator: constant(BigInt(node.value)), denominator: constant(BigInt(1)) };
      case "variable":
        return { numerator: variable(node.name), denominator: constant(BigInt(1)) };
      case "negate": {
        const value = reduce(node.argument);
        return { numerator: negate(value.numerator), denominator: value.denominator };
      }
      case "add":
      case "subtract": {
        const parts = node.op === "add" ? node.args : [node.left, node.right];
        const values = parts.map(reduce);
        return values.slice(1).reduce(
          (left, right) => ({
            numerator: (node.op === "add" ? add : subtract)(
              product(left.numerator, right.denominator),
              product(right.numerator, left.denominator),
            ),
            denominator: product(left.denominator, right.denominator),
          }),
          values[0],
        );
      }
      case "multiply": {
        const values = node.args.map(reduce);
        return values.slice(1).reduce(
          (left, right) => ({
            numerator: product(left.numerator, right.numerator),
            denominator: product(left.denominator, right.denominator),
          }),
          values[0],
        );
      }
      case "divide": {
        const left = reduce(node.left),
          right = reduce(node.right);
        requireNonzero(right.numerator);
        if (node.right.op === "multiply") {
          for (const factor of node.right.args) {
            if (factor.op === "variable" && factor.name === "h") requireNonzero(variable(factor.name));
          }
        }
        return {
          numerator: product(left.numerator, right.denominator),
          denominator: product(left.denominator, right.numerator),
        };
      }
      case "power": {
        const base = reduce(node.base);
        if (node.exponent === 0) {
          const numerator = constantValue(base.numerator),
            denominator = constantValue(base.denominator);
          if (numerator === null || numerator === BigInt(0) || denominator === null || denominator === BigInt(0))
            throw new ReductionFailure("unsupported", "Zero power requires a nonzero constant base");
          return { numerator: constant(BigInt(1)), denominator: constant(BigInt(1)) };
        }
        if (node.exponent < 0) requireNonzero(base.numerator);
        let numerator = constant(BigInt(1)),
          denominator = constant(BigInt(1));
        for (let index = 0; index < Math.abs(node.exponent); index++) {
          numerator = product(numerator, node.exponent < 0 ? base.denominator : base.numerator);
          denominator = product(denominator, node.exponent < 0 ? base.numerator : base.denominator);
        }
        return { numerator, denominator };
      }
    }
  }
  try {
    let { numerator, denominator } = reduce(expression);
    const leading = [...denominator.entries()].sort(([left], [right]) => {
      const [lx, ly, lh] = left.split(",").map(Number),
        [rx, ry, rh] = right.split(",").map(Number);
      return rx - lx || ry - ly || rh - lh;
    })[0];
    if (leading && leading[1] < BigInt(0)) {
      numerator = negate(numerator);
      denominator = negate(denominator);
    }
    return { ok: true, numerator, denominator, restrictions: [...restrictions.values()] };
  } catch (error) {
    if (error instanceof ReductionFailure) return { ok: false, reason: error.reason, detail: error.message };
    if (error instanceof PolynomialLimitError) return { ok: false, reason: "limit", detail: error.message };
    throw error;
  }
}
