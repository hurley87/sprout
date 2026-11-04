export const MATH_SCRIBE_PROBLEM_IDS = ["reciprocal", "negative-exponent"] as const;
export const ALL_MATH_SCRIBE_PROBLEM_IDS = [...MATH_SCRIBE_PROBLEM_IDS, "difference-quotient"] as const;
export type MathScribeProblemId = (typeof ALL_MATH_SCRIBE_PROBLEM_IDS)[number];

export type MathScribeProblem = {
  readonly id: MathScribeProblemId;
  readonly latex: string;
  readonly recapName: string;
  readonly statement?: string;
  readonly statedDomain?: readonly string[];
};

const problems: Record<MathScribeProblemId, MathScribeProblem> = {
  reciprocal: {
    id: "reciprocal",
    latex: String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`,
    recapName: "the fractions",
  },
  "negative-exponent": {
    id: "negative-exponent",
    latex: String.raw`(2+3x^2)^3(x^2+2x)^{-2}`,
    recapName: "the negative exponent",
  },
  "difference-quotient": {
    id: "difference-quotient",
    latex: String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`,
    recapName: "the difference quotient",
    statement: "Simplify the following expression, where h ≠ 0.",
    statedDomain: ["h ≠ 0"],
  },
};

export function isMathScribeProblemId(value: unknown): value is MathScribeProblemId {
  return ALL_MATH_SCRIBE_PROBLEM_IDS.includes(value as MathScribeProblemId);
}

export function getMathScribeProblem(id: MathScribeProblemId): MathScribeProblem {
  return problems[id];
}
