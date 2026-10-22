import { afterEach, expect, it, vi } from "vitest";
import captured from "./fixtures/mae386-q6-2026-10-22.json";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { learnerSourceBlocks } from "../lib/lesson-runtime/mae386/source-block";
import {
  conversationStateQuestions,
  normalizeConversationOutputs,
  mapConversationObservation,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  CLASSIFIER_VERSION,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { createReducerHarness } from "./helpers/runtime-harness";
import { runtimeSource, classificationSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { freezeQuestionOutcomes } from "../lib/lesson-runtime/mae386/question-outcomes";
import { JEV_MODEL } from "../lib/jev";

const input = {
  lesson,
  nodeId: "q6",
  transcriptRevision: captured.transcriptRevision,
  transcript: captured.transcript,
};
function choice(options: readonly string[], selected: string, probability = 1) {
  return {
    type: "choice",
    choice: selected,
    confidence: probability,
    probabilities: Object.fromEntries(
      options.map(id => [id, id === selected ? probability : (1 - probability) / (options.length - 1)]),
    ),
  };
}
function response(closure = "closed", probability = 1, text = input.transcript) {
  const questions = conversationStateQuestions(lesson, "q6", text);
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, question]) => {
        if (id === "objectiveState" || id === "tutorState")
          return [id, { type: "choice", ...captured.recordedOutputs[id] }];
        if (id.startsWith("concept_"))
          return [
            id,
            {
              type: "choice",
              ...captured.recordedOutputs.concepts[id as keyof typeof captured.recordedOutputs.concepts],
            },
          ];
        return [
          id,
          choice(
            Object.keys(question.criteria),
            id === "discussionClosure" ? closure : Object.keys(question.criteria)[1],
            id === "discussionClosure" ? probability : 1,
          ),
        ];
      }),
    ),
  };
}
function mapped(body = response(), text = input.transcript) {
  return mapConversationObservation(
    { ...input, transcript: text },
    normalizeConversationOutputs(body, lesson, "q6", text)!,
  );
}
function apply(result: ReturnType<typeof mapped>) {
  const h = createReducerHarness("q6-regression", { lesson: { ...lesson, initialNodeId: "q6" }, quietDrainMs: 100 });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: input.transcriptRevision - 1,
    transcriptSnapshot: input.transcript,
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "tutor",
    revision: input.transcriptRevision,
    transcriptSnapshot: input.transcript,
  });
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    proposal: result.proposal!,
    transcriptSnapshot: input.transcript,
  });
  return h;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("retains the original complete explanation despite later feedback and clarification", () => {
  const blocks = learnerSourceBlocks(input.transcript);
  expect(blocks[0]).toMatchObject({ id: "span_1_9", start: 1, end: 9 });
  expect(blocks).toHaveLength(2);
  expect(blocks[0].messages.filter(m => m.speaker === "Tutor").map(m => m.text)).toEqual([
    "Mm-hmm.",
    "Yeah.",
    "Mm-hmm.",
    "Go on.",
  ]);
  expect(blocks[1].start).toBeGreaterThan(9);
  expect(
    conversationStateQuestions(lesson, "q6", input.transcript)["sourceSpan_system2-example"].criteria,
  ).toHaveProperty("span_1_9");
});

it("route boundary accepts new MOCKED selections with recorded semantics, retaining four criteria and advancing after audio drains", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "fixture-only");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response())),
  );
  const result = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
  expect(result.outputs?.concepts).toEqual(captured.recordedOutputs.concepts);
  expect(result.proposal?.tutorState).toBe("acknowledging");
  const h = apply(result);
  expect(Object.values(h.state.conceptEvidence)).toHaveLength(4);
  for (const record of Object.values(h.state.conceptEvidence)) {
    expect(record.understanding).toBe("independent");
    expect(record.source).toMatchObject({
      childMessageIndex: 1,
      childMessageEndIndex: 9,
      transcriptRevision: 331,
      childTurnId: null,
    });
  }
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("q6");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
  expect(h.state.nodeId).toBe("q8");
  h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: h.state.pendingRender!.identity });
  expect(h.state.navigationHistory?.at(-1)?.intent).toBe("tutor_closure");
  expect(freezeQuestionOutcomes(lesson, h.state).questions.find(q => q.questionId === "q6")?.outcome).toBe(
    "independent",
  );
  expect(
    parseLiveClassificationDiagnostic(
      {
        classifierVersion: CLASSIFIER_VERSION,
        decision: result.status,
        outcome: result.outcome,
        outputs: result.outputs,
        labelCompletionEligible: result.labelCompletionEligible,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId: "q6",
        transcriptRevision: 331,
        elapsedMs: 1,
      },
      lesson,
      "q6",
      input.transcript,
    ),
  ).toBeTruthy();
});

it.each([
  ["open", 1],
  ["closed", 0.85],
] as const)("%s closure at %s does not advance even with confident legacy tutor completion", (closure, probability) => {
  const body = response(closure, probability);
  body.answers.tutorState = choice(Object.keys(body.answers.tutorState.probabilities), "confirmed_completion");
  const result = mapped(body);
  expect(result.outcome).toBe("hold_scene");
  expect(result.proposal?.tutorState).not.toBe("acknowledging");
  const h = apply(result);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("q6");
});

it("closure can advance an unresolved discussion without granting mastery", () => {
  const body = response();
  for (const [id, answer] of Object.entries(body.answers)) {
    if (id.startsWith("sourceSpan_")) body.answers[id] = choice(Object.keys(answer.probabilities), "none");
    if (id.startsWith("concept_")) body.answers[id] = choice(Object.keys(answer.probabilities), "not_yet");
  }
  const result = mapped(body);
  expect(result.outcome).toBe("allow_semantic_completion_evidence");
  const h = apply(result);
  expect(Object.values(h.state.conceptEvidence).every(e => e.status !== "demonstrated")).toBe(true);
});

it("historical captured scores retain partial evidence and uncertain closure", () => {
  const result = mapConversationObservation(
    input,
    captured.recordedOutputs as unknown as NonNullable<ReturnType<typeof normalizeConversationOutputs>>,
  );
  expect(result.outcome).toBe("hold_scene");
  expect(result.proposal?.conceptObservations?.filter(o => o.childMessageIndex !== null)).toHaveLength(1);
});

it("blocks never bridge answer-giving, including feedback followed by a learner echo", () => {
  const text =
    "Child: Fast thought is\nTutor: Okay.\nChild: automatic.\nTutor: System two is deliberate analysis.\nChild: System two is deliberate analysis.";
  const blocks = learnerSourceBlocks(text);
  expect(blocks.map(b => [b.start, b.end])).toEqual([
    [0, 2],
    [4, 4],
  ]);
  expect(blocks[0].messages.map(m => m.text)).not.toContain("System two is deliberate analysis.");
});

it("fresh Q6 requests reject missing closure and forged blocks instead of silently using historical mapping", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "fixture-only");
  const body = response();
  delete body.answers.discussionClosure;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
  expect(await classifyConversationStateWithDiagnostics(input, new AbortController().signal)).toMatchObject({
    status: "abstained",
    reason: "provider_unreadable",
  });
  const forged = response();
  forged.answers["sourceSpan_system2-example"] = choice(["none", "span_1_11"], "span_1_11");
  expect(normalizeConversationOutputs(forged, lesson, "q6", input.transcript)).toBeNull();
  expect(normalizeConversationOutputs(response(), { ...lesson, id: "another" }, "q6", input.transcript)).toBeNull();
});
