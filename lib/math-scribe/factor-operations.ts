import type { AlgebraExpression } from "../math-audit/expression";
import {
  constant,
  constantValue,
  isZero,
  multiply,
  polynomialBudget,
  subtract,
  type Polynomial,
} from "../math-audit/polynomial";
import { reduceRational } from "../math-audit/rational";

const number = (value: number): AlgebraExpression => ({ op: "number", value });
const product = (args: AlgebraExpression[]): AlgebraExpression =>
  args.length === 0 ? number(1) : args.length === 1 ? args[0] : { op: "multiply", args };

function polynomial(expression: AlgebraExpression): Polynomial | null {
  const reduced = reduceRational(expression);
  return reduced.ok && reduced.restrictions.length === 0 && constantValue(reduced.denominator) === BigInt(1)
    ? reduced.numerator
    : null;
}

export function factorOut(value: AlgebraExpression, factor: AlgebraExpression): AlgebraExpression | null {
  try {
    const dividend = polynomial(value),
      divisor = polynomial(factor);
    if (!dividend || !divisor || isZero(divisor) || constantValue(divisor) === BigInt(1)) return null;
    const order = (left: string, right: string) => {
      const [lx, ly, lh] = left.split(",").map(Number),
        [rx, ry, rh] = right.split(",").map(Number);
      return rx - lx || ry - ly || rh - lh;
    };
    const leading = [...divisor.keys()].sort(order)[0];
    const [dx, dy, dh] = leading.split(",").map(Number);
    const coefficient = divisor.get(leading)!;
    let remainder = dividend;
    let remainderDenominator = BigInt(1);
    const quotient = new Map<string, { numerator: bigint; denominator: bigint }>();
    const budget = polynomialBudget();
    const gcd = (left: bigint, right: bigint): bigint =>
      right === BigInt(0) ? (left < BigInt(0) ? -left : left) : gcd(right, left % right);
    while (!isZero(remainder)) {
      const key = [...remainder.keys()].sort(order)[0];
      const [rx, ry, rh] = key.split(",").map(Number);
      const value = remainder.get(key)!;
      if (rx < dx || ry < dy || rh < dh) return null;
      let numerator = value,
        denominator = remainderDenominator * coefficient;
      if (denominator < BigInt(0)) {
        numerator = -numerator;
        denominator = -denominator;
      }
      const common = gcd(numerator, denominator);
      numerator /= common;
      denominator /= common;
      quotient.set(`${rx - dx},${ry - dy},${rh - dh}`, { numerator, denominator });
      const term = new Map([[`${rx - dx},${ry - dy},${rh - dh}`, value]]);
      remainder = subtract(multiply(remainder, constant(coefficient), budget), multiply(divisor, term, budget));
      remainderDenominator *= coefficient;
      const divisorGcd = [...remainder.values()].reduce(
        (accumulator, item) => gcd(accumulator, item),
        remainderDenominator,
      );
      if (divisorGcd !== BigInt(0)) {
        remainder = new Map([...remainder].map(([key, item]) => [key, item / divisorGcd]));
        remainderDenominator /= divisorGcd;
      }
    }
    const terms = [...quotient]
      .filter(([, value]) => value.numerator !== BigInt(0))
      .sort(([left], [right]) => order(left, right));
    // A learner taking out 4 from 12x+30y expects whole-number brackets; a fractional
    // quotient is not what they meant, so ask for the result instead of writing 4(3x+15/2 y).
    if (terms.some(([, value]) => value.denominator !== BigInt(1))) return null;
    let result: AlgebraExpression | undefined;
    for (const [key, coefficient] of terms) {
      const [xDegree, yDegree, hDegree] = key.split(",").map(Number);
      const magnitude = coefficient.numerator < BigInt(0) ? -coefficient.numerator : coefficient.numerator;
      const factors: AlgebraExpression[] = [];
      if (coefficient.denominator !== BigInt(1))
        factors.push({ op: "divide", left: number(Number(magnitude)), right: number(Number(coefficient.denominator)) });
      else if (magnitude !== BigInt(1) || (!xDegree && !yDegree && !hDegree)) factors.push(number(Number(magnitude)));
      for (const [name, degree] of [
        ["x", xDegree],
        ["y", yDegree],
        ["h", hDegree],
      ] as const) {
        if (degree)
          factors.push(
            degree === 1 ? { op: "variable", name } : { op: "power", base: { op: "variable", name }, exponent: degree },
          );
      }
      const term = product(factors);
      result = result
        ? coefficient.numerator < BigInt(0)
          ? { op: "subtract", left: result, right: term }
          : { op: "add", args: [result, term] }
        : coefficient.numerator < BigInt(0)
          ? { op: "negate", argument: term }
          : term;
    }
    // A negative factor reads as "-y(…)", not "(-y)(…)".
    if (factor.op === "negate")
      return {
        op: "negate",
        argument: {
          op: "multiply",
          args: [
            ...(factor.argument.op === "multiply" ? factor.argument.args : [factor.argument]),
            result ?? number(0),
          ],
        },
      };
    return { op: "multiply", args: [...(factor.op === "multiply" ? factor.args : [factor]), result ?? number(0)] };
  } catch {
    return null;
  }
}

function structuralKey(expression: AlgebraExpression): string {
  if (expression.op === "add" || expression.op === "subtract") {
    const terms: string[] = [];
    const collect = (node: AlgebraExpression, negative: boolean) => {
      if (node.op === "add") node.args.forEach(term => collect(term, negative));
      else if (node.op === "subtract") {
        collect(node.left, negative);
        collect(node.right, !negative);
      } else if (node.op === "negate") collect(node.argument, !negative);
      else terms.push(`${negative ? "-" : "+"}${structuralKey(node)}`);
    };
    collect(expression, false);
    return `sum(${terms.sort().join(",")})`;
  }
  switch (expression.op) {
    case "number":
      return `n${expression.value}`;
    case "variable":
      return expression.name;
    case "multiply":
      return `mul(${expression.args.map(structuralKey).sort().join(",")})`;
    case "divide":
      return `div(${structuralKey(expression.left)},${structuralKey(expression.right)})`;
    case "negate":
      return `neg(${structuralKey(expression.argument)})`;
    case "power":
      return `pow(${structuralKey(expression.base)},${expression.exponent})`;
  }
}

export function cancelFactor(value: AlgebraExpression, factor: AlgebraExpression): AlgebraExpression | null {
  const fractions = value.op === "multiply" ? [...value.args] : [value];
  const factors = (node: AlgebraExpression) => (node.op === "multiply" ? [...node.args] : [node]);
  const key = structuralKey(factor);
  const numerators: { fraction: number; index: number }[] = [];
  const denominators: { fraction: number; index: number }[] = [];
  fractions.forEach((node, fraction) => {
    if (node.op !== "divide") return;
    factors(node.left).forEach((item, index) => {
      if (structuralKey(item) === key) numerators.push({ fraction, index });
    });
    factors(node.right).forEach((item, index) => {
      if (structuralKey(item) === key) denominators.push({ fraction, index });
    });
  });
  const numerator =
    numerators.find(item => denominators.some(other => other.fraction === item.fraction)) ?? numerators[0];
  const denominator = numerator && (denominators.find(item => item.fraction === numerator.fraction) ?? denominators[0]);
  if (!numerator || !denominator) return null;
  for (const index of new Set([numerator.fraction, denominator.fraction])) {
    const node = fractions[index];
    if (node.op !== "divide") return null;
    const top = factors(node.left),
      bottom = factors(node.right);
    if (index === numerator.fraction) top.splice(numerator.index, 1);
    if (index === denominator.fraction) bottom.splice(denominator.index, 1);
    const left = product(top),
      right = product(bottom);
    fractions[index] = right.op === "number" && right.value === 1 ? left : { op: "divide", left, right };
  }
  return product(fractions);
}
