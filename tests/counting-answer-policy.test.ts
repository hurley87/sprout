import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  conversationStateQuestions,
  mapConversationObservation,
  type ObjectiveState,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime | undefined;
beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Supplied model judgments test policy/orchestration, not semantic accuracy.
function outputs(
  objective: ObjectiveState,
  probability = 0.96,
  commitmentProbability = 0.97,
): ConversationStateOutputs {
  return {
    answerCommitment: {
      choice: "committed",
      confidence: commitmentProbability,
      probabilities: {
        committed: commitmentProbability,
        unresolved: (1 - commitmentProbability) / 3,
        withdrawn: (1 - commitmentProbability) / 3,
        no_answer: (1 - commitmentProbability) / 3,
      },
    },
    objectiveState: {
      choice: objective,
      confidence: probability,
      probabilities: Object.fromEntries(
        ["completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"].map(label => [
          label,
          label === objective ? probability : (1 - probability) / 4,
        ]),
      ) as ConversationStateOutputs["objectiveState"]["probabilities"],
    },
    tutorState: {
      choice: "helping",
      confidence: 0.4,
      probabilities: { confirmed_completion: 0.35, helping: 0.4, other: 0.25, asking: 0, clarifying: 0 },
    },
  };
}
function response(
  input: { nodeId: string; transcriptRevision: number; transcript: string },
  objective: ObjectiveState,
  p = 0.96,
  commitmentProbability = 0.97,
) {
  const decision = mapConversationObservation(
    { ...input, lesson: COUNTING_LESSON },
    outputs(objective, p, commitmentProbability),
  );
  const diagnostic = {
    classifierVersion: CLASSIFIER_VERSION,
    decision: decision.status,
    outcome: decision.outcome,
    reason: decision.reason,
    outputs: decision.outputs,
    labelCompletionEligible: decision.labelCompletionEligible,
    thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
    nodeId: input.nodeId,
    transcriptRevision: input.transcriptRevision,
    elapsedMs: 0,
  };
  expect(parseLiveClassificationDiagnostic(diagnostic, COUNTING_LESSON, input.nodeId)).not.toBeNull();
  return Response.json({ proposal: decision.proposal, diagnostic });
}

it.each(["completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"] as const)(
  "maps confident learner %s independently of uncertain tutor feedback",
  objective => {
    const decision = mapConversationObservation(
      {
        lesson: COUNTING_LESSON,
        nodeId: "count-1-duck",
        transcriptRevision: 3,
        transcript: "Child: One duck.\nChild: Why?",
      },
      outputs(objective),
    );
    expect(decision.status).toBe("accepted");
    expect(decision.outcome).toBe(objective === "completed" ? "allow_semantic_completion_evidence" : "hold_scene");
    expect(decision.proposal?.tutorState).toBe("unknown");
    expect(decision.proposal?.answerOutcome === "correct").toBe(objective === "completed");
  },
);

it("keeps uncertain learner evidence unresolved even if a previous answer was accepted", () => {
  const decision = mapConversationObservation(
    {
      lesson: COUNTING_LESSON,
      nodeId: "count-1-duck",
      transcriptRevision: 4,
      transcript: "Child: One.\nChild: Maybe two?",
    },
    outputs("completed", 0.65),
  );
  expect(decision).toMatchObject({ status: "abstained", reason: "objectiveState_no_winner", proposal: null });
});

it("keeps confirmation gates for lessons outside counting and authors the explanation/correction distinction", () => {
  const legacy = { ...COUNTING_LESSON, answerAcceptance: undefined };
  const legacyOutputs = { ...outputs("completed") };
  Reflect.deleteProperty(legacyOutputs, "answerCommitment");
  expect(
    mapConversationObservation(
      { lesson: legacy, nodeId: "count-1-duck", transcriptRevision: 1, transcript: "Child: One." },
      legacyOutputs,
    ),
  ).toMatchObject({ status: "abstained", reason: "tutorState_no_winner" });
  expect(
    mapConversationObservation(
      {
        lesson: { ...COUNTING_LESSON, id: "other-lesson" },
        nodeId: "count-1-duck",
        transcriptRevision: 1,
        transcript: "Child: One.",
      },
      legacyOutputs,
    ),
  ).toMatchObject({ status: "abstained", reason: "tutorState_no_winner" });
  const question = conversationStateQuestions(COUNTING_LESSON, "count-1-duck").objectiveState;
  expect(question.instructions).toContain("independently of tutor feedback");
  expect(question.criteria.completed).toContain("separately from commitment");
  expect(question.criteria.unresolved_help).toContain("rather than merely requesting an explanation");
});

it.each([
  { speech: "Why?", objective: "completed", advance: true },
  { speech: "Actually, two ducks.", objective: "incorrect", advance: false },
  { speech: "Why? Maybe two?", objective: "unclear_or_incomplete", advance: false },
  { speech: "I need help counting.", objective: "unresolved_help", advance: false },
] as const)("reevaluates $speech before allowing any transition", async ({ speech, objective, advance }) => {
  let resolveRecheck: (() => void) | undefined;
  let requests = 0;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string);
    requests++;
    if (requests === 2)
      await new Promise<void>(resolve => {
        resolveRecheck = resolve;
      });
    return response(input, requests === 1 ? "completed" : objective);
  });
  vi.stubGlobal("fetch", fetch);
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, COUNTING_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(event => transport.receive!({ ...event, sourceId: 1 }));
  events.acknowledgeSteering(transport.send.mock.calls[0][0].event_id!, 0);
  events.childTurn("One duck.", 100);
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.snapshot().runtime).toMatchObject({
    answerAccepted: true,
    acknowledgmentObserved: false,
    phase: "active",
  });
  transport.receive!({ type: "transcript", speaker: "sprout", delta: "That's right.", startMs: 300, endMs: 400 });
  transport.receive!({ type: "output.activity", state: "active", sourceId: 1 });
  expect(runtime.snapshot().runtime?.answerAccepted).toBe(true);
  events.childTurn(speech, 500);
  expect(runtime.snapshot().runtime).toMatchObject({ answerAccepted: false, phase: "active" });
  await vi.advanceTimersByTimeAsync(300);
  expect(resolveRecheck).toBeDefined();
  expect(runtime.report().events.filter(event => event.type === "render.requested")).toHaveLength(0);
  resolveRecheck!();
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().runtime?.answerAccepted).toBe(advance);
  transport.receive!({ type: "output.activity", state: "quiet", sourceId: 1 });
  events.tutorTurn("Because there is a single duck on the screen.", 700);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime?.phase).toBe(advance ? "rendering" : "active");
  expect(runtime.report().events.filter(event => event.type === "render.requested")).toHaveLength(advance ? 1 : 0);
  expect(fetch).toHaveBeenCalledTimes(advance ? 2 : 3);
  expect(runtime.report().events.some(event => event.type === "classifier.mapping_unavailable")).toBe(false);
  if (advance) {
    const display = runtime.snapshot().display;
    runtime.confirmRendered({ ...display, token: "stale" });
    expect(transport.send).toHaveBeenCalledTimes(1);
    runtime.confirmRendered(display);
    expect(runtime.snapshot().runtime?.nodeId).toBe("count-2-ducks");
    expect(transport.send).toHaveBeenCalledTimes(2);
  }
});

it("accepts the earlier learner answer when Why arrives before the first evaluation", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    response(JSON.parse(init.body as string), "completed"),
  );
  vi.stubGlobal("fetch", fetch);
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, COUNTING_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(event => transport.receive!({ ...event, sourceId: 1 }));
  events.acknowledgeSteering(transport.send.mock.calls[0][0].event_id!, 0);
  events.childTurn("One duck.", 100);
  events.tutorTurn("That's right. One duck.", 300);
  events.childTurn("Why?", 500);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).transcript).toBe(
    "Child: One duck.\nTutor: That's right. One duck.\nChild: Why?",
  );
  expect(runtime.snapshot().runtime).toMatchObject({
    answerAccepted: true,
    acknowledgmentObserved: false,
    phase: "active",
  });
  // Prior audio cannot satisfy the new turn; require the retained fresh-output/drain gates.
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  events.tutorTurn("Because there is a single duck.", 700);
  await vi.advanceTimersByTimeAsync(250);
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("recovers uncertain commitment with the existing bounded clarification instead of accepting or stalling", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    response(JSON.parse(init.body as string), "completed", 0.96, 0.6),
  );
  vi.stubGlobal("fetch", fetch);
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, COUNTING_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(event => transport.receive!({ ...event, sourceId: 1 }));
  events.acknowledgeSteering(transport.send.mock.calls[0][0].event_id!, 0);
  events.childTurn("One... or two?", 100);
  transport.receive!({ type: "output.activity", state: "quiet", sourceId: 1 });
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.snapshot().runtime).toMatchObject({ answerAccepted: false, phase: "active" });
  expect(runtime.report().events).toContainEqual(
    expect.objectContaining({
      type: "classifier.mapping",
      detail: expect.objectContaining({ reason: "answerCommitment_no_winner" }),
    }),
  );
  await vi.advanceTimersByTimeAsync(3999);
  expect(transport.send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(runtime.report().events.filter(event => event.type === "answer_recovery.requested")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
});
