import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MAE386_LESSON, MAE386_QUESTION_GROUPS } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { MAE386_EXAM_SOURCE } from "../lib/lesson-runtime/mae386/exam-source";
import { MANUSCRIPT_PASSAGES } from "../lib/lesson-runtime/mae386/sources";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { assessmentQuestions } from "../lib/lesson-runtime/conversation-assessment";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";

const requiredQuestions = ["q1", "q6", "q8", "q10", "q5", "q12", "q14", "q15"];
const requiredNodes = [
  "q1",
  "q6",
  "q8",
  "q10-1",
  "q10-2",
  "q10-3",
  "q5-a",
  "q5-c",
  "q5-f",
  "q12",
  "q14",
  "q15",
  "recap",
];
const units = MAE386_RUBRICS.flatMap(question => question.units);

describe("MAE386 first-review content contract", () => {
  it("registers exactly the requested eight grouped questions and twelve discussion nodes, then recap", () => {
    expect(resolveLessonDefinition("mae386")).toBe(MAE386_LESSON);
    expect(MAE386_RUBRICS.map(question => question.id)).toEqual(requiredQuestions);
    expect(MAE386_QUESTION_GROUPS.map(question => question.questionId)).toEqual(requiredQuestions);
    expect(Object.keys(MAE386_LESSON.nodes)).toEqual(requiredNodes);
    const walked = [];
    let id = MAE386_LESSON.initialNodeId;
    for (;;) {
      walked.push(id);
      const edge = MAE386_LESSON.nodes[id].onSuccess;
      if (edge.kind === "complete") break;
      id = edge.nodeId;
      expect(walked).not.toContain(id);
    }
    expect(walked).toEqual(requiredNodes);
    expect(MAE386_LESSON.conversationFirst).toBe(true);
    expect(units.every(unit => MAE386_LESSON.nodes[unit.id].completionPolicy === "allow_unresolved")).toBe(true);
    expect(MAE386_LESSON.nodes.recap).toMatchObject({
      completeAfterTutorOutput: true,
      onSuccess: { kind: "complete" },
    });
  });

  it("keeps source-backed, inferred and argumentative criteria inspectable, with valid printed/PDF citations", () => {
    for (const question of MAE386_RUBRICS) {
      const source = MAE386_EXAM_SOURCE[question.id];
      expect(source.originalText).toContain(`Question ${source.number}`);
      expect(source.printedPages.length).toBeGreaterThan(0);
      for (const unit of question.units) {
        expect(unit.referenceAnswer.length).toBeGreaterThan(100);
        expect(unit.review.length).toBeGreaterThan(50);
        expect(unit.originalPart).toContain(`Q${source.number}`);
        expect(new Set(unit.criteria.map(criterion => criterion.id)).size).toBe(unit.criteria.length);
        for (const criterion of unit.criteria) {
          expect(["source-backed", "course-inference", "open-ended-argument"]).toContain(criterion.basis);
          expect(criterion.sources.length).toBeGreaterThan(0);
          for (const id of criterion.sources) {
            const passage = MANUSCRIPT_PASSAGES[id];
            expect(passage).toBeDefined();
            expect(passage.pdfPages).toEqual(passage.printedPages.map(page => page + 14));
          }
        }
      }
    }
    expect(MAE386_EXAM_SOURCE.q5.printedPages).toEqual([5, 6]);
    expect(MAE386_EXAM_SOURCE.q10.originalText).toContain("a captain in the Canadian Armed Forces");
    expect(MAE386_EXAM_SOURCE.q15.originalText).toContain("Science doesn’t have to fully explain");
    // This extraction retains the original's quotation glyph, not modernized editorial wording.
  });

  it("covers all five review categories for every independently evaluated case/sentence and labels each criterion", () => {
    const names = new Set<string>();
    for (const unit of units) {
      const ids = unit.criteria.map(criterion => criterion.id).sort();
      const categories = unit.examples.map(sample => sample.category);
      for (const category of ["complete", "partial", "incorrect", "ambiguous", "alternate"])
        expect(categories, unit.id).toContain(category);
      for (const sample of unit.examples) {
        expect(names.has(sample.name), sample.name).toBe(false);
        names.add(sample.name);
        expect(Object.keys(sample.expected).sort(), sample.name).toEqual(ids);
        expect(sample.rationale.length).toBeGreaterThan(20);
        for (const position of sample.evidenceTurns)
          expect(sample.turns[position - 1]?.speaker, sample.name).toBe("learner");
        if (["complete", "alternate"].includes(sample.category)) {
          expect(
            unit.criteria
              .filter(criterion => !criterion.optional)
              .every(criterion => sample.expected[criterion.id] === "independent"),
            sample.name,
          ).toBe(true);
          expect(sample.evidenceTurns.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("projects the same assessment descriptions to live and cumulative questions without exposing answer/exemplar payloads", () => {
    const cumulative = assessmentQuestions(MAE386_LESSON);
    for (const unit of units) {
      const live = conversationStateQuestions(MAE386_LESSON, unit.id);
      const context = currentNodeContext(MAE386_LESSON, unit.id);
      const presentation = JSON.stringify(context.scene);
      expect(context).not.toHaveProperty("onSuccess");
      expect(presentation).not.toContain(unit.referenceAnswer);
      expect(presentation).not.toContain("referenceAnswer");
      expect(presentation).not.toContain("examples");
      for (const sample of unit.examples) expect(presentation).not.toContain(sample.name);
      for (const criterion of unit.criteria) {
        if (criterion.optional) {
          expect(MAE386_LESSON.nodes[unit.id].concepts?.some(item => item.id === criterion.id)).toBe(false);
          expect(cumulative).not.toHaveProperty(`${unit.id}:${criterion.id}`);
          expect(live).not.toHaveProperty(`concept_${criterion.id}`);
          continue;
        }
        const target = MAE386_LESSON.nodes[unit.id].concepts!.find(item => item.id === criterion.id)!;
        expect(target.description).toContain(criterion.description);
        expect(cumulative[`${unit.id}:${criterion.id}`].instructions).toContain(criterion.description);
        expect(live[`concept_${criterion.id}`].instructions).toContain(criterion.description);
      }
    }
  });

  it("authors the special evidence boundaries rather than forcing a fixed philosophical or historical answer", () => {
    expect(units.find(unit => unit.id === "q6")?.criteria).toHaveLength(4);
    expect(units.find(unit => unit.id === "q12")?.criteria).toHaveLength(5);
    expect(MANUSCRIPT_PASSAGES.phonetic.printedPages).toEqual([111, 112]);
    for (const unit of units.filter(unit => unit.id.startsWith("q10-"))) {
      expect(MAE386_EXAM_SOURCE.q10.originalText).toContain(unit.visibleSource);
      const samples = Object.fromEntries(unit.examples.map(sample => [sample.name, sample]));
      expect(samples[`${unit.id}-worse-replacement`].expected.meaning).toBe("incorrect");
      expect(samples[`${unit.id}-withdrawn`].expected.meaning).toBe("unresolved");
      expect(samples[`${unit.id}-casual-aside`].evidenceTurns).toEqual([1]);
      expect(samples[`${unit.id}-self-correction`].evidenceTurns).toEqual([2]);
      expect(samples[`${unit.id}-segmented-correction`].evidenceTurns).toEqual([2, 4]);
      expect(samples[`${unit.id}-modest-valid-reduction`].expected.concise).toBe("independent");
      expect(samples[`${unit.id}-help-and-own-revision`].expected.meaning).toBe("assisted");
      expect(samples[`${unit.id}-unchanged-echo`].evidenceTurns).toEqual([]);
      expect(
        unit.examples.filter(sample => ["complete", "alternate"].includes(sample.category)).length,
      ).toBeGreaterThanOrEqual(2);
    }
    for (const unit of units.filter(unit => unit.id.startsWith("q5-"))) {
      expect(unit.examples.find(sample => sample.category === "alternate")?.expected["case-reasoning"]).toBe(
        "independent",
      );
      expect(unit.review).toContain("rovisional");
    }
    const q14 = units.find(unit => unit.id === "q14")!;
    expect(
      q14.examples.find(sample => sample.name === "two-examples-one-reason")?.expected["second-distinct-argument"],
    ).toBe("partial");
    expect(
      q14.examples.find(sample => sample.name === "literacy-is-intelligence")?.expected["no-innate-inferiority"],
    ).toBe("incorrect");
    expect(
      units
        .find(unit => unit.id === "q15")!
        .examples.filter(sample => ["complete", "alternate"].includes(sample.category)),
    ).toHaveLength(5);
  });

  it("keeps the human-readable bundle synchronized with its typed authoring source", () => {
    execFileSync(process.execPath, ["scripts/render-mae386-rubrics.mjs", "--check"]);
    const review = readFileSync("docs/issue-76-rubric-review.md", "utf8");
    for (const unit of units) expect(review).toContain(unit.referenceAnswer);
  });
});
