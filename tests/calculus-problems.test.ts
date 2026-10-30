import { expect, it } from "vitest";
import type { MathExpression as E } from "../lib/calculus/math-expression";
import { compareMathExpression } from "../lib/calculus/math-validator";
import { renderMathExpression } from "../lib/calculus/math-rendering";
import { CALCULUS_PROBLEM_IDS, getCalculusProblem, type CalculusMethod } from "../lib/calculus/problems";
import { applyExtraction, emptyWork, workInstruction, workOutcome } from "../lib/calculus/work-check";
import type { WorkExtraction } from "../lib/calculus/work-extraction";

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const mul = (...args: E[]): E => ({ op: "multiply", args });
const add = (...args: E[]): E => ({ op: "add", args });
const sub = (left: E, right: E): E => ({ op: "subtract", left, right });
const sin: E = { op: "sin", argument: x };
const cos: E = { op: "cos", argument: x };
const inner = add(mul(n(3), pow(x, 2)), n(1));
const extraction = (
  steps: [string, E][],
  final: E | null = null,
  unclear: string | null = null,
  rule: CalculusMethod | null = null,
): WorkExtraction => ({
  steps: steps.map(([stepId, expression]) => ({ stepId, expression, quote: "q" })),
  rule: rule ? { method: rule, quote: "q" } : null,
  final: final ? { expression: final, quote: "q" } : null,
  unclear,
});

it("authors every problem with required steps and a final form", () => {
  for (const id of CALCULUS_PROBLEM_IDS) {
    const problem = getCalculusProblem(id);
    expect(problem.steps.length).toBeGreaterThan(0);
    expect(problem.finalForms.length).toBeGreaterThan(0);
    for (const step of problem.steps)
      for (const form of step.accepted) expect(compareMathExpression(form, step.accepted)).toBe("match");
  }
});

it("carries optional display maths without changing plain tutor labels", () => {
  const expected = [
    ["Derivative of x³", { text: "Derivative of", expression: pow(x, 3) }],
    ["Derivative of the 4x term", { text: "Derivative of", expression: mul(n(4), x) }],
    ["Derivative of x²", { text: "Derivative of", expression: pow(x, 2) }],
    ["Derivative of sin x", { text: "Derivative of", expression: sin }],
    ["Derivative of the outer power", undefined],
    ["Derivative of the inside, 3x² + 1", { text: "Derivative of the inside,", expression: inner }],
  ];
  expect(
    CALCULUS_PROBLEM_IDS.flatMap(id => getCalculusProblem(id).steps.map(step => [step.label, step.labelMath])),
  ).toEqual(expected);
  for (const id of CALCULUS_PROBLEM_IDS) {
    const problem = getCalculusProblem(id);
    const work = emptyWork(id);
    const updated = applyExtraction(work, extraction(problem.steps.map(step => [step.id, step.accepted[0]])));
    for (const [index, step] of problem.steps.entries()) {
      expect(work.steps[index].label).toBe(step.label);
      expect(work.steps[index].labelMath).toEqual(step.labelMath);
      expect(updated.steps[index].labelMath).toEqual(step.labelMath);
      if (step.labelMath) expect(renderMathExpression(step.labelMath.expression).ok).toBe(true);
    }
    expect(work.final.labelMath).toBeUndefined();
    expect(workInstruction(work, workOutcome(work))).toContain(problem.steps[0].label);
  }
});

it("accepts equivalent final forms: reordered, factored and expanded", () => {
  expect(
    compareMathExpression(add(n(-4), mul(n(3), pow(x, 2))), getCalculusProblem("cubic-minus-linear").finalForms),
  ).toBe("match");
  const product = getCalculusProblem("quadratic-sine").finalForms;
  expect(compareMathExpression(add(mul(pow(x, 2), cos), mul(n(2), x, sin)), product)).toBe("match");
  expect(compareMathExpression(mul(x, add(mul(n(2), sin), mul(x, cos))), product)).toBe("match");
  const chain = getCalculusProblem("composite-fifth").finalForms;
  expect(compareMathExpression(mul(n(5), pow(inner, 4), mul(n(6), x)), chain)).toBe("match");
  expect(compareMathExpression(mul(n(5), pow(inner, 4)), chain)).toBe("mismatch");
});

it("abstains rather than calling unsupported notation wrong", () => {
  expect(compareMathExpression({ op: "derivative", argument: pow(x, 3) }, [mul(n(3), pow(x, 2))])).toBe("unsupported");
  expect(compareMathExpression(pow(x, -1), [x])).toBe("unsupported");
});

it("checks term-by-term work against each step, not the whole function", () => {
  // The live-run failure: 3x² for the x³ term was marked wrong as a whole derivative.
  const work = applyExtraction(emptyWork("cubic-minus-linear"), extraction([["d-cubic", mul(n(3), pow(x, 2))]]));
  expect(work.steps.map(step => step.status)).toEqual(["correct", "missing"]);
  expect(workOutcome(work)).toMatchObject({ kind: "in-progress" });
  // "The derivative of 4x is 4" keeps the subtraction; either sign counts for the step.
  for (const value of [4, -4])
    expect(applyExtraction(work, extraction([["d-linear", n(value)]])).steps.map(step => step.status)).toEqual([
      "correct",
      "correct",
    ]);
});

it("requires every step as well as the final answer", () => {
  const finalOnly = applyExtraction(emptyWork("cubic-minus-linear"), extraction([], sub(mul(n(3), pow(x, 2)), n(4))));
  const outcome = workOutcome(finalOnly);
  expect(outcome).toMatchObject({ kind: "show-work" });
  expect(workInstruction(finalOnly, outcome)).toContain('"Derivative of x³"');
  const complete = applyExtraction(
    finalOnly,
    extraction([
      ["d-cubic", mul(n(3), pow(x, 2))],
      ["d-linear", n(4)],
    ]),
  );
  expect(workOutcome(complete)).toEqual({ kind: "complete" });
});

it("points the tutor at the wrong step without giving its answer", () => {
  const work = applyExtraction(emptyWork("quadratic-sine"), extraction([["d-sine", { op: "negate", argument: cos }]]));
  const outcome = workOutcome(work);
  expect(outcome).toMatchObject({ kind: "incorrect", item: { id: "d-sine" } });
  const instruction = workInstruction(work, outcome);
  expect(instruction).toContain('"Derivative of sin x"');
  expect(instruction).toContain("Do not give the correct expression");
  expect(instruction).not.toMatch(/cosine of x\b(?! *\))/);
});

it("never requires a rule's name: correct work completes the problem", () => {
  const work = applyExtraction(
    emptyWork("quadratic-sine"),
    extraction(
      [
        ["d-square", mul(n(2), x)],
        ["d-sine", cos],
      ],
      add(mul(n(2), x, sin), mul(pow(x, 2), cos)),
    ),
  );
  expect(work.rule).toBeNull();
  expect(workOutcome(work)).toEqual({ kind: "complete" });
});

it("flags a named rule only when it doesn't fit the whole function", () => {
  const wrong = applyExtraction(emptyWork("composite-fifth"), extraction([], null, null, "product"));
  const outcome = workOutcome(wrong);
  expect(outcome).toMatchObject({ kind: "wrong-rule", rule: { method: "product", fits: false } });
  const instruction = workInstruction(wrong, outcome);
  expect(instruction).toContain("Do not name the rule to use");
  expect(instruction).not.toContain("chain");
  // The latest rule they name replaces it.
  expect(applyExtraction(wrong, extraction([], null, null, "chain")).rule?.fits).toBe(true);
  // Power or sum both fit a sum of powers.
  for (const rule of ["power", "sum"] as const)
    expect(workOutcome(applyExtraction(emptyWork("cubic-minus-linear"), extraction([], null, null, rule))).kind).toBe(
      "in-progress",
    );
});

it("asks how parts combine when every part is right but the final answer isn't", () => {
  const work = applyExtraction(
    emptyWork("quadratic-sine"),
    extraction(
      [
        ["d-square", mul(n(2), x)],
        ["d-sine", cos],
      ],
      mul(n(2), x, cos),
    ),
  );
  const outcome = workOutcome(work);
  expect(outcome).toMatchObject({ kind: "combine", item: { id: "final" } });
  expect(workInstruction(work, outcome)).toContain("how they are combining their parts");
});

it("keeps earlier steps when a later check omits them, and takes the latest restatement", () => {
  let work = applyExtraction(emptyWork("cubic-minus-linear"), extraction([["d-cubic", mul(n(3), pow(x, 3))]]));
  expect(work.steps[0].status).toBe("incorrect");
  work = applyExtraction(work, extraction([["d-linear", n(4)]]));
  expect(work.steps[0].status).toBe("incorrect");
  work = applyExtraction(work, extraction([["d-cubic", mul(n(3), pow(x, 2))]]));
  expect(work.steps.map(step => step.status)).toEqual(["correct", "correct"]);
});

it("asks for clarification on unclear or uncheckable speech", () => {
  const work = applyExtraction(emptyWork("cubic-minus-linear"), extraction([], null, "which term the 3 belongs to"));
  const outcome = workOutcome(work);
  expect(outcome).toEqual({ kind: "unclear", detail: "which term the 3 belongs to" });
  expect(workInstruction(work, outcome)).toContain("which term the 3 belongs to");
});
