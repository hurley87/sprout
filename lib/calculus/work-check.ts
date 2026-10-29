import type { MathExpression } from "./math-expression";
import { serializeMathExpression } from "./math-rendering";
import { compareMathExpression, type MathComparison } from "./math-validator";
import { getCalculusProblem, type CalculusMethod, type CalculusProblemId, type WorkStep } from "./problems";
import type { WorkExtraction } from "./work-extraction";

export type WorkStatus = "missing" | "correct" | "incorrect" | "unsupported";
export interface WorkItem {
  readonly id: string;
  readonly label: string;
  readonly labelMath?: WorkStep["labelMath"];
  readonly status: WorkStatus;
  readonly expression: MathExpression | null;
  readonly quote: string | null;
}
/** A rule named for the whole function. Optional: only a misfit is acted on. */
export interface NamedRule {
  readonly method: CalculusMethod;
  readonly quote: string;
  readonly fits: boolean;
}
export interface CalculusWork {
  readonly problemId: CalculusProblemId;
  readonly steps: readonly WorkItem[];
  readonly final: WorkItem;
  readonly rule: NamedRule | null;
  readonly unclear: string | null;
}
export type WorkOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "incorrect"; readonly item: WorkItem }
  | { readonly kind: "combine"; readonly item: WorkItem }
  | { readonly kind: "wrong-rule"; readonly rule: NamedRule }
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
  quote: null,
});

export function emptyWork(problemId: CalculusProblemId): CalculusWork {
  const problem = getCalculusProblem(problemId);
  return {
    problemId,
    steps: problem.steps.map(step => ({
      ...blank(step.id, step.label),
      ...(step.labelMath ? { labelMath: step.labelMath } : {}),
    })),
    final: blank("final", "Final answer"),
    rule: null,
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
    const checked = status(compareMathExpression(found.expression, step.accepted));
    return { ...item, status: checked, expression: found.expression, quote: found.quote };
  });
  const rule = extraction.rule
    ? { ...extraction.rule, fits: problem.rules.includes(extraction.rule.method) }
    : work.rule;
  const final = extraction.final
    ? {
        ...work.final,
        status: status(compareMathExpression(extraction.final.expression, problem.finalForms)),
        expression: extraction.final.expression,
        quote: extraction.final.quote,
      }
    : work.final;
  return { ...work, steps, final, rule, unclear: extraction.unclear };
}

/** Moving on needs every step shown correctly as well as the final answer; correct
 * work counts whatever rule was or wasn't named. */
export function workOutcome(work: CalculusWork): WorkOutcome {
  const items = [...work.steps, work.final];
  if (items.every(item => item.status === "correct")) return { kind: "complete" };
  const wrong = work.steps.find(item => item.status === "incorrect");
  if (wrong) return { kind: "incorrect", item: wrong };
  if (work.final.status === "incorrect")
    return work.steps.every(item => item.status === "correct")
      ? { kind: "combine", item: work.final }
      : { kind: "incorrect", item: work.final };
  if (work.rule && !work.rule.fits) return { kind: "wrong-rule", rule: work.rule };
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

const said = (item: WorkItem) => (item.expression ? serializeMathExpression(item.expression).text : "");
const labels = (items: readonly WorkItem[]) => items.map(item => `"${item.label}"`).join(", ");

/** What the tutor is told after each check. The tutor never sees accepted answers. */
export function workInstruction(work: CalculusWork, outcome: WorkOutcome): string {
  const prefix = `Application check of the learner's work on "${getCalculusProblem(work.problemId).prompt}".`;
  switch (outcome.kind) {
    case "complete":
      return `${prefix} Every step and the final answer are correct. In one sentence, acknowledge something specific they did. Do not ask another question: the application will show the next problem.`;
    case "incorrect":
      return `${prefix} Their ${outcome.item.id === "final" ? "final answer" : `step "${outcome.item.label}"`} (${said(outcome.item)}) is not correct. Help with only that ${outcome.item.id === "final" ? "answer" : "step"}: say which part needs another look and ask one non-leading question about how they got it. Do not give the correct expression or the rule's result.`;
    case "combine":
      return `${prefix} Each part they found is correct, but their final answer (${said(outcome.item)}) is not. Ask one question about how they are combining their parts, in terms of what they did rather than a rule's name. Do not give the combined expression.`;
    case "wrong-rule":
      return `${prefix} They said they would use the ${outcome.rule.method} rule for the whole function, which does not fit how this function is built. Ask one question that gets them to look at how the function is put together. Do not name the rule to use.`;
    case "unclear":
      return `${prefix} Ask one short question to clarify ${outcome.detail}. Do not suggest an answer.`;
    case "show-work":
      return `${prefix} Their final answer is correct, but they have not yet shown: ${labels(outcome.missing)}. Say the answer is right, then ask how they got ${labels(outcome.missing.slice(0, 1))}, in plain terms rather than asking for a rule's name.`;
    case "in-progress":
      return `${prefix} ${outcome.correct.length ? `Correct so far: ${labels(outcome.correct)}. ` : ""}Still to show: ${outcome.missing.length ? `${labels(outcome.missing)}, then the final answer` : "the final answer"}. Briefly acknowledge and invite their next step without naming its result.`;
  }
}

export const CALCULUS_TUTOR_GUIDANCE = `You are helping a learner differentiate by speaking their work. Let them talk through it in their own words. The application checks each step and tells you what is correct, wrong or missing; follow that check rather than judging the math yourself. Until a check arrives, reply only with a short neutral acknowledgment such as "Okay" or "Mm-hmm": do not judge their work, say which part they are on, or invite them to do more. Never supply a correct expression, sign or exponent the learner has not said. Help one step at a time with non-leading questions; a requested hint is allowed. Never ask the learner to name a rule: ask what they are doing, not what it is called. The application owns moving to the next problem. Stop speaking when interrupted and listen.`;
