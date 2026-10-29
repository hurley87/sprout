import type { MathExpression as E } from "./math-expression";

export const CALCULUS_PROBLEM_IDS = ["cubic-minus-linear", "quadratic-sine", "composite-fifth"] as const;
export type CalculusProblemId = (typeof CALCULUS_PROBLEM_IDS)[number];
export function isCalculusProblemId(value: unknown): value is CalculusProblemId {
  return CALCULUS_PROBLEM_IDS.includes(value as CalculusProblemId);
}

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const add = (...args: E[]): E => ({ op: "add", args });
const mul = (...args: E[]): E => ({ op: "multiply", args });
const sub = (left: E, right: E): E => ({ op: "subtract", left, right });
const sin: E = { op: "sin", argument: x };
const cos: E = { op: "cos", argument: x };
const inner = add(mul(n(3), pow(x, 2)), n(1));

export type CalculusMethod = "power" | "product" | "chain" | "sum" | "other";
/** A piece of work the learner must show: a value equivalent to one of `accepted`.
 * Naming a rule is never required; correct work shows the rule was applied. */
export interface WorkStep {
  readonly id: string;
  readonly label: string;
  readonly labelMath?: { readonly text: string; readonly expression: E };
  readonly accepted: readonly E[];
}

export interface CalculusProblem {
  readonly id: CalculusProblemId;
  readonly prompt: string;
  readonly functionExpression: E;
  readonly tutorBrief: string;
  readonly steps: readonly WorkStep[];
  /** Rules that fit the whole function. Only a different rule named for the whole
   * function is flagged; naming none is fine. */
  readonly rules: readonly CalculusMethod[];
  /** Any form equivalent to one of these counts as the final derivative. */
  readonly finalForms: readonly E[];
}

const problems: Record<CalculusProblemId, CalculusProblem> = {
  "cubic-minus-linear": {
    id: "cubic-minus-linear",
    prompt: "Differentiate f(x) = x^3 - 4x.",
    functionExpression: sub(pow(x, 3), mul(n(4), x)),
    tutorBrief: "Ask how they would begin, then let them work term by term.",
    rules: ["power", "sum"],
    steps: [
      {
        id: "d-cubic",
        label: "Derivative of x³",
        labelMath: { text: "Derivative of", expression: pow(x, 3) },
        accepted: [mul(n(3), pow(x, 2))],
      },
      // Learners naturally say "the derivative of 4x is 4" and keep the subtraction;
      // the sign is checked in the final answer.
      {
        id: "d-linear",
        label: "Derivative of the 4x term",
        labelMath: { text: "Derivative of", expression: mul(n(4), x) },
        accepted: [n(4), n(-4)],
      },
    ],
    finalForms: [sub(mul(n(3), pow(x, 2)), n(4))],
  },
  "quadratic-sine": {
    id: "quadratic-sine",
    prompt: "Differentiate f(x) = x^2 sin(x).",
    functionExpression: mul(pow(x, 2), sin),
    tutorBrief: "Invite them to describe how they would handle the product, then differentiate each factor.",
    rules: ["product"],
    steps: [
      {
        id: "d-square",
        label: "Derivative of x²",
        labelMath: { text: "Derivative of", expression: pow(x, 2) },
        accepted: [mul(n(2), x)],
      },
      {
        id: "d-sine",
        label: "Derivative of sin x",
        labelMath: { text: "Derivative of", expression: sin },
        accepted: [cos],
      },
    ],
    finalForms: [add(mul(n(2), x, sin), mul(pow(x, 2), cos))],
  },
  "composite-fifth": {
    id: "composite-fifth",
    prompt: "Differentiate f(x) = (3x^2 + 1)^5.",
    functionExpression: pow(inner, 5),
    tutorBrief: "Invite them to describe the structure, then differentiate the outside and the inside.",
    rules: ["chain"],
    steps: [
      {
        id: "d-outer",
        label: "Derivative of the outer power",
        accepted: [mul(n(5), pow(inner, 4))],
      },
      {
        id: "d-inner",
        label: "Derivative of the inside, 3x² + 1",
        labelMath: { text: "Derivative of the inside,", expression: inner },
        accepted: [mul(n(6), x)],
      },
    ],
    finalForms: [mul(n(30), x, pow(inner, 4))],
  },
};

export function getCalculusProblem(id: CalculusProblemId): CalculusProblem {
  if (!isCalculusProblemId(id)) throw new Error("Unknown calculus problem");
  return problems[id];
}
