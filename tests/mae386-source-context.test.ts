import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/assess/route";
import { JEV_MODEL } from "../lib/jev";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { teachingInstruction } from "../lib/lesson-runtime/live-context";
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
