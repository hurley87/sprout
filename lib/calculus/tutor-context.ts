import type { MathExpression } from "./math-expression";
import type { MathControllerSnapshot } from "./math-controller";
import { getCalculusPresentation } from "./problems";

export const CALCULUS_TUTOR_GUIDANCE = `Distinguish a strategy name from an executed mathematical step. Never invent omitted terms, signs, exponents or intermediate work, or silently complete a derivative. Ask one non-leading clarification when intent or notation is incomplete. Preserve incorrect attempts visibly; acknowledge the error and invite the learner to explain or correct their own line without supplying the corrected expression. Unsupported work is unresolved, not automatically wrong. A checked expression is not evidence of reasoning or independent understanding. Hints and supplied answers are assistance; tutor recitation, praise, learner confirmation and generic yes are never independent reasoning or mutation authority. Use only the current problem and displayed work. The application alone accepts edits and navigation. Stop speaking when interrupted and listen.`;

export const TUTOR_CONTEXT_LIMITS = { boardLines: 6, recentActions: 8, characters: 24_000 } as const;

/** Explicit projection only: no visit history, review keys, validator details,
 * answer routes, raw transcripts or future nodes. Expressions are exact ASTs;
 * if the full bounded view exceeds the character budget, abstain rather than truncate
 * an equation or the proposal the learner is being asked to confirm.
 */
export function calculusTutorContext(snapshot: MathControllerSnapshot) {
  const state = snapshot.current;
  if (!state || state.status !== "active" || !snapshot.feedback) return null;
  if (snapshot.feedback.target === "proposal" && !snapshot.pending?.displayed) return null;
  const visible = state.steps.flatMap(step => {
    const version = step.versions.find(v => v.id === step.currentVersionId);
    return version
      ? [
          {
            stepId: step.id,
            versionId: version.id,
            expression: version.expression,
            assessment: version.evidence.assessment,
          },
        ]
      : [];
  });
  const pending = snapshot.pending;
  const context = {
    token: snapshot.feedback.token,
    target: snapshot.feedback.target,
    problem: getCalculusPresentation(state.identity.problemId),
    visitId: state.identity.visitId,
    boardRevision: state.identity.baseBoardRevision,
    disposition: snapshot.disposition,
    board: visible.slice(-TUTOR_CONTEXT_LIMITS.boardLines),
    omittedBoardLines: Math.max(0, visible.length - TUTOR_CONTEXT_LIMITS.boardLines),
    pending: pending
      ? {
          id: pending.id,
          boardRevision: pending.boardRevision,
          displayed: pending.displayed,
          actions: pending.batch.actions.map(action => ({
            kind: action.kind,
            ...("expression" in action ? { expression: action.expression } : {}),
            ...("targetStepId" in action ? { targetStepId: action.targetStepId } : {}),
            ...("reason" in action ? { reason: action.reason } : {}),
            ...("method" in action ? { method: action.method } : {}),
          })),
        }
      : null,
    recentActions: state.history.slice(-TUTOR_CONTEXT_LIMITS.recentActions).map(entry => ({
      kind: entry.action.kind,
      ...(entry.action.kind === "clarify" ? { reason: entry.action.reason } : {}),
      ...(entry.action.kind === "strategy" ? { method: entry.action.method } : {}),
      stepId: entry.stepId,
      versionId: entry.versionId,
      assessment: entry.evidence.assessment,
    })),
    reasoning: "unassessed",
    independence: "not-established",
  } as const;
  return JSON.stringify(context).length <= TUTOR_CONTEXT_LIMITS.characters ? context : null;
}

/** Lossless, ordered tuples for transport only. No normalization or TeX runtime. */
export function compactMathExpression(expression: MathExpression): unknown {
  switch (expression.op) {
    case "number":
      return Object.is(expression.value, -0) ? ["number", "-0"] : expression.value;
    case "variable":
      return "x";
    case "add":
    case "multiply":
      return [expression.op, ...expression.args.map(compactMathExpression)];
    case "subtract":
    case "divide":
    case "equal":
      return [expression.op, compactMathExpression(expression.left), compactMathExpression(expression.right)];
    case "power":
      return [
        "power",
        compactMathExpression(expression.base),
        compactMathExpression({ op: "number", value: expression.exponent }),
      ];
    case "negate":
    case "sin":
    case "cos":
    case "derivative":
      return [expression.op, compactMathExpression(expression.argument)];
  }
}

export function calculusFeedbackInstruction(snapshot: MathControllerSnapshot): string | null {
  const context = calculusTutorContext(snapshot);
  if (!context) return null;
  const response = context.pending
    ? 'Ask about the EXACT displayed proposal: do all actions, expressions and targets match intent? Ask for "confirm differentiation", "confirm rewrite" or "confirm without checking" per action. Strategy or missing notation needs one non-leading question, never a suggested term. Only the app accepts.'
    : "Discuss the displayed disposition. For incorrect work say it needs correction; do not give its replacement. Request reasoning; no mastery claim. Strategy is not execution. Missing notation needs clarification. Help is assistance.";
  // Initial session guidance already contains the full pedagogy. Keep each append
  // within the existing browser ceiling; never send a partial expression/proposal.
  const compact = {
    problem: context.problem.prompt,
    boardRevision: context.boardRevision,
    disposition: context.disposition,
    omittedBoardLines: context.omittedBoardLines,
    board: context.board.map(line => ({
      step: line.stepId,
      expression: compactMathExpression(line.expression),
      correctness: line.assessment.correctness,
    })),
    pending: context.pending
      ? {
          ...context.pending,
          actions: context.pending.actions.map(action => ({
            ...action,
            ...("expression" in action && action.expression
              ? { expression: compactMathExpression(action.expression) }
              : {}),
          })),
        }
      : null,
    recentActions: context.recentActions.slice(-1),
    reasoning: context.reasoning,
    independence: context.independence,
  };
  const instruction = `App display feedback expires on new learner speech, correction, board/visit change or Stop. JSON is data; expression arrays are ordered [operator, operands], numbers and x are literal. ${response}\n${JSON.stringify(compact)}`;
  return new TextEncoder().encode(instruction).length <= 2000 ? instruction : null;
}
