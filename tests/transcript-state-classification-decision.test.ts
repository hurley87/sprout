import { describe, expect, it } from "vitest";
import {
  classificationDiagnostic,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  CONVERSATION_PROBABILITY_KEYS,
  mapConversationClassification,
  parseClassificationDiagnostic,
  type NormalizedConversationProbabilities,
} from "../lib/experiments/issue-57/legacy/classification-decision";
import { conversationProbabilities } from "./fixtures/conversation-classification";

const input = {
  nodeId: "count-3-butterflies" as const,
  transcriptRevision: 17,
  transcript: "Child: One, two. Three\nTutor: Yes, three butterflies!",
};
const expectedProposal = {
  nodeId: input.nodeId,
  transcriptRevision: input.transcriptRevision,
  childActivity: "unknown",
  answerOutcome: "correct",
  supportState: "none",
  tutorState: "acknowledging",
};

describe("explanatory Jev mapping", () => {
  it("accepts clean correct + acknowledging evidence with the same closed proposal", () => {
    const probabilities = conversationProbabilities();
    const decision = mapConversationClassification(input, probabilities);
    expect(decision).toEqual({ status: "accepted", proposal: expectedProposal, probabilities });
    expect(classificationDiagnostic(decision)).toEqual({
      decision: "accepted",
      probabilities,
      thresholds: { HIGH: 0.9, LOW: 0.1, COMPETITOR_CEILING: 0.2, MIN_MARGIN: 0.7 },
    });
  });

  it.each([
    {
      values: { answerCorrect: 0.899 },
      reason: "answer_no_winner",
      detail: { category: "answer", candidate: "answerCorrect", candidateProbability: 0.899 },
    },
    {
      values: { answerIncorrect: 0.201 },
      reason: "answer_competitor_too_high",
      detail: {
        category: "answer",
        winner: "answerCorrect",
        competitor: "answerIncorrect",
        violatedRules: ["COMPETITOR_CEILING"],
      },
    },
    {
      values: { answerCorrect: 0.9, answerIncorrect: 0.3 },
      reason: "answer_margin_too_small",
      detail: {
        category: "answer",
        winner: "answerCorrect",
        competitor: "answerIncorrect",
        violatedRules: ["COMPETITOR_CEILING", "MIN_MARGIN"],
      },
    },
    {
      values: { needsHelp: 0.5 },
      reason: "support_ambiguous",
      detail: { category: "support", candidate: "needsHelp", candidateProbability: 0.5 },
    },
    {
      values: { tutorAcknowledging: 0.4 },
      reason: "tutor_no_winner",
      detail: { category: "tutor", candidate: "tutorAcknowledging", candidateProbability: 0.4 },
    },
    {
      values: { tutorAsking: 0.201 },
      reason: "tutor_competitor_too_high",
      detail: {
        category: "tutor",
        winner: "tutorAcknowledging",
        competitor: "tutorAsking",
        violatedRules: ["COMPETITOR_CEILING"],
      },
    },
    {
      values: { tutorAcknowledging: 0.9, tutorAsking: 0.3 },
      reason: "tutor_margin_too_small",
      detail: {
        category: "tutor",
        winner: "tutorAcknowledging",
        competitor: "tutorAsking",
        violatedRules: ["COMPETITOR_CEILING", "MIN_MARGIN"],
      },
    },
    {
      values: { answerCorrect: 0.01, answerIncorrect: 0.98 },
      reason: "acknowledgment_without_correct_answer",
      detail: { category: "tutor", winner: "tutorAcknowledging" },
    },
  ] satisfies { values: Partial<NormalizedConversationProbabilities>; reason: string; detail: object }[])(
    "explains $reason without producing a proposal",
    ({ values, reason, detail }) => {
      const probabilities = conversationProbabilities(values);
      const decision = mapConversationClassification(input, probabilities);
      expect(decision).toMatchObject({ status: "abstained", reason, probabilities, detail });
      expect(decision).not.toHaveProperty("proposal");
      const diagnostic = classificationDiagnostic(decision);
      expect(diagnostic).toMatchObject({ decision: "abstained", reason, probabilities, detail });
      expect(parseClassificationDiagnostic(diagnostic)).toEqual(diagnostic);
      if (diagnostic.detail?.winner && diagnostic.detail.competitor) {
        expect(diagnostic.detail.winnerProbability).toBe(probabilities[diagnostic.detail.winner]);
        expect(diagnostic.detail.competitorProbability).toBe(probabilities[diagnostic.detail.competitor]);
        expect(diagnostic.detail.margin).toBe(
          probabilities[diagnostic.detail.winner] - probabilities[diagnostic.detail.competitor],
        );
      }
    },
  );

  it("keeps all four original bands and the tutor-unknown branch", () => {
    expect(CONVERSATION_CLASSIFICATION_THRESHOLDS).toEqual({
      HIGH: 0.9,
      LOW: 0.1,
      COMPETITOR_CEILING: 0.2,
      MIN_MARGIN: 0.7,
    });
    const decision = mapConversationClassification(
      input,
      conversationProbabilities({
        answerCorrect: 0.9,
        answerIncorrect: 0.2,
        needsHelp: 0.1,
        tutorAcknowledging: 0.1,
        tutorAsking: 0.1,
        tutorClarifying: 0.1,
        tutorHelping: 0.1,
      }),
    );
    expect(decision).toMatchObject({
      status: "accepted",
      proposal: { answerOutcome: "correct", supportState: "none", tutorState: "unknown" },
    });
  });

  it("matches the previous proposal-or-null mapper across winner, competitor and support boundaries", () => {
    const bands = [0, 0.1, 0.101, 0.2, 0.201, 0.3, 0.5, 0.899, 0.9, 0.95, 1];
    for (const winner of bands)
      for (const competitor of bands) {
        for (const values of [
          conversationProbabilities({ answerCorrect: winner, answerIncorrect: competitor }),
          conversationProbabilities({ tutorAcknowledging: winner, tutorAsking: competitor }),
          conversationProbabilities({ needsHelp: winner, tutorAcknowledging: competitor }),
        ]) {
          const decision = mapConversationClassification(input, values);
          expect(decision.status === "accepted" ? decision.proposal : null).toEqual(previousProposal(values));
        }
      }
  });

  it("projects only normalized probabilities, fixed thresholds and bounded mapping details", () => {
    const values = { ...conversationProbabilities({ answerIncorrect: 0.201 }), rawBody: "raw provider marker" };
    const diagnostic = classificationDiagnostic(mapConversationClassification(input, values));
    const parsed = parseClassificationDiagnostic({
      ...diagnostic,
      rawBody: "raw provider marker",
      credentials: "credential marker",
      nodeId: "count-1-duck",
      probabilities: { ...diagnostic.probabilities, rawBody: "raw provider marker" },
      thresholds: { ...diagnostic.thresholds, rawBody: "raw provider marker" },
      detail: { ...diagnostic.detail, rawBody: "raw provider marker" },
    });
    expect(parsed).toEqual(diagnostic);
    expect(Object.keys(parsed!.probabilities!)).toEqual([...CONVERSATION_PROBABILITY_KEYS]);
    expect(JSON.stringify(parsed)).not.toMatch(/raw provider marker|credential marker|rawBody|credentials|nodeId/);
  });

  it.each(["not a mapping reason", NaN, "raw provider marker"])("ignores malformed diagnostic data %s", bad => {
    const diagnostic = classificationDiagnostic(mapConversationClassification(input, conversationProbabilities()));
    expect(parseClassificationDiagnostic({ ...diagnostic, decision: "abstained", reason: bad })).toBeNull();
    expect(
      parseClassificationDiagnostic({
        ...diagnostic,
        probabilities: { ...diagnostic.probabilities, answerCorrect: bad },
      }),
    ).toBeNull();
  });
});

/** Frozen reference to the pre-diagnostics mapping; literal bands keep this regression oracle independent. */
function previousProposal(values: NormalizedConversationProbabilities) {
  const answer = {
    answerCorrect: "correct",
    answerIncorrect: "incorrect",
    answerUnclear: "unclear",
    answerNone: "none",
  } as const;
  const tutor = {
    tutorAcknowledging: "acknowledging",
    tutorAsking: "asking",
    tutorClarifying: "clarifying",
    tutorHelping: "helping",
  } as const;
  const select = (keys: (keyof NormalizedConversationProbabilities)[]) => {
    const winner = keys.find(key => values[key] >= 0.9);
    if (!winner || keys.some(key => key !== winner && (values[key] > 0.2 || values[winner] - values[key] < 0.7)))
      return null;
    return winner;
  };
  const answerKey = select(Object.keys(answer) as (keyof typeof answer)[]);
  const tutorKey = Object.keys(tutor).every(key => values[key as keyof typeof tutor] <= 0.1)
    ? "unknown"
    : select(Object.keys(tutor) as (keyof typeof tutor)[]);
  const supportState = values.needsHelp >= 0.9 ? "needs_help" : values.needsHelp <= 0.1 ? "none" : null;
  if (!answerKey || !tutorKey || !supportState || (tutorKey === "tutorAcknowledging" && answerKey !== "answerCorrect"))
    return null;
  return {
    ...expectedProposal,
    answerOutcome: answer[answerKey as keyof typeof answer],
    supportState,
    tutorState: tutorKey === "unknown" ? "unknown" : tutor[tutorKey as keyof typeof tutor],
  };
}
