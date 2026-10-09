import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { normalizeAssessment, parseConversationVisits } from "../lib/lesson-runtime/conversation-assessment";
import { createLessonRuntime, type ConceptEvidenceRecord } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { buildSessionSummary } from "../lib/lesson-runtime/session-summary";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import fixture from "./fixtures/catching-unicorns-session-feedback.json";

// Characterization of the saved session, not desired behavior or a pedagogical oracle.
// Later reconciliation/selection changes should intentionally update these expectations.
const evidence = fixture.acceptedEvidence as Record<string, ConceptEvidenceRecord>;
const state = { ...createLessonRuntime(fixture.runtimeId, { lesson }), conceptEvidence: evidence };
function assess() {
  const assessment = normalizeAssessment({ answers: fixture.assessmentAnswers }, lesson);
  expect(assessment).not.toBeNull();
  return assessment!;
}
function summarize() {
  return buildSessionSummary(state, assess());
}
function messages(nodeId: string) {
  return transcriptMessages(fixture.conversation.find(visit => visit.nodeId === nodeId)!.transcript)!;
}

describe("saved session feedback characterization", () => {
  it("retains valid ordered visits and attributable live quotes while changing only selected feedback", () => {
    expect(parseConversationVisits(fixture.conversation, lesson)).toEqual(fixture.conversation);
    expect(fixture.conversation.map(visit => visit.visitId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const record of Object.values(evidence)) {
      for (const source of [record.source, ...record.promptingHistory.map(entry => entry.source)]) {
        if (!source) continue;
        const visit = fixture.conversation.find(visit => visit.visitId === source.visitId)!;
        expect(source.runtimeId).toBe(state.runtimeId);
        expect(source.nodeId).toBe(visit.nodeId);
        expect(transcriptMessages(visit.transcript)![source.childMessageIndex]).toEqual({
          speaker: "Child",
          text: source.childTranscript,
        });
      }
    }
    const { strengths, improvement, exercise } = summarize();
    // Preserve the historical recap and provider distributions in the source fixture.
    expect(improvement).toEqual(fixture.recap.improvement);
    expect(strengths[1]).toEqual(fixture.recap.strengths[1]);
    expect(strengths[0].conceptId).toBe("memory-extension");
    expect(exercise).toContain("Identify where the information is kept");
    expect(exercise).toContain("Revisit your earlier explanation");
  });

  it("keeps the earlier partial exogram quote despite the saved clarification and chooses it for practice", () => {
    const conversation = messages("exogram");
    expect(conversation.map(message => message.speaker)).toEqual(["Tutor", "Child", "Tutor", "Child", "Tutor"]);
    expect(conversation[1].text).toContain("information stored external to the brain");
    expect(conversation[2].text).toContain("how that information is kept outside of you");
    expect(conversation[3].text).toBe("As an example, it could be say words written down on a page");
    const summary = summarize();
    const exogram = summary.concepts.find(concept => concept.id === "exogram-non-biological")!;
    expect(exogram.evidence).toBe("partial");
    expect(exogram.quote).toBe(conversation[1].text);
    expect(exogram.records.find(record => record.key === "exogram:exogram-non-biological")?.live?.status).toBe(
      "partial",
    );
    expect(summary.improvement.conceptId).toBe(exogram.id);
  });

  it("prioritizes recorded memory-extension reasoning over a basic definition", () => {
    const summary = summarize();
    const memory = summary.concepts.find(concept => concept.id === "memory-extension")!;
    expect(memory.evidence).toBe("recorded");
    expect(memory.attribution).toBe("independent");
    expect(memory.quote).toContain("middle steps that lead up to a final solution");
    expect(memory.quote).toContain("with pen and paper, I would be able to write those down");
    expect(memory.quote).toContain("without having to keep track of everything in my short term memory");
    expect(summary.strengths.map(strength => strength.conceptId)).toEqual(["memory-extension", "exogram-durability"]);
    expect(summary.concepts.filter(concept => concept.evidence === "recorded").map(concept => concept.id)).toEqual([
      "engram-biological",
      "exogram-durability",
      "memory-extension",
    ]);
    // Ranking changes selection, never the underlying accepted evidence.
    const withoutEarlierStrengths = buildSessionSummary(
      {
        ...state,
        conceptEvidence: { "why-exographics:memory-extension": evidence["why-exographics:memory-extension"] },
      },
      assess(),
    );
    expect(withoutEarlierStrengths.strengths.map(strength => strength.conceptId)).toEqual(["memory-extension"]);
  });

  it("retains the specialists answer alongside not_yet live evidence without declaring rubric satisfaction", () => {
    const answer = messages("techno-literate-culture")[1].text;
    expect(answer).toContain("people that specialize in in pursuing new ideas at the frontier");
    expect(answer).toContain("subjects like math or physics");
    expect(answer).toContain("universities");
    const concept = summarize().concepts.find(concept => concept.id === "idea-discoverers")!;
    expect(concept.records[0].live).toMatchObject({ status: "not_yet", source: null });
    expect(concept.records[0].review?.understanding.outcome).toBe("uncertain");
    expect(concept.evidence).toBe("unobserved");
    expect(concept.quote).toBeNull();
  });

  it("preserves synthesis conversation without upgrading missing live provenance after legacy content aggregation", () => {
    const conversation = messages("synthesis");
    expect(conversation[0].text).toContain("Choose a connection and explain why it follows");
    const learnerText = conversation
      .filter(message => message.speaker === "Child")
      .map(message => message.text)
      .join("\n");
    for (const phrase of [
      "using symbols to read and write",
      "frontier of new ideas",
      "concept of hierarchy",
      "titles to represent",
    ]) {
      expect(learnerText).toContain(phrase);
    }
    expect(
      conversation.some(
        message => message.speaker === "Tutor" && message.text.includes("symbolic systems can carry social structure"),
      ),
    ).toBe(true);
    const synthesis = summarize().concepts.filter(concept => concept.nodeId === "synthesis");
    expect(synthesis).toHaveLength(4);
    for (const concept of synthesis) {
      expect(concept.records[0].live).toBeUndefined();
      expect(concept.records[0].review?.understanding.outcome).toBe(
        concept.id === "synthesis-reasoning" ? "demonstrated" : "uncertain",
      );
      expect(concept.records[0].review?.assistance.outcome).toBe("unclear");
      expect(concept.evidence).toBe("unobserved");
    }
    // These are current diagnostics, not a claim that listing connections proves or disproves understanding.
  });

  it("aggregates legacy demonstration content while abstaining on its assistance attribution", () => {
    const assessment = assess();
    for (const [key, oldOutcome] of Object.entries(fixture.assessmentOutcomes)) {
      const result = assessment.results[key];
      expect(result.legacyScores).toEqual({
        choice: fixture.assessmentAnswers[key as keyof typeof fixture.assessmentAnswers].choice,
        confidence: fixture.assessmentAnswers[key as keyof typeof fixture.assessmentAnswers].confidence,
        probabilities: fixture.assessmentAnswers[key as keyof typeof fixture.assessmentAnswers].probabilities,
      });
      const aggregated = [
        "exogram:exogram-non-biological",
        "compare:exogram-non-biological",
        "compare:exogram-revisability",
        "exographics:visual-symbols",
        "exographics:cultural-agreement",
        "exographics:beyond-prose",
        "exographics:abstract-concepts",
        "why-exographics:memory-extension",
        "techno-literate-culture:social-coordination",
        "techno-literate-culture:education-system",
        "caf-application:caf-coordination-evidence",
        "synthesis:synthesis-reasoning",
      ].includes(key);
      expect(result.understanding.outcome).toBe(
        oldOutcome === "demonstrated_independent" || aggregated ? "demonstrated" : oldOutcome,
      );
      expect(result.assistance.outcome).toBe(oldOutcome === "demonstrated_independent" ? "independent" : "unclear");
    }
    for (const key of ["exogram:exogram-non-biological", "compare:exogram-non-biological"]) {
      const result = assessment.results[key];
      expect(result.legacyScores!.probabilities).toEqual({
        not_yet: 0,
        partial: 0.01,
        demonstrated_independent: 0.52,
        demonstrated_prompted: 0.47,
      });
      expect(result.understanding.scores.probabilities.demonstrated).toBeCloseTo(0.99);
      expect(result.understanding.outcome).toBe("demonstrated");
      expect(result.understanding.abstained).toBe(false);
      expect(result.assistance.outcome).toBe("unclear");
      expect(result.assistance.abstained).toBe(true);
    }
    // Content review still cannot upgrade the earlier partial live record or invent a quotation.
    expect(summarize().concepts.find(concept => concept.id === "exogram-non-biological")?.evidence).toBe("partial");
    expect(summarize().concepts.find(concept => concept.id === "exogram-non-biological")?.reviewUncertain).toBe(false);
  });
});
