import type { PassageId } from "./sources";

/** MAE386 content/fixture types only. This is not a shared scoring engine. */
export type Basis = "source-backed" | "course-inference" | "open-ended-argument";
export type Criterion = {
  id: string;
  /** The sole authored assessment target, projected into both live and cumulative Jev questions. */
  description: string;
  basis: Basis;
  sources: readonly PassageId[];
  /** Optional feedback strength, excluded from required live/cumulative assessment targets. */
  optional?: boolean;
};
export type EvidenceLabel = "independent" | "assisted" | "partial" | "incorrect" | "unresolved" | "missing";
export type ExampleCategory =
  "complete" | "partial" | "incorrect" | "ambiguous" | "alternate" | "assisted" | "echo" | "self-correction";
export type Example = {
  name: string;
  category: ExampleCategory;
  /** Authored synthetic examples, never quotations from the manuscript or real students. */
  turns: readonly { speaker: "learner" | "tutor"; text: string }[];
  expected: Readonly<Record<string, EvidenceLabel>>;
  /** One-based turn positions for actual learner evidence; tutor turns are context only. */
  evidenceTurns: readonly number[];
  rationale: string;
};
export type RubricUnit = {
  id: string;
  originalPart: string;
  prompt: string;
  visibleSource?: string;
  referenceAnswer: string;
  criteria: readonly Criterion[];
  tutor: {
    /** Compact private meaning relations for spoken rewrite feedback; never an answer key. */
    preservation?: string;
    probe: string;
    help: string;
    avoid: string;
    close: string;
  };
  /** Explicit question-specific interpretation/author-review boundary, even when none is blocking. */
  review: string;
  examples: readonly Example[];
};
export type QuestionRubric = {
  id: "q1" | "q6" | "q8" | "q10" | "q5" | "q12" | "q14" | "q15";
  title: string;
  mode: string;
  adaptation: string;
  units: readonly RubricUnit[];
};

export const learner = (text: string) => ({ speaker: "learner" as const, text });
export const tutor = (text: string) => ({ speaker: "tutor" as const, text });
export const example = (
  name: string,
  category: ExampleCategory,
  text: string | Example["turns"],
  expected: Example["expected"],
  rationale: string,
  evidenceTurns: readonly number[] = [1],
): Example => ({
  name,
  category,
  turns: typeof text === "string" ? [learner(text)] : text,
  expected,
  evidenceTurns,
  rationale,
});
