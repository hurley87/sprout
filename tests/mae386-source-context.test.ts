import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/assess/route";
import { JEV_MODEL } from "../lib/jev";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { createLiveSessionConfig, teachingInstruction } from "../lib/lesson-runtime/live-context";
import { assessmentQuestions } from "../lib/lesson-runtime/conversation-assessment";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";

const sourcedUnits = MAE386_RUBRICS.flatMap(question => question.units).filter(unit => unit.visibleSource);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("MAE386 review fixes: source context and optional reasoning", () => {
  it.each(sourcedUnits)(
    "includes $id source data in the actual tutor steering text, without sibling sources or answers",
    unit => {
      const message = teachingInstruction(currentNodeContext(MAE386_LESSON, unit.id), MAE386_LESSON);
      expect(message).toContain(unit.visibleSource);
      expect(message).not.toContain(unit.referenceAnswer);
      for (const sibling of sourcedUnits.filter(sibling => sibling.id !== unit.id)) {
        expect(message).not.toContain(sibling.visibleSource);
      }
    },
  );

  it("sends self-contained Q10 grading context when the learner answers from the screen without tutor quotation", async () => {
    const visits = [
      {
        nodeId: "q10-3",
        visitId: 1,
        transcript: "Child: His toolkit comprises the habits, heuristics, and external scaffolds he builds to think.",
      },
    ];
    const questions = assessmentQuestions(MAE386_LESSON);
    // Synthetic response tests transport/schema only, not provider semantic accuracy.
    const answers = Object.fromEntries(
      Object.keys(questions).map(id => [
        id,
        {
          type: "choice",
          choice: "not_yet",
          confidence: 1,
          probabilities: { not_yet: 1, partial: 0, demonstrated_independent: 0, demonstrated_prompted: 0 },
        },
      ]),
    );
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ model: JEV_MODEL, answers }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/assess", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: MAE386_LESSON.id, visits }),
      }),
    );
    expect(response.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(sent.state.conversation).toEqual(visits);
    for (const unit of sourcedUnits.filter(unit => unit.id.startsWith("q10-"))) {
      const live = conversationStateQuestions(MAE386_LESSON, unit.id);
      expect(JSON.stringify(visits)).not.toContain(unit.visibleSource);
      for (const criterion of unit.criteria) {
        const instructions = sent.questions[`${unit.id}:${criterion.id}`].instructions;
        expect(instructions).toContain(unit.visibleSource);
        expect(instructions).toContain(unit.id);
        expect(instructions).toContain("latest complete, non-withdrawn");
        expect(live[`concept_${criterion.id}`].instructions).toContain(unit.visibleSource);
      }
    }
  });

  it("accepts a complete Q15 utility argument without the optional evidence-and-limits dimension", () => {
    const unit = MAE386_RUBRICS.find(question => question.id === "q15")!.units[0];
    expect(unit.criteria.find(criterion => criterion.id === "evidence-and-limits")).toHaveProperty("optional", true);
    expect(MAE386_LESSON.nodes.q15.concepts?.map(criterion => criterion.id)).toEqual([
      "incomplete-not-worthless",
      "substantive-use",
    ]);
    expect(assessmentQuestions(MAE386_LESSON)).not.toHaveProperty("q15:evidence-and-limits");
    expect(conversationStateQuestions(MAE386_LESSON, "q15")).not.toHaveProperty("concept_evidence-and-limits");
    const sample = unit.examples.find(sample => sample.name === "predictive-utility-without-limits")!;
    expect(sample).toMatchObject({
      category: "complete",
      expected: {
        "incomplete-not-worthless": "independent",
        "substantive-use": "independent",
        "evidence-and-limits": "missing",
      },
    });
    const message = teachingInstruction(currentNodeContext(MAE386_LESSON, "q15"), MAE386_LESSON);
    expect(message).toContain("Optional strengths");
    expect(message).toContain("never required for a complete answer");
  });
});

// Instruction delivery regressions only: no mocked response establishes live speech quality.
describe("Q10 spoken meaning feedback", () => {
  const cases = [
    ["q10-1", ["lateness", "oversleeping explains lateness"]],
    ["q10-2", ["joint work", "same project", "Worked alone"]],
    [
      "q10-3",
      [
        "toolkit composition",
        "habits",
        "heuristics",
        "external scaffolds",
        "building them to think",
        "Use alone omits",
      ],
    ],
  ] as const;
  it.each(cases)("%s delivers sentence relations and a meaning-before-praise guard", (id, anchors) => {
    const message = teachingInstruction(currentNodeContext(MAE386_LESSON, id), MAE386_LESSON);
    for (const anchor of anchors) expect(message).toContain(anchor);
    expect(message).toContain("Compare retained/omitted meaning before praise");
    expect(message).toContain("If lost/unclear, name one gap or clarify");
    expect(message).toContain("shorter alone is insufficient");
    expect(message).toContain("Accept paraphrases");
    expect(message).toContain("Latest complete non-withdrawn");
    expect(message).toContain("never borrow earlier proposals, source echoes or tutor words");
    expect(message).toContain("no reference solution");
    expect(message).toContain("Private focus (do not recite as a checklist)");
    for (const unit of MAE386_RUBRICS.find(q => q.id === "q10")!.units) {
      for (const suffix of ["-complete", "-alternate", "-modest-valid-reduction"]) {
        const example = unit.examples.find(e => e.name === `${unit.id}${suffix}`)!;
        expect(message).not.toContain(example.turns[0].text);
      }
      if (unit.id !== id) expect(message).not.toContain(unit.tutor.preservation);
    }
  });
  it("keeps full criteria available if Q10 is the initial provider context", () => {
    const config = createLiveSessionConfig({ ...MAE386_LESSON, initialNodeId: "q10-3" });
    const initial = config.input[0].content[0].text;
    expect(initial).toContain("Retain all three categories, ownership and the building-for-thinking relationship");
    expect(initial).not.toContain("Two acceptable authored examples");
  });
});
