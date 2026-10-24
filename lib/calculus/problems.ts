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
const d = (argument: E): E => ({ op: "derivative", argument });
const sin: E = { op: "sin", argument: x };
const cos: E = { op: "cos", argument: x };
const inner = add(mul(n(3), pow(x, 2)), n(1));
const cubic = sub(pow(x, 3), mul(n(4), x));
const product = mul(pow(x, 2), sin);
const composite = pow(inner, 5);

export interface CalculusPresentation {
  readonly id: CalculusProblemId;
  readonly prompt: string;
  readonly functionExpression: E;
  readonly initialTutorContext: string;
}
const presentations: readonly CalculusPresentation[] = [
  {
    id: "cubic-minus-linear",
    prompt: "Differentiate f(x) = x^3 - 4x.",
    functionExpression: cubic,
    initialTutorContext: "Ask the learner how they would begin and invite their own steps. Keep their signs as spoken.",
  },
  {
    id: "quadratic-sine",
    prompt: "Differentiate f(x) = x^2 sin(x).",
    functionExpression: product,
    initialTutorContext: "Invite a method and the learner's next written step. A method name alone is not execution.",
  },
  {
    id: "composite-fifth",
    prompt: "Differentiate f(x) = (3x^2 + 1)^5.",
    functionExpression: composite,
    initialTutorContext:
      "Invite the learner to describe the structure and supply their own steps. Ask for clarification when terms are missing.",
  },
];
/** Explicit projection: never spread a review key into initial model/public context.
 * Keys below are authoring data, not confidential browser secrets. A later tutor
 * projection must select only feedback warranted by the learner's current work.
 */
export function getCalculusPresentation(id: CalculusProblemId): CalculusPresentation {
  const p = presentations.find(problem => problem.id === id);
  if (!p) throw new Error("Unknown calculus problem");
  return {
    id: p.id,
    prompt: p.prompt,
    functionExpression: p.functionExpression,
    initialTutorContext: p.initialTutorContext,
  };
}

interface AuthoredRoute {
  readonly method: string;
  readonly steps: readonly { readonly explanation: string; readonly expression: E }[];
}
export interface CalculusReviewKey {
  readonly expectedMethods: readonly string[];
  readonly routes: readonly AuthoredRoute[];
  readonly finalForms: readonly E[];
  readonly commonErrors: readonly { readonly description: string; readonly expression: E; readonly probe: string }[];
  readonly nonLeadingProbes: readonly string[];
  readonly reasoningCriteria: readonly string[];
  readonly completionConditions: readonly string[];
  readonly equivalenceBoundary: string;
}
const completionConditions = [
  "A learner-supplied complete derivative is checked against a documented supported form or route.",
  "Learner reasoning supports the relevant criteria; naming a rule or repeating a final alone is insufficient.",
  "Record assistance separately; unknown or supplied help must not become independent mastery.",
  "Explicit next, skip and end requests are navigation intents, not demonstrated understanding.",
];
const equivalenceBoundary =
  "These are finite authored candidate forms and routes for later validation, not implemented equivalence rules. Reordering sums/products and the listed expansions may be supported explicitly later. Other valid forms remain unresolved until supported; syntax acceptance proves no mathematics.";
const cubicFinal = sub(mul(n(3), pow(x, 2)), n(4));
const productFinal = add(mul(n(2), x, sin), mul(pow(x, 2), cos));
const chainFinal = mul(n(30), x, pow(inner, 4));
const expandedOriginal = add(
  mul(n(243), pow(x, 10)),
  mul(n(405), pow(x, 8)),
  mul(n(270), pow(x, 6)),
  mul(n(90), pow(x, 4)),
  mul(n(15), pow(x, 2)),
  n(1),
);
const expandedDerivative = add(
  mul(n(2430), pow(x, 9)),
  mul(n(3240), pow(x, 7)),
  mul(n(1620), pow(x, 5)),
  mul(n(360), pow(x, 3)),
  mul(n(30), x),
);
const reviewKeys: Record<CalculusProblemId, CalculusReviewKey> = {
  "cubic-minus-linear": {
    expectedMethods: ["linearity/difference rule", "power rule", "constant multiple rule"],
    routes: [
      {
        method: "Differentiate terms separately",
        steps: [
          {
            explanation: "Distribute the derivative over the difference.",
            expression: sub(d(pow(x, 3)), d(mul(n(4), x))),
          },
          {
            explanation: "Apply the power rule and keep the coefficient of the linear term.",
            expression: sub(mul(n(3), pow(x, 2)), mul(n(4), n(1))),
          },
          { explanation: "Simplify the constant product.", expression: cubicFinal },
        ],
      },
      {
        method: "View the subtraction as addition of a negative multiple",
        steps: [
          { explanation: "Rewrite the original without changing its sign.", expression: add(pow(x, 3), mul(n(-4), x)) },
          { explanation: "Differentiate each summand.", expression: add(mul(n(3), pow(x, 2)), n(-4)) },
        ],
      },
    ],
    finalForms: [cubicFinal, add(mul(n(3), pow(x, 2)), n(-4))],
    commonErrors: [
      {
        description: "Lose the subtraction sign",
        expression: add(mul(n(3), pow(x, 2)), n(4)),
        probe: "How did the second term change in your step?",
      },
      {
        description: "Keep the original exponent",
        expression: sub(mul(n(3), pow(x, 3)), n(4)),
        probe: "How did you apply your rule to the first term?",
      },
      {
        description: "Treat the linear term as a constant",
        expression: mul(n(3), pow(x, 2)),
        probe: "What happened to each original term?",
      },
    ],
    nonLeadingProbes: [
      "Talk me through the change from your first line to your second.",
      "How could you check each term?",
    ],
    reasoningCriteria: [
      "Explain that differentiation distributes across the difference.",
      "Apply n*x^(n-1) with n=3.",
      "Explain why the derivative of 4x is 4 and preserve subtraction.",
    ],
    completionConditions,
    equivalenceBoundary,
  },
  "quadratic-sine": {
    expectedMethods: ["product rule", "power rule", "derivative of sine"],
    routes: [
      {
        method: "Product rule with the quadratic first",
        steps: [
          {
            explanation: "Differentiate one factor at a time, keeping the other.",
            expression: add(mul(d(pow(x, 2)), sin), mul(pow(x, 2), d(sin))),
          },
          { explanation: "Evaluate the two derivatives.", expression: productFinal },
        ],
      },
      {
        method: "Product rule with sine first",
        steps: [
          {
            explanation: "Swap the factor order before applying the same rule.",
            expression: add(mul(d(sin), pow(x, 2)), mul(sin, d(pow(x, 2)))),
          },
          {
            explanation: "Evaluate derivatives in that order.",
            expression: add(mul(cos, pow(x, 2)), mul(sin, n(2), x)),
          },
          { explanation: "Optionally factor out x.", expression: mul(x, add(mul(n(2), sin), mul(x, cos))) },
        ],
      },
    ],
    finalForms: [productFinal, add(mul(pow(x, 2), cos), mul(n(2), x, sin)), mul(x, add(mul(n(2), sin), mul(x, cos)))],
    commonErrors: [
      {
        description: "Multiply the two derivatives instead of differentiating the product",
        expression: mul(n(2), x, cos),
        probe: "How did your chosen rule combine the two factors?",
      },
      {
        description: "Omit the second product-rule term",
        expression: mul(n(2), x, sin),
        probe: "Explain what changed and what stayed fixed in your line.",
      },
      {
        description: "Use a negative cosine for the derivative of sine",
        expression: sub(mul(n(2), x, sin), mul(pow(x, 2), cos)),
        probe: "How did you obtain the trigonometric derivative?",
      },
    ],
    nonLeadingProbes: [
      "What structure do you see in the original function?",
      "Explain the origin of each term in your result.",
    ],
    reasoningCriteria: [
      "Identify two multiplied functions, not a composition alone.",
      "Explain why u'v + uv' has two terms, each keeping one original factor.",
      "Use (x^2)'=2x and (sin x)'=cos x; a correct expression called only chain rule needs follow-up.",
    ],
    completionConditions,
    equivalenceBoundary,
  },
  "composite-fifth": {
    expectedMethods: ["chain rule with power rule", "alternatively binomial expansion followed by termwise power rule"],
    routes: [
      {
        method: "Differentiate outer and inner functions",
        steps: [
          {
            explanation: "Apply the outer power rule and retain the inner derivative.",
            expression: mul(n(5), pow(inner, 4), d(inner)),
          },
          { explanation: "Differentiate the inner polynomial.", expression: mul(n(5), pow(inner, 4), mul(n(6), x)) },
          { explanation: "Combine scalar factors.", expression: chainFinal },
        ],
      },
      {
        method: "Expand first, then differentiate term by term",
        steps: [
          { explanation: "Use the binomial theorem on the original fifth power.", expression: expandedOriginal },
          {
            explanation: "Differentiate all six polynomial terms (the constant disappears).",
            expression: expandedDerivative,
          },
        ],
      },
    ],
    finalForms: [chainFinal, mul(n(5), pow(inner, 4), mul(n(6), x)), expandedDerivative],
    commonErrors: [
      {
        description: "Omit the inner derivative",
        expression: mul(n(5), pow(inner, 4)),
        probe: "How does your step account for the original function's structure?",
      },
      {
        description: "Include a derivative for the constant as 1",
        expression: mul(n(5), pow(inner, 4), add(mul(n(6), x), n(1))),
        probe: "Explain how you differentiated each part inside the parentheses.",
      },
      {
        description: "Keep the outer exponent at five",
        expression: mul(n(30), x, pow(inner, 5)),
        probe: "What rule did you apply to the outer function?",
      },
    ],
    nonLeadingProbes: [
      "Describe the sequence of operations that builds this function.",
      "Explain where each factor in your result came from.",
    ],
    reasoningCriteria: [
      "For the chain route, identify outer u^5 and inner 3x^2+1.",
      "Explain the outer derivative 5u^4 and multiplication by the inner derivative 6x.",
      "For expansion, justify binomial coefficients and differentiate termwise; chain-rule vocabulary is not required on that route.",
    ],
    completionConditions,
    equivalenceBoundary,
  },
};
/** Review/validation input only. Never the initial tutor payload. */
export function getCalculusReviewKey(id: CalculusProblemId): CalculusReviewKey {
  if (!isCalculusProblemId(id)) throw new Error("Unknown calculus problem");
  return reviewKeys[id];
}
