import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
  parseAssessment,
} from "../lib/lesson-runtime/conversation-assessment";

const lesson = {
  ...CATCHING_UNICORNS_LESSON,
  nodes: {
    engram: {
      ...CATCHING_UNICORNS_LESSON.nodes.engram,
      concepts: [CATCHING_UNICORNS_LESSON.nodes.engram.concepts![0]],
    },
  },
};
const key = `engram:${lesson.nodes.engram.concepts[0].id}`;
const content = {
  type: "choice",
  choice: "demonstrated",
  confidence: 0.96,
  probabilities: { demonstrated: 0.96, partial: 0.03, not_yet: 0.01 },
};
const unclear = {
  type: "choice",
  choice: "independent",
  confidence: 0.52,
  probabilities: { independent: 0.52, prompted: 0.47, unclear: 0.01 },
};
const body = (understanding = content, assistance = unclear) => ({
  version: ASSESSMENT_VERSION,
  answers: { [`${key}:understanding`]: understanding, [`${key}:assistance`]: assistance },
});
const legacyScores = {
  type: "choice",
  choice: "demonstrated_independent",
  confidence: 0.52,
  probabilities: { not_yet: 0, partial: 0.01, demonstrated_independent: 0.52, demonstrated_prompted: 0.47 },
};

it("gates content and assistance independently, retaining both raw provider confidences and probabilities", () => {
  const assessment = normalizeAssessment(body(), lesson)!;
  const result = assessment.results[key];
  expect(result.understanding).toEqual({
    outcome: "demonstrated",
    abstained: false,
    scores: { choice: content.choice, confidence: content.confidence, probabilities: content.probabilities },
  });
  expect(result.assistance.outcome).toBe("unclear");
  expect(result.assistance.abstained).toBe(true);
  expect(result.assistance.scores.confidence).toBe(0.52);
  expect(result.assistance.scores.probabilities).toEqual(unclear.probabilities);
  expect(parseAssessment(assessment, lesson)).toEqual(assessment);
});
it("abstains on genuinely ambiguous understanding even with certain prompting", () => {
  const result = normalizeAssessment(
    body(
      { ...content, confidence: 0.6, probabilities: { demonstrated: 0.6, partial: 0.4, not_yet: 0 } },
      {
        ...unclear,
        choice: "prompted",
        confidence: 0.99,
        probabilities: { independent: 0.01, prompted: 0.99, unclear: 0 },
      },
    ),
    lesson,
  )!.results[key];
  expect(result.understanding.outcome).toBe("uncertain");
  expect(result.understanding.abstained).toBe(true);
  expect(result.assistance.outcome).toBe("prompted");
  expect(result.assistance.abstained).toBe(false);
});
it("represents demonstrated content after answer-giving separately from supported unclear assistance", () => {
  const prompted = normalizeAssessment(
    body(content, {
      ...unclear,
      choice: "prompted",
      confidence: 1,
      probabilities: { independent: 0, prompted: 1, unclear: 0 },
    }),
    lesson,
  )!.results[key];
  expect(prompted.understanding.outcome).toBe("demonstrated");
  expect(prompted.assistance.outcome).toBe("prompted");
  const unsupported = normalizeAssessment(
    body(content, {
      ...unclear,
      choice: "unclear",
      confidence: 1,
      probabilities: { independent: 0, prompted: 0, unclear: 1 },
    }),
    lesson,
  )!.results[key];
  expect(unsupported.assistance.outcome).toBe("unclear");
  expect(unsupported.assistance.abstained).toBe(false);
});
it("keeps the original thresholds on either dimension", () => {
  const result = normalizeAssessment(
    body(
      { ...content, confidence: 0.89, probabilities: { demonstrated: 0.89, partial: 0.1, not_yet: 0.01 } },
      { ...unclear, confidence: 0.89, probabilities: { independent: 0.89, prompted: 0.1, unclear: 0.01 } },
    ),
    lesson,
  )!.results[key];
  expect(result.understanding.outcome).toBe("uncertain");
  expect(result.assistance.outcome).toBe("unclear");
});
it("defines neutral elaboration separately from relevant scaffolding and disallows tutor-only/echo understanding", () => {
  const questions = assessmentQuestions(lesson);
  expect(Object.keys(questions)).toEqual([`${key}:understanding`, `${key}:assistance`]);
  for (const question of Object.values(questions)) {
    expect(question.type).toBe("choice");
    expect(question.instructions).toContain("neutral request to elaborate, clarify meaning or give an example");
    expect(question.instructions).toContain("Tutor-only content, assent, simple echoes");
    expect(question.instructions).toContain("leading answer or a reasoning step before the learner explains it");
  }
  expect(questions[`${key}:assistance`].instructions).toContain("cannot establish independent understanding");
});
it("migrates old answers and old normalized responses once, retaining raw scores and uncertain attribution", () => {
  const assessment = normalizeAssessment({ answers: { [key]: legacyScores } }, lesson)!;
  expect(assessment.version).toBe(ASSESSMENT_VERSION);
  expect(assessment.results[key].sourceContract).toBe("legacy-v1");
  expect(assessment.results[key].understanding.outcome).toBe("demonstrated");
  expect(assessment.results[key].assistance.outcome).toBe("unclear");
  expect(assessment.results[key].legacyScores?.confidence).toBe(0.52);
  expect(assessment.results[key].understanding.scores.confidence).toBe(0.52);
  expect(assessment.results[key].legacyScores?.probabilities).toEqual(legacyScores.probabilities);
  expect(parseAssessment(assessment, lesson)).toEqual(assessment);
  expect(
    parseAssessment(
      {
        status: "complete",
        results: {
          [key]: {
            nodeId: "engram",
            criterionId: lesson.nodes.engram.concepts[0].id,
            outcome: "uncertain",
            scores: legacyScores,
          },
        },
      },
      lesson,
    ),
  ).toEqual(assessment);
  expect(
    normalizeAssessment({ version: "conversation-assessment-v1", answers: { [key]: legacyScores } }, lesson),
  ).toEqual(assessment);
});
it("does not invent assistance from legacy partial/absent evidence or condition probabilities to inflate attribution", () => {
  const legacy = {
    ...legacyScores,
    choice: "partial",
    confidence: 0.99,
    probabilities: { not_yet: 0, partial: 0.99, demonstrated_independent: 0.01, demonstrated_prompted: 0 },
  };
  const result = normalizeAssessment({ answers: { [key]: legacy } }, lesson)!.results[key];
  expect(result.understanding.outcome).toBe("partial");
  expect(result.assistance.outcome).toBe("unclear");
  const uncertain = normalizeAssessment(
    {
      answers: {
        [key]: {
          ...legacyScores,
          confidence: 0.55,
          probabilities: { not_yet: 0, partial: 0.1, demonstrated_independent: 0.55, demonstrated_prompted: 0.35 },
        },
      },
    },
    lesson,
  )!.results[key];
  expect(uncertain.understanding.outcome).toBe("demonstrated");
  expect(uncertain.assistance.outcome).toBe("unclear");
});
it("recomputes supplied judgments without accepting retrospective evidence fields", () => {
  const assessment = normalizeAssessment(body(), lesson)!;
  const tampered = structuredClone(assessment);
  tampered.results[key].assistance.outcome = "independent";
  tampered.results[key].assistance.abstained = false;
  expect(
    parseAssessment(
      {
        ...tampered,
        results: { [key]: { ...tampered.results[key], childTranscript: "Invented quote", childMessageIndex: 0 } },
      },
      lesson,
    ),
  ).toEqual(assessment);
});
it.each([
  null,
  {},
  { version: "unknown", answers: {} },
  { ...body(), answers: { [`${key}:understanding`]: content } },
  { ...body(), answers: { ...body().answers, unexpected: content } },
  body({ ...content, probabilities: { demonstrated: 1.1, partial: 0, not_yet: 0 } }),
  body({ ...content, confidence: NaN }),
  body({ ...content, choice: "partial" }),
  body({ ...content, probabilities: { demonstrated: 0.6, partial: 0.03, not_yet: 0.01 } }),
  { version: ASSESSMENT_VERSION, answers: { [key]: legacyScores } },
  { answers: body().answers },
  { answers: { [key]: { ...legacyScores, confidence: -1 } } },
])("explicitly rejects malformed, mixed or unknown provider contracts: %j", value => {
  expect(normalizeAssessment(value, lesson)).toBeNull();
});
it.each([
  null,
  { status: "unavailable", results: {} },
  { status: "pending", results: {} },
  { version: "unknown", status: "complete", results: {} },
  { version: ASSESSMENT_VERSION, status: "complete", results: { [key]: { sourceContract: "legacy-v1" } } },
])("rejects unavailable or malformed normalized contracts: %j", value => {
  expect(parseAssessment(value, lesson)).toBeNull();
});

it("rejects normalized mixed source contracts and incorrect identities even when legacy keys are complete", () => {
  const legacy = normalizeAssessment({ answers: { [key]: legacyScores } }, lesson)!;
  const current = normalizeAssessment(body(), lesson)!;
  expect(
    parseAssessment(
      {
        ...legacy,
        results: {
          ...legacy.results,
          "engram:extra": { ...current.results[key], nodeId: "engram", criterionId: "extra" },
        },
      },
      lesson,
    ),
  ).toBeNull();
  expect(
    parseAssessment({ ...current, results: { [key]: { ...current.results[key], nodeId: "wrong" } } }, lesson),
  ).toBeNull();
});
