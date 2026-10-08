import { afterEach, expect, it, vi } from "vitest";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { conversationObserverState } from "../lib/lesson-runtime/conversation-observer-contract";
import { createLiveSessionConfig } from "../lib/lesson-runtime/live-context";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { TEST_PATTERN_LESSON } from "./fixtures/test-lesson";
import { JEV_MODEL } from "../lib/jev";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses a non-counting definition for runtime, current-node model context, and mocked session/classifier transport", async () => {
  const lesson = TEST_PATTERN_LESSON;
  const runtime = createLessonRuntime("pattern-attempt", { lesson });
  expect(runtime).toMatchObject({ lessonId: lesson.id, nodeId: "pattern-a" });
  expect(currentNodeContext(lesson, runtime.nodeId)).toMatchObject({
    nodeId: "pattern-a",
    scene: { id: "pattern-card", symbol: "circle", sequenceLength: 4 },
  });
  expect(JSON.stringify(currentNodeContext(lesson, runtime.nodeId))).not.toContain("pattern-b");
  expect(createLiveSessionConfig(lesson).instructions).toContain("patient pattern tutor");

  const source = classificationSource({ ...runtime, hasChildTranscript: true })!;
  const request = {
    lesson,
    nodeId: source.nodeId,
    transcriptRevision: source.transcriptRevision,
    transcript: "Tutor: What repeats?\nChild: The circle.",
  };
  const state = conversationObserverState(request);
  expect(state).toMatchObject({
    nodeId: "pattern-a",
    scene: { symbol: "circle", sequenceLength: 4 },
    learningObjective: lesson.nodes["pattern-a"].learningObjective,
  });
  expect(state).not.toHaveProperty("onSuccess");

  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn<typeof globalThis.fetch>(async (...args) => {
    void args;
    return Response.json({
      model: JEV_MODEL,
      answers: {
        objectiveState: { type: "choice", choice: "completed", confidence: 0.99, probabilities: { completed: 0.99, incorrect: 0.0025, unclear_or_incomplete: 0.0025, unresolved_help: 0.0025, no_attempt: 0.0025 } },
        tutorState: { type: "choice", choice: "confirmed_completion", confidence: 0.99, probabilities: { confirmed_completion: 0.99, clarifying: 0.0025, helping: 0.0025, asking: 0.0025, other: 0.0025 } },
      },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const decision = await classifyConversationStateWithDiagnostics(request, new AbortController().signal);
  expect(fetch).toHaveBeenCalledOnce();
  const wire = JSON.parse(fetch.mock.calls[0][1]?.body as string);
  expect(wire.state).toEqual(state);
  expect(wire.questions.objectiveState.criteria.completed).toContain("pattern rule");
  expect(decision.proposal).toMatchObject({ nodeId: "pattern-a", answerOutcome: "correct" });
});

it("rejects old-runtime results and definition mismatches after a restart", () => {
  const oldRuntime = createLessonRuntime("old-pattern", { lesson: TEST_PATTERN_LESSON });
  const oldSource = { ...classificationSource({ ...oldRuntime, hasChildTranscript: true })!, childTurnId: 1 };
  const restarted = createLessonRuntime("new-pattern", { lesson: TEST_PATTERN_LESSON });
  const event = {
    type: "proposal.received" as const,
    source: oldSource,
    proposal: { nodeId: "pattern-a", transcriptRevision: oldSource.transcriptRevision, childActivity: "unknown", answerOutcome: "correct", supportState: "none", tutorState: "acknowledging" },
    atMs: 1,
  };
  expect(reduceLessonRuntime(restarted, event, TEST_PATTERN_LESSON).state).toBe(restarted);
  const otherLesson = createLessonRuntime("counting-runtime", { lesson: COUNTING_LESSON });
  expect(reduceLessonRuntime(otherLesson, event, TEST_PATTERN_LESSON).state).toBe(otherLesson);
});

it("releases only the selected lesson's current-node steering after exact render confirmation", () => {
  const lesson = TEST_PATTERN_LESSON;
  const active = createLessonRuntime("pattern-render", { lesson });
  const origin = { ...classificationSource({ ...active, hasChildTranscript: true })!, childTurnId: 1 };
  const identity = { token: JSON.stringify([active.runtimeId, 2]), nodeId: "pattern-b", sceneId: "pattern-card-next" };
  const rendering = {
    ...active,
    nodeId: "pattern-b",
    visitId: 2,
    phase: "rendering" as const,
    pendingRender: { identity, origin },
  };
  expect(
    reduceLessonRuntime(rendering, {
      type: "render.confirmed",
      runtimeId: active.runtimeId,
      identity: { ...identity, token: "stale-token" },
      atMs: 1,
    }, lesson).state,
  ).toBe(rendering);
  expect(
    reduceLessonRuntime(rendering, {
      type: "render.confirmed",
      runtimeId: active.runtimeId,
      identity,
      atMs: 1,
    }, lesson).effects,
  ).toMatchObject([
    {
      type: "steering.ready",
      context: {
        nodeId: "pattern-b",
        scene: { id: "pattern-card-next", symbol: "triangle", sequenceLength: 5 },
      },
    },
  ]);
});
