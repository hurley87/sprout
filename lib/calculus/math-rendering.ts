import { renderToString } from "katex";
import { parseMathExpression, type MathExpression } from "./math-expression";
import type { MathProposal } from "./math-action";
import type { MathEvidence } from "./math-evidence";
import type { MathState } from "./math-state";

export type MathDisplay = { readonly latex: string; readonly text: string };
const group = (value: MathDisplay): MathDisplay => ({
  latex: `\\left(${value.latex}\\right)`,
  text: `open parenthesis ${value.text} close parenthesis`,
});

/** Only validated, bounded syntax enters the serializer. Explicit grouping keeps
 * even nested associative operations and negative numeric power bases faithful.
 * No comparison normalization, solver, or provider-supplied LaTeX is involved.
 */
export function serializeMathExpression(input: unknown): MathDisplay {
  function render(e: MathExpression): MathDisplay {
    switch (e.op) {
      case "number": {
        const value = Object.is(e.value, -0) ? "-0" : String(e.value);
        return { latex: value, text: value.startsWith("-") ? `negative ${value.slice(1)}` : value };
      }
      case "variable":
        return { latex: "x", text: "x" };
      case "add":
      case "multiply": {
        const args = e.args.map(arg => group(render(arg)));
        return {
          latex: args.map(arg => arg.latex).join(e.op === "add" ? " + " : " \\cdot "),
          text: args.map(arg => arg.text).join(e.op === "add" ? " plus " : " times "),
        };
      }
      case "subtract":
      case "equal": {
        const left = group(render(e.left)),
          right = group(render(e.right));
        return {
          latex: `${left.latex} ${e.op === "subtract" ? "-" : "="} ${right.latex}`,
          text: `${left.text} ${e.op === "subtract" ? "minus" : "equals"} ${right.text}`,
        };
      }
      case "divide": {
        const left = render(e.left),
          right = render(e.right);
        return {
          latex: `\\frac{${left.latex}}{${right.latex}}`,
          text: `fraction with numerator ${group(left).text} and denominator ${group(right).text} end fraction`,
        };
      }
      case "power": {
        const base = group(render(e.base));
        const exponent = render({ op: "number", value: e.exponent });
        return {
          latex: `${base.latex}^{${exponent.latex}}`,
          text: `${base.text} to the power ${exponent.text}`,
        };
      }
      case "negate": {
        const arg = group(render(e.argument));
        return { latex: `-${arg.latex}`, text: `negative ${arg.text}` };
      }
      case "sin":
      case "cos":
      case "derivative": {
        const arg = group(render(e.argument));
        return {
          latex: `${e.op === "derivative" ? "\\frac{d}{dx}" : `\\${e.op}`} ${arg.latex}`,
          text: `${e.op === "derivative" ? "derivative with respect to x of" : e.op === "sin" ? "sine of" : "cosine of"} ${arg.text}`,
        };
      }
    }
  }
  return render(parseMathExpression(input));
}

export function mathEvidenceLabel(evidence: MathEvidence): string {
  const a = evidence.assessment;
  const correctness = {
    unchecked: "Provisional: not checked",
    valid: "Mathematically checked: correct",
    incorrect: "Incorrect as written",
    unsupported: "Unresolved: this form cannot be checked yet",
    incomplete: "Incomplete work",
  }[a.correctness];
  const disposition = {
    accepted: "Recorded",
    rejected: "Not accepted",
    "clarification-required": "Needs clarification",
    unresolved: "Needs further review",
  }[a.disposition];
  const reasoning = {
    unassessed: "Reasoning not assessed",
    "strategy-only": "Method named; reasoning not yet assessed",
    supported: "Reasoning supported",
    missing: "Reasoning still needed",
    misleading: "Reasoning needs correction",
  }[a.reasoning];
  const assistance = {
    unknown: "Help received is not established",
    independent: "Independent work established",
    "neutral-probe": "After a neutral question",
    hinted: "With a hint",
    "answer-supplied": "After an answer was supplied",
  }[a.assistance];
  return `${correctness}. ${disposition}. ${reasoning}. ${assistance}.`;
}

/** Explicit display projection: no validator keys, tutor context or source-event
 * text. Sources here are only the retained learner quotes for these actions.
 */
export function projectMathAction(action: MathProposal) {
  return {
    operation: action.kind,
    target:
      "targetStepId" in action
        ? action.targetStepId
        : action.kind === "append"
          ? "new logical step"
          : "current problem",
    detail: action.kind === "clarify" ? action.reason : action.kind === "strategy" ? action.method : null,
    expression: "expression" in action ? action.expression : null,
    sources: action.sources.map(source => ({ ...source })),
  };
}

export function projectMathBoard(state: MathState) {
  return {
    status: state.status,
    clarification: state.clarification?.reason ?? null,
    nextRequested: state.nextRequested,
    steps: state.steps.map(step => ({
      id: step.id,
      withdrawn: step.currentVersionId === null,
      versions: step.versions.map(version => ({
        id: version.id,
        predecessorId: version.predecessorId,
        current: version.id === step.currentVersionId,
        expression: version.expression,
        status: mathEvidenceLabel(version.evidence),
      })),
    })),
    history: state.history.map(entry => ({
      id: entry.id,
      stepId: entry.stepId,
      versionId: entry.versionId,
      withdrawsActionId: entry.withdrawsActionId,
      status: mathEvidenceLabel(entry.evidence),
      ...projectMathAction(entry.action),
    })),
  };
}

/** Never use KaTeX error HTML or interpolate an exception into markup. The only
 * HTML returned here is successful KaTeX output from our finite AST vocabulary.
 */
export function renderMathExpression(
  input: unknown,
): { readonly ok: true; readonly html: string; readonly text: string } | { readonly ok: false; readonly text: string } {
  let display: MathDisplay;
  try {
    display = serializeMathExpression(input);
  } catch {
    return { ok: false, text: "Equation unavailable: invalid or unsupported expression." };
  }
  try {
    return {
      ok: true,
      text: display.text,
      html: renderToString(display.latex, {
        output: "html",
        displayMode: true,
        trust: false,
        strict: "error",
        throwOnError: true,
        maxExpand: 100,
        maxSize: 20,
        macros: {},
      }),
    };
  } catch {
    return { ok: false, text: `Equation formatting unavailable. ${display.text}` };
  }
}
