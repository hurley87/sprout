import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  assessmentQuestions,
  normalizeAssessment,
  parseAssessment,
  ASSESSMENT_VERSION,
  type ConversationAssessment,
} from "../lib/lesson-runtime/conversation-assessment";
import { reviewReferences, reviewReferenceOptions, type ReviewSnapshot } from "../lib/lesson-runtime/review-evidence";
import {
  buildSessionSummary as projectSessionSummary,
  sessionSummaryInstruction,
} from "../lib/lesson-runtime/session-summary";
import {
  createLessonRuntime,
  type ConceptEvidenceRecord,
  type LessonRuntimeState,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { RecapPresentation } from "../components/catching-unicorns/recap-presentation";
import fixture from "./fixtures/catching-unicorns-session-feedback.json";

function buildSessionSummary(state: LessonRuntimeState, assessment: ConversationAssessment) {
  return projectSessionSummary(state, assessment, snapshot);
}

const key = "exogram:exogram-non-biological";
const snapshot: ReviewSnapshot = { runtimeId: fixture.runtimeId, generation: 1, visits: fixture.conversation };
const state = {
  ...createLessonRuntime(snapshot.runtimeId, { lesson }),
  conceptEvidence: fixture.acceptedEvidence as Record<string, ConceptEvidenceRecord>,
};
function answers(
  selected = ["visit_2_message_1", "visit_2_message_3"],
  content = "demonstrated",
  assistance = "unclear",
) {
  return Object.fromEntries(
    Object.entries(assessmentQuestions(lesson, snapshot)).map(([id, question]) => {
      const slot = /:evidence_(\d)$/.exec(id);
      const label = id.includes(":exogram-non-biological:")
        ? slot
          ? (selected[Number(slot[1])] ?? "none")
          : id.endsWith(":understanding")
            ? content
            : assistance
        : slot
          ? "none"
          : id.endsWith(":understanding")
            ? "not_yet"
            : "unclear";
      return [
        id,
        {
          type: "choice",
          choice: label,
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map(option => [option, option === label ? 1 : 0]),
          ),
        },
      ];
    }),
  );
}
function assess(selected?: string[], content?: string, assistance?: string) {
  return normalizeAssessment(
    { version: ASSESSMENT_VERSION, answers: answers(selected, content, assistance) },
    lesson,
    snapshot,
  )!;
}
function concept(summary = buildSessionSummary(state, assess())) {
  return summary.concepts.find(c => c.id === "exogram-non-biological")!;
}

it("grounds a later exogram clarification across exact separate learner replies, retaining the original live observation", () => {
  const before = JSON.stringify(state);
  const assessment = assess();
  expect(parseAssessment(assessment, lesson, snapshot)).toEqual(assessment);
  const summary = buildSessionSummary(state, assessment);
  const exogram = concept(summary);
  expect(exogram.evidence).toBe("recorded");
  expect(exogram.attribution).toBe("unclear");
  expect(exogram.records.find(r => r.key === key)).toMatchObject({
    reconciliation: "later-clarification",
    live: { status: "partial", tentative: true },
  });
  expect(exogram.records.find(r => r.key === key)!.reviewQuotes.map(q => q.text)).toEqual([
    "[breath ]So this is information stored external to the brain",
    "As an example, it could be say words written down on a page",
  ]);
  // Other confident review negatives still veto unrelated live strengths; no rubric result is hard-coded.
  expect(summary.strengths.some(s => s.conceptId === exogram.id)).toBe(true);
  expect(JSON.stringify(state)).toBe(before);
  const html = renderToStaticMarkup(createElement(RecapPresentation, { state, summary }));
  expect(html.match(/As an example, it could be say words written down on a page/g)).toHaveLength(1);
  expect(html).toContain("Review learner source");
  expect(html).toContain("message 3");
  expect(sessionSummaryInstruction(summary)).not.toContain("words written down on a page");
  expect(Buffer.byteLength(sessionSummaryInstruction(summary, true))).toBeLessThanOrEqual(2000);
});

it("permits a review-only strength with assistance uncertainty and no live quotation", () => {
  const summary = buildSessionSummary({ ...state, conceptEvidence: {} }, assess());
  expect(concept(summary).evidence).toBe("recorded");
  expect(concept(summary).records.find(r => r.key === key)?.reconciliation).toBe("review-only");
  expect(summary.strengths[0].text).toContain("prompting unclear");
  const independent = buildSessionSummary(
    { ...state, conceptEvidence: {} },
    assess(undefined, undefined, "independent"),
  );
  expect(independent.strengths[0].text).toContain("independent review evidence");
  expect(
    buildSessionSummary({ ...state, conceptEvidence: {} }, assess(undefined, undefined, "prompted")).strengths[0].text,
  ).toContain("with prompting");
});

it("cannot turn the specialists answer into demonstration merely by locating it", () => {
  const raw = answers();
  const ideaKey = "techno-literate-culture:idea-discoverers";
  const questions = assessmentQuestions(lesson, snapshot);
  const id = `${ideaKey}:evidence_0`;
  raw[id] = {
    type: "choice",
    choice: "visit_6_message_1",
    confidence: 1,
    probabilities: Object.fromEntries(
      Object.keys(questions[id].criteria).map(option => [option, option === "visit_6_message_1" ? 1 : 0]),
    ),
  };
  const review = normalizeAssessment({ version: ASSESSMENT_VERSION, answers: raw }, lesson, snapshot)!;
  const idea = buildSessionSummary(state, review).concepts.find(c => c.id === "idea-discoverers")!;
  expect(idea.evidence).toBe("unobserved");
  expect(idea.records[0].reviewQuotes[0].text).toContain("universities");
  expect(idea.records[0].live?.status).toBe("not_yet");
});

it.each(["visit_2_message_0", "visit_99_message_1", "visit_3_message_3", "overflow"])(
  "rejects tutor, invalid, filler or overflowing reference %s",
  reference => {
    expect(assess([reference])).toBeNull();
  },
);
it.each([
  { selected: ["visit_2_message_3", "visit_2_message_1"] },
  { selected: ["visit_2_message_1", "visit_2_message_1"] },
  { selected: ["none", "visit_2_message_3"] },
])("rejects duplicate/non-ordered/non-prefix references %j", ({ selected }) => {
  expect(assess(selected)).toBeNull();
});
it("excludes movement requests, assent and literal tutor echoes from candidate references", () => {
  expect(
    reviewReferences([
      {
        nodeId: "engram",
        visitId: 1,
        transcript:
          "Tutor: Memory inside the brain.\nChild: Memory inside the brain.\nTutor: Anything else?\nChild: Next question, then\nTutor: Okay\nChild: yes",
      },
    ]),
  ).toEqual([]);
});
it("fails explicitly above the candidate bound rather than truncating the saved conversation", () => {
  const large = {
    ...snapshot,
    visits: [
      {
        nodeId: "engram",
        visitId: 1,
        transcript: Array.from({ length: 65 }, (_, i) => `Tutor: Question ${i}\nChild: My explanation ${i}`).join("\n"),
      },
    ],
  };
  expect(reviewReferenceOptions(large)).toBeNull();
  expect(() => assessmentQuestions(lesson, large)).toThrow("capacity exceeded");
});
it("rejects foreign attempts, superseded generations and changed transcript snapshots", () => {
  const review = assess();
  for (const expected of [
    { ...snapshot, runtimeId: "foreign" },
    { ...snapshot, generation: 2 },
    { ...snapshot, visits: snapshot.visits.slice(1) },
  ]) {
    expect(parseAssessment(review, lesson, expected)).toBeNull();
  }
  expect(parseAssessment(review, lesson)).toBeNull();
  expect(concept(buildSessionSummary({ ...state, runtimeId: "foreign", conceptEvidence: {} }, review)).evidence).toBe(
    "unobserved",
  );
});
it("ignores supplied model quotes and recomputes claimed grounding and judgments", () => {
  const review = assess();
  const tampered = structuredClone(review);
  Object.assign(tampered.results[key], { quotes: ["FABRICATED"], childTranscript: "FABRICATED" });
  expect(parseAssessment(tampered, lesson, snapshot)).toEqual(review);
  tampered.results[key].evidence!.status = "missing";
  expect(parseAssessment(tampered, lesson, snapshot)).toEqual(review);
  tampered.results[key].evidence!.scores[0].probabilities = { none: 1 };
  expect(parseAssessment(tampered, lesson, snapshot)).toBeNull();
  expect(concept(buildSessionSummary({ ...state, conceptEvidence: {} }, tampered)).evidence).toBe("unobserved");
});
it("does not upgrade from uncertain, missing, legacy or earlier-only reference evidence", () => {
  expect(concept(buildSessionSummary(state, assess([]))).evidence).toBe("partial");
  const uncertain = answers();
  const id = `${key}:evidence_0`;
  uncertain[id].probabilities["visit_2_message_1"] = 0.6;
  uncertain[id].probabilities.none = 0.4;
  uncertain["compare:exogram-non-biological:evidence_0"] = structuredClone(uncertain[id]);
  const review = normalizeAssessment({ version: ASSESSMENT_VERSION, answers: uncertain }, lesson, snapshot)!;
  expect(review.results[key].evidence?.status).toBe("uncertain");
  expect(concept(buildSessionSummary(state, review)).evidence).toBe("partial");
  expect(concept(buildSessionSummary(state, assess(["visit_2_message_1"]))).evidence).toBe("disagreement");
  const legacy = normalizeAssessment({ answers: fixture.assessmentAnswers }, lesson)!;
  expect(concept(buildSessionSummary(state, legacy)).evidence).toBe("partial");
  const oldV2 = normalizeAssessment(
    {
      version: ASSESSMENT_VERSION,
      answers: Object.fromEntries(Object.entries(answers()).filter(([id]) => !id.includes(":evidence_"))),
    },
    lesson,
  )!;
  expect(concept(buildSessionSummary(state, oldV2)).evidence).toBe("partial");
});
it("retains supported confident contradictions despite later positive labels", () => {
  const current = {
    ...state,
    conceptEvidence: { ...state.conceptEvidence, [key]: { ...state.conceptEvidence[key], tentative: false } },
  };
  const summary = buildSessionSummary(current, assess());
  expect(concept(summary).evidence).toBe("disagreement");
  expect(concept(summary).records.find(r => r.key === key)?.reconciliation).toBe("conflict");
  expect(summary.strengths.some(s => s.conceptId === "exogram-non-biological")).toBe(false);
  const raw = answers();
  raw["compare:exogram-non-biological:understanding"].choice = "partial";
  raw["compare:exogram-non-biological:understanding"].probabilities = { demonstrated: 0, partial: 1, not_yet: 0 };
  const review = normalizeAssessment({ version: ASSESSMENT_VERSION, answers: raw }, lesson, snapshot)!;
  expect(concept(buildSessionSummary(state, review)).evidence).toBe("disagreement");
});

it("retains all four references and fails unavailable on an omitted locator question", () => {
  const ids = reviewReferences(snapshot.visits)
    .slice(0, 4)
    .map(ref => ref.id);
  const review = assess(ids);
  expect(review.results[key].evidence?.scores.map(score => score.choice)).toEqual(ids);
  expect(
    concept(buildSessionSummary({ ...state, conceptEvidence: {} }, review)).records.find(r => r.key === key)
      ?.reviewQuotes,
  ).toHaveLength(4);
  const incomplete = answers();
  delete incomplete[`${key}:evidence_3`];
  expect(normalizeAssessment({ version: ASSESSMENT_VERSION, answers: incomplete }, lesson, snapshot)).toBeNull();
});

it("requires independently supplied current snapshot ownership at the feedback projection boundary", () => {
  expect(projectSessionSummary({ ...state, conceptEvidence: {} }, assess()).strengths).toEqual([]);
  expect(
    projectSessionSummary({ ...state, conceptEvidence: {} }, assess(), { ...snapshot, generation: 2 }).strengths,
  ).toEqual([]);
});

it("uses a labeled synthetic reconciled scenario to prefer memory reasoning and a discovery extension", () => {
  // Synthetic rubric judgments, NOT a new interpretation of the recorded provider export.
  // Only the existing exogram references supply a review demonstration; other reviews abstain.
  const raw = answers();
  for (const [id, answer] of Object.entries(raw)) {
    if (id.endsWith(":understanding") && !id.includes(":exogram-non-biological:")) {
      answer.choice = "partial";
      answer.confidence = 0.5;
      answer.probabilities = { demonstrated: 0, partial: 0.5, not_yet: 0.5 };
    }
  }
  const assessment = normalizeAssessment({ version: ASSESSMENT_VERSION, answers: raw }, lesson, snapshot)!;
  const summary = buildSessionSummary(state, assessment);
  expect(summary.strengths.map(s => s.conceptId)).toEqual(["memory-extension", "exogram-durability"]);
  expect(summary.strengths[0].quote).toBe(
    state.conceptEvidence["why-exographics:memory-extension"].source!.childTranscript,
  );
  expect(concept(summary).evidence).toBe("recorded");
  expect(concept(summary).attribution).toBe("unclear");
  expect(summary.improvement.conceptId).toBe("discovery");
  expect(summary.improvement.text).toContain("extension opportunity");
  expect(summary.exercise).toContain("relationship easier to notice");
  expect(summary.exercise).toContain("why that helps reasoning");
  expect(summary.exercise).not.toContain("Einstein");
  expect(summary.exercise).not.toContain("exogram; contrast");
  const reordered = { ...state, conceptEvidence: Object.fromEntries(Object.entries(state.conceptEvidence).reverse()) };
  expect(buildSessionSummary(reordered, assessment)).toEqual(summary);
});
