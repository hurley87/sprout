import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { TEST_CONCEPT_LESSON } from "./fixtures/concept-lesson";

const probabilities = <T extends string>(labels: readonly T[], choice: T, confidence = 0.97) =>
  Object.fromEntries(labels.map(label => [label, label === choice ? confidence : (1 - confidence) / (labels.length - 1)])) as Record<T, number>;

const objectiveLabels = ["completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"] as const;
const tutorLabels = ["confirmed_completion", "clarifying", "helping", "asking", "other"] as const;
const conceptLabels = ["not_yet", "partial", "demonstrated_independent", "demonstrated_prompted"] as const;

function diagnostic(decision: ReturnType<typeof mapConversationObservation>) {
  return {
    classifierVersion: CLASSIFIER_VERSION,
    decision: decision.status,
    outcome: decision.outcome,
    ...(decision.reason ? { reason: decision.reason } : {}),
    outputs: decision.outputs,
    labelCompletionEligible: decision.labelCompletionEligible,
    thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
    nodeId: "concept-a",
    transcriptRevision: 4,
    elapsedMs: 12,
  };
}

function conceptOutputs(
  objective: ConversationStateOutputs["objectiveState"] = {
    choice: "completed",
    confidence: 0.45,
    probabilities: { completed: 0.45, incorrect: 0.1, unclear_or_incomplete: 0.25, unresolved_help: 0.1, no_attempt: 0.1 },
  },
  tutor: ConversationStateOutputs["tutorState"] = {
    choice: "other",
    confidence: 0.5,
    probabilities: { confirmed_completion: 0.1, clarifying: 0.1, helping: 0.1, asking: 0.2, other: 0.5 },
  },
  concept: "demonstrated_independent" | "partial" = "demonstrated_independent",
): ConversationStateOutputs {
  return {
    objectiveState: objective,
    tutorState: tutor,
    concepts: {
      concept_repetition: {
        choice: concept,
        confidence: concept === "demonstrated_independent" ? 0.97 : 0.45,
        probabilities: concept === "demonstrated_independent"
          ? probabilities(conceptLabels, concept)
          : { not_yet: 0.2, partial: 0.45, demonstrated_independent: 0.2, demonstrated_prompted: 0.15 },
      },
    },
  };
}

const input = {
  lesson: TEST_CONCEPT_LESSON,
  nodeId: "concept-a",
  transcriptRevision: 4,
  transcript: "Tutor: What repeats?\nChild: The same shape comes back again.",
};

describe("live concept classification diagnostics", () => {
  it("round-trips a concept-only independent reveal with an uncertain global summary", () => {
    const decision = mapConversationObservation(input, conceptOutputs());
    expect(decision).toMatchObject({ status: "accepted", outcome: "hold_scene", labelCompletionEligible: false });
    expect(decision.proposal?.conceptObservations).toEqual([
      { criterionId: "repetition", observation: "demonstrated_independent" },
    ]);
    const value = diagnostic(decision);
    expect(value.outputs).toHaveProperty("concepts.concept_repetition");
    expect(parseLiveClassificationDiagnostic(value, TEST_CONCEPT_LESSON, "concept-a")).toEqual(value);
  });

  it("round-trips confident concept evidence alongside global completion", () => {
    const objective = {
      choice: "completed" as const,
      confidence: 0.97,
      probabilities: probabilities(objectiveLabels, "completed"),
    };
    const tutor = {
      choice: "confirmed_completion" as const,
      confidence: 0.97,
      probabilities: probabilities(tutorLabels, "confirmed_completion"),
    };
    const decision = mapConversationObservation(input, conceptOutputs(objective, tutor));
    expect(decision).toMatchObject({ status: "accepted", outcome: "allow_semantic_completion_evidence", labelCompletionEligible: true });
    expect(parseLiveClassificationDiagnostic(diagnostic(decision), TEST_CONCEPT_LESSON, "concept-a")).toEqual(diagnostic(decision));
  });

  it("round-trips all-concept abstention and its closed reason", () => {
    const decision = mapConversationObservation(input, conceptOutputs(undefined, undefined, "partial"));
    expect(decision).toMatchObject({ status: "abstained", outcome: "unresolved", reason: "no_confident_concept_observation" });
    expect(parseLiveClassificationDiagnostic(diagnostic(decision), TEST_CONCEPT_LESSON, "concept-a")).toEqual(diagnostic(decision));
  });

  it("rejects unauthored concept keys, malformed observations, and a mismatched current node", () => {
    const decision = mapConversationObservation(input, conceptOutputs());
    const value = diagnostic(decision);
    expect(parseLiveClassificationDiagnostic({
      ...value,
      outputs: { ...value.outputs, concepts: { ...value.outputs?.concepts, concept_unknown: value.outputs?.concepts?.concept_repetition } },
    }, TEST_CONCEPT_LESSON, "concept-a")).toBeNull();
    expect(parseLiveClassificationDiagnostic({
      ...value,
      outputs: { ...value.outputs, concepts: { concept_repetition: { ...value.outputs?.concepts?.concept_repetition, choice: "mastered" } } },
    }, TEST_CONCEPT_LESSON, "concept-a")).toBeNull();
    expect(parseLiveClassificationDiagnostic(value, TEST_CONCEPT_LESSON, "concept-b")).toBeNull();
    expect(parseLiveClassificationDiagnostic(value)).toBeNull();
  });

  it("preserves legacy counting diagnostic parsing", () => {
    const countingInput = {
      lesson: COUNTING_LESSON,
      nodeId: "count-1-duck",
      transcriptRevision: 2,
      transcript: "Tutor: How many ducks?\nChild: One.",
    };
    const objective = {
      choice: "completed" as const,
      confidence: 0.97,
      probabilities: probabilities(objectiveLabels, "completed"),
    };
    const tutor = {
      choice: "confirmed_completion" as const,
      confidence: 0.97,
      probabilities: probabilities(tutorLabels, "confirmed_completion"),
    };
    const decision = mapConversationObservation(countingInput, { objectiveState: objective, tutorState: tutor });
    const value = { ...diagnostic(decision), nodeId: countingInput.nodeId };
    expect(parseLiveClassificationDiagnostic(value)).toEqual(value);
    expect(parseLiveClassificationDiagnostic(value, COUNTING_LESSON, countingInput.nodeId)).toEqual(value);
  });
});
