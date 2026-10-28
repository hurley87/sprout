import type { MathExpression } from "./math-expression";
import { serializeMathExpression } from "./math-rendering";
import { compareMathExpression, type MathComparison } from "./math-validator";
import { getCalculusProblem, type CalculusMethod, type CalculusProblemId } from "./problems";
import type { WorkExtraction } from "./work-extraction";

export type WorkStatus = "missing" | "correct" | "incorrect" | "unsupported";
export interface WorkItem {
  readonly id: string;
  readonly label: string;
  readonly status: WorkStatus;
  readonly expression: MathExpression | null;
  readonly method: CalculusMethod | null;
  readonly quote: string | null;
}
export interface CalculusWork {
  readonly problemId: CalculusProblemId;
  readonly steps: readonly WorkItem[];
  readonly final: WorkItem;
  readonly unclear: string | null;
}
export type WorkOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "incorrect"; readonly item: WorkItem }
  | { readonly kind: "unclear"; readonly detail: string }
  | { readonly kind: "show-work"; readonly missing: readonly WorkItem[] }
  | { readonly kind: "in-progress"; readonly correct: readonly WorkItem[]; readonly missing: readonly WorkItem[] };

const status = (comparison: MathComparison): WorkStatus =>
  comparison === "match" ? "correct" : comparison === "mismatch" ? "incorrect" : "unsupported";
const blank = (id: string, label: string): WorkItem => ({
  id,
  label,
  status: "missing",
  expression: null,
  method: null,
  quote: null,
});

export function emptyWork(problemId: CalculusProblemId): CalculusWork {
  const problem = getCalculusProblem(problemId);
  return {
    problemId,
    steps: problem.steps.map(step => blank(step.id, step.label)),
    final: blank("final", "Final answer"),
    unclear: null,
  };
}

/** Each extraction restates the learner's latest version of what it found. Steps it
 * omits keep their earlier record: the model sees every turn, but may not repeat
 * every step each time. Correctness is decided here, never by the model. */
export function applyExtraction(work: CalculusWork, extraction: WorkExtraction): CalculusWork {
  const problem = getCalculusProblem(work.problemId);
  const steps = work.steps.map(item => {
    const found = extraction.steps.findLast(step => step.stepId === item.id);
    const step = problem.steps.find(candidate => candidate.id === item.id)!;
    if (!found) return item;
    const checked: WorkStatus =
      step.kind === "method"
        ? found.method === step.method
          ? "correct"
          : "incorrect"
        : status(compareMathExpression(found.expression!, step.accepted));
    return { ...item, status: checked, expression: found.expression, method: found.method, quote: found.quote };
  });
  const final = extraction.final
    ? {
        ...work.final,
        status: status(compareMathExpression(extraction.final.expression, problem.finalForms)),
        expression: extraction.final.expression,
        quote: extraction.final.quote,
      }
    : work.final;
  return { ...work, steps, final, unclear: extraction.unclear };
}

/** Moving on needs every step shown correctly as well as the final answer. */
export function workOutcome(work: CalculusWork): WorkOutcome {
  const items = [...work.steps, work.final];
  const wrong = items.find(item => item.status === "incorrect");
  if (wrong) return { kind: "incorrect", item: wrong };
  if (items.every(item => item.status === "correct")) return { kind: "complete" };
  const unsupported = items.find(item => item.status === "unsupported");
  if (work.unclear || unsupported)
    return {
      kind: "unclear",
      detail: work.unclear ?? `how to read what they said for "${unsupported!.label}"`,
    };
  const missing = work.steps.filter(item => item.status !== "correct");
  if (work.final.status === "correct") return { kind: "show-work", missing };
  return { kind: "in-progress", correct: work.steps.filter(item => item.status === "correct"), missing };
}

const said = (item: WorkItem) =>
  item.expression ? serializeMathExpression(item.expression).text : item.method ? `the ${item.method} rule` : "";
const labels = (items: readonly WorkItem[]) => items.map(item => `"${item.label}"`).join(", ");

/** What the tutor is told after each check. The tutor never sees accepted answers. */
export function workInstruction(work: CalculusWork, outcome: WorkOutcome): string {
  const prefix = `Application check of the learner's work on "${getCalculusProblem(work.problemId).prompt}".`;
  switch (outcome.kind) {
    case "complete":
      return `${prefix} Every step and the final answer are correct. In one sentence, acknowledge something specific they did. Do not ask another question: the application will show the next problem.`;
    case "incorrect":
      return `${prefix} Their ${outcome.item.id === "final" ? "final answer" : `step "${outcome.item.label}"`} (${said(outcome.item)}) is not correct. Help with only that ${outcome.item.id === "final" ? "answer" : "step"}: say which part needs another look and ask one non-leading question about how they got it. Do not give the correct expression or the rule's result.`;
    case "unclear":
      return `${prefix} Ask one short question to clarify ${outcome.detail}. Do not suggest an answer.`;
    case "show-work":
      return `${prefix} Their final answer is correct, but they have not yet shown: ${labels(outcome.missing)}. Say the answer is right, then ask them to explain ${labels(outcome.missing.slice(0, 1))}.`;
    case "in-progress":
      return `${prefix} ${outcome.correct.length ? `Correct so far: ${labels(outcome.correct)}. ` : ""}Still to show: ${labels(outcome.missing)}, then the final answer. Briefly acknowledge and invite their next step without naming its result.`;
  }
}

export const CALCULUS_TUTOR_GUIDANCE = `You are helping a learner differentiate by speaking their work. Let them talk through it in their own words. After they speak, give at most a brief acknowledgment: the application checks each step and tells you what is correct, wrong or missing, and you follow that check rather than judging the math yourself. Never supply a correct expression, sign or exponent the learner has not said. Help one step at a time with non-leading questions; a requested hint is allowed. The application owns moving to the next problem. Stop speaking when interrupted and listen.`;
