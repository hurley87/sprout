import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MathWhiteboard } from "../components/calculus/math-whiteboard";
import type { MathControllerSnapshot } from "../lib/calculus/math-controller";
import { describe, expect, it, vi } from "vitest";
import * as katex from "katex";
import {
  renderMathExpression,
  serializeMathExpression as display,
  projectMathAction,
  projectMathBoard,
} from "../lib/calculus/math-rendering";
import { CALCULUS_PROBLEM_IDS, getCalculusPresentation, getCalculusReviewKey } from "../lib/calculus/problems";
import { acceptMathBatch, applyMathBatch, createMathState, type MathState } from "../lib/calculus/math-state";
import type { MathExpression as E } from "../lib/calculus/math-expression";
import type { MathProposal, MathActionAssessment } from "../lib/calculus/math-action";

vi.mock("katex", { spy: true });

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const sub = (left: E, right: E): E => ({ op: "subtract", left, right });
const div = (left: E, right: E): E => ({ op: "divide", left, right });
const neg = (argument: E): E => ({ op: "negate", argument });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const sources = [{ turnId: "u1", start: 0, end: 4, quote: "work" }];

function apply(state: MathState, action: MathProposal, correctness: MathActionAssessment["correctness"] = "unchecked") {
  return applyMathBatch(
    state,
    acceptMathBatch(
      state,
      `d${state.revision}`,
      { identity: state.identity, actions: [action] },
      {
        turns: [{ id: "u1", speaker: "learner", text: "work", order: 1 }],
        reviews: [
          {
            faithful: true,
            mathematicallyComplete: false,
            independenceEstablished: false,
            assessment: {
              disposition: correctness === "unsupported" ? "unresolved" : "accepted",
              correctness,
              reasoning: "unassessed",
              assistance: "unknown",
            },
          },
        ],
      },
    ),
  );
}

describe("faithful bounded display", () => {
  it.each(CALCULUS_PROBLEM_IDS)("renders all authored prompt, route, final and error fixtures: %s", id => {
    const key = getCalculusReviewKey(id);
    const expressions = [
      getCalculusPresentation(id).functionExpression,
      ...key.routes.flatMap(route => route.steps.map(step => step.expression)),
      ...key.finalForms,
      ...key.commonErrors.map(error => error.expression),
    ];
    for (const expression of expressions) {
      const before = structuredClone(expression);
      const result = renderMathExpression(expression);
      expect(result.ok).toBe(true);
      expect(result.text).toContain("x");
      if (result.ok) {
        expect(result.html).toContain('class="katex');
        expect(result.html).not.toContain("<math");
      }
      expect(expression).toEqual(before);
    }
  });
  it("preserves signs, operand order, subtraction grouping and nesting", () => {
    expect(display(sub(x, sub(n(2), n(-3))))).toEqual({
      latex: "\\left(x\\right) - \\left(\\left(2\\right) - \\left(-3\\right)\\right)",
      text: "open parenthesis x close parenthesis minus open parenthesis open parenthesis 2 close parenthesis minus open parenthesis negative 3 close parenthesis close parenthesis",
    });
    expect(display(sub(sub(x, n(2)), n(-3))).latex).not.toBe(display(sub(x, sub(n(2), n(-3)))).latex);
    expect(display(neg(neg(x))).latex).toBe("-\\left(-\\left(x\\right)\\right)");
    expect(display({ op: "add", args: [x, neg(n(2))] }).latex).toContain(" + \\left(-\\left(2");
    expect(display(n(-0)).text).toBe("negative 0");
    expect(display(pow(x, -0))).toEqual({
      latex: "\\left(x\\right)^{-0}",
      text: "open parenthesis x close parenthesis to the power negative 0",
    });
  });
  it("distinguishes fraction grouping, negation and powers of negative bases", () => {
    expect(display(div(x, div(n(2), n(3)))).latex).toBe("\\frac{x}{\\frac{2}{3}}");
    expect(display(div(div(x, n(2)), n(3))).latex).toBe("\\frac{\\frac{x}{2}}{3}");
    expect(display(div(x, div(n(2), n(3)))).text).toContain("denominator open parenthesis fraction with numerator");
    expect(display(pow(n(-2), 2)).latex).toBe("\\left(-2\\right)^{2}");
    expect(display(neg(pow(n(2), 2))).latex).toBe("-\\left(\\left(2\\right)^{2}\\right)");
    expect(display(pow(pow(x, 2), -3)).latex).toBe("\\left(\\left(x\\right)^{2}\\right)^{-3}");
    expect(display(pow(n(-2), -12)).text).toContain("negative 2 close parenthesis to the power negative 12");
    expect(display(div(x, n(0))).latex).toBe("\\frac{x}{0}"); // never repair division by zero
  });
  it("retains equality, derivative, trigonometry and explicit multiplication", () => {
    const expression: E = {
      op: "equal",
      left: { op: "derivative", argument: x },
      right: { op: "multiply", args: [n(-2), { op: "cos", argument: { op: "sin", argument: neg(x) } }] },
    };
    const result = display(expression);
    expect(result.latex).toContain("\\frac{d}{dx}");
    expect(result.latex).toContain(" \\cdot ");
    expect(result.text).toContain("derivative with respect to x of");
    expect(result.text).toContain("equals");
    expect(result.text).toContain("times");
    expect(result.text).toContain("cosine of open parenthesis sine of");
    expect(renderMathExpression(expression).ok).toBe(true);
  });
  it("handles valid boundary sizes and rejects invalid runtime input without error HTML", () => {
    let depth: E = x;
    for (let i = 0; i < 15; i++) depth = neg(depth);
    expect(renderMathExpression(depth).ok).toBe(true);
    const cycle: Record<string, unknown> = { op: "sin" };
    cycle.argument = cycle;
    const branch = { op: "add", args: Array(8).fill(x) };
    const sparse = [x, ,];
    Object.assign(sparse, { extra: x });
    const inputs: unknown[] = [
      null,
      undefined,
      "\\href{javascript:alert(1)}{x}",
      [],
      { op: "number", value: NaN },
      n(1000000),
      n(1.5),
      pow(x, 13),
      neg(depth),
      cycle,
      { op: "add", args: [] },
      { op: "multiply", args: [x] },
      { op: "add", args: Array(9).fill(x) },
      { op: "add", args: sparse },
      { op: "add", args: Array(8).fill({ op: "multiply", args: Array(8).fill(branch) }) },
      { ...x, latex: "<script>bad</script>" },
      {
        op: "number",
        get value() {
          throw new Error("<script>bad</script>");
        },
      },
    ];
    for (const input of inputs) {
      expect(() => display(input)).toThrow();
      expect(renderMathExpression(input)).toEqual({
        ok: false,
        text: "Equation unavailable: invalid or unsupported expression.",
      });
    }
    expect(renderMathExpression({ op: "add", args: Array(8).fill(n(999999)) }).ok).toBe(true);
  });
  it("bounds KaTeX and returns plain accessible text if formatting fails", () => {
    const spy = vi.spyOn(katex, "renderToString").mockImplementationOnce(() => {
      throw new Error("<img onerror=bad>");
    });
    try {
      expect(renderMathExpression(x)).toEqual({ ok: false, text: "Equation formatting unavailable. x" });
      expect(spy).toHaveBeenCalledWith(
        "x",
        expect.objectContaining({
          trust: false,
          maxExpand: 100,
          maxSize: 20,
          throwOnError: true,
          output: "html",
          strict: "error",
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("read-only history and status projection", () => {
  it("retains incorrect signs, correction predecessors, restored work and withdrawal", () => {
    let state = createMathState({
      runtimeId: "r",
      problemId: "cubic-minus-linear",
      visitId: "v",
      transcriptRevision: 1,
      baseBoardRevision: 0,
    });
    state = apply(state, { kind: "append", expression: sub(x, n(2)), sources }, "incorrect");
    state = apply(state, { kind: "replace", targetStepId: "s1", expression: sub(x, n(-2)), sources }, "valid");
    state = apply(state, { kind: "undo", targetStepId: "s1", sources });
    const before = structuredClone(state),
      view = projectMathBoard(state);
    expect(view.steps[0].versions.map(v => [v.id, v.predecessorId, v.current])).toEqual([
      ["s1v1", null, true],
      ["s1v2", "s1v1", false],
    ]);
    expect(view.steps[0].versions[0].status).toContain("Incorrect");
    expect(view.steps[0].versions[0].expression).toEqual(sub(x, n(2)));
    expect(view.history.map(h => h.operation)).toEqual(["append", "replace", "undo"]);
    expect(view.history[2].withdrawsActionId).toBe("a2");
    expect(view.history[1].sources).toEqual(sources);
    expect(state).toEqual(before);
    state = apply(state, { kind: "undo", targetStepId: "s1", sources });
    expect(projectMathBoard(state).steps[0].withdrawn).toBe(true);
  });
  it("projects provisional/unresolved work and every non-equation action without private context", () => {
    let state = createMathState({
      runtimeId: "r",
      problemId: "cubic-minus-linear",
      visitId: "v",
      transcriptRevision: 1,
      baseBoardRevision: 0,
    });
    state = apply(state, { kind: "append", expression: x, sources });
    expect(projectMathBoard(state).steps[0].versions[0].status).toContain("Provisional");
    state = apply(state, { kind: "replace", targetStepId: "s1", expression: x, sources }, "unsupported");
    for (const action of [
      { kind: "strategy", method: "chain", sources },
      { kind: "clarify", reason: "missing-operand", sources },
      { kind: "help", sources },
      { kind: "next", sources },
    ] as const)
      state = apply(state, action);
    const view = projectMathBoard(state);
    expect(view.steps[0].versions[1].status).toContain("Unresolved");
    expect(view.history.map(h => h.operation)).toEqual(["append", "replace", "strategy", "clarify", "help", "next"]);
    expect(view.clarification).toBe("missing-operand");
    expect(view.nextRequested).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/sourceEvents|initialTutorContext|finalForms|nonLeadingProbes/);
    expect(projectMathAction({ kind: "replace", targetStepId: "s1", sources, expression: x })).toEqual({
      operation: "replace",
      target: "s1",
      detail: null,
      sources,
      expression: x,
    });
  });
});

describe("learner board markup", () => {
  it("shows every pending action, target and quote in order, with one accessible equation path", () => {
    let state = createMathState({
      runtimeId: "runtime-secret",
      problemId: "cubic-minus-linear",
      visitId: "visit-secret",
      transcriptRevision: 1,
      baseBoardRevision: 0,
    });
    state = apply(state, { kind: "append", expression: x, sources }, "incorrect");
    const quote = '<script>alert("learner words")</script>';
    const quoted = [{ turnId: "private-turn-id", start: 0, end: quote.length, quote }];
    const actions: MathProposal[] = [
      { kind: "strategy", method: "product", sources: quoted },
      { kind: "append", expression: sub(x, n(-2)), sources: quoted },
      { kind: "replace", expression: n(-2), targetStepId: "s1", sources: quoted },
      { kind: "undo", targetStepId: "s1", sources: quoted },
      { kind: "clarify", reason: "missing-operand", sources: quoted },
      { kind: "help", sources: quoted },
      { kind: "next", sources: quoted },
    ];
    const math: MathControllerSnapshot = {
      current: state,
      checks: [],
      visits: [],
      disposition: "pending-clarification",
      pending: {
        id: "exact-pending-id",
        boardRevision: 1,
        displayed: false,
        status: "awaiting-learner-confirmation",
        batch: { identity: state.identity, actions },
      },
      feedback: { token: "exact-feedback-token", target: "proposal", boardRevision: 1 },
    };
    const onProposalDisplayed = vi.fn(),
      onFeedbackDisplayed = vi.fn();
    const before = structuredClone(math);
    const html = renderToStaticMarkup(
      createElement(MathWhiteboard, { math, onProposalDisplayed, onFeedbackDisplayed }),
    );
    const visibleText = html.replace(/<[^>]*>/g, "");
    const labels = [
      "Name a method",
      "Add a step",
      "Correct a step",
      "Undo the latest edit",
      "Ask for clarification",
      "Request help",
      "Request the next problem",
    ];
    let previous = -1;
    for (const label of labels) {
      const index = html.indexOf(label);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(html.match(/&lt;script&gt;/g)).toHaveLength(actions.length);
    expect(html).not.toContain("<script>");
    expect(html).toContain('data-pending-id="exact-pending-id"');
    expect(html).toContain('data-feedback-token="exact-feedback-token"');
    expect(html).toContain('data-source-turn="private-turn-id"');
    expect(visibleText).not.toMatch(
      /runtime-secret|visit-secret|exact-pending-id|exact-feedback-token|private-turn-id|pending-clarification|s1v1|Board revision/,
    );
    expect(visibleText).toContain("For: step 1");
    expect(visibleText).toContain("Incorrect as written");
    expect(html).not.toContain("<math");
    expect(html.match(/aria-hidden="true"><span class="katex-display"/g)).toHaveLength(4);
    expect(html.match(/tabindex="0" role="group"/g)).toHaveLength(4);
    expect(onProposalDisplayed).not.toHaveBeenCalled();
    expect(onFeedbackDisplayed).not.toHaveBeenCalled();
    expect(math).toEqual(before);
  });
});
