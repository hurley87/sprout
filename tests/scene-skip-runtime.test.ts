import { useRuntimeFakeTimers, providerEvents } from "./helpers/runtime-harness";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import {
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type ConceptEvidenceRecord,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));

vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

const SKIP_LESSON: LessonDefinition = validateLessonDefinition({
  id: "skip-test",
  initialNodeId: "first",
  recovery: {
    supportClarificationInstruction: "Ask one clarifying question.",
    answerRecoveryInstruction: "Invite the learner to try again.",
  },
  nodes: {
    first: {
      id: "first",
      presentation: { sceneId: "first-card" },
      learningObjective: "Explore the first idea.",
      tutorBrief: "Ask about the first idea.",
      onSuccess: { kind: "node", nodeId: "second" },
    },
    second: {
      id: "second",
      presentation: { sceneId: "second-card" },
      learningObjective: "Explore the second idea.",
      tutorBrief: "Ask about the second idea.",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona: "Be patient.",
    sessionGuidance: "Let the learner explain.",
    startInstruction: "Begin.",
    nodeInstruction: "Teach the current objective.",
  },
  classifier: {
    objectiveInstructions: "Assess the current objective.",
    objectiveCriteria: {
      completed: "Complete.",
      incorrect: "Incorrect.",
      unclear_or_incomplete: "Unclear.",
      unresolved_help: "Needs help.",
      no_attempt: "No attempt.",
    },
    tutorInstructions: "Assess the tutor response.",
    tutorCriteria: {
      confirmed_completion: "Acknowledged.",
      clarifying: "Clarifying.",
      helping: "Helping.",
      asking: "Asking.",
      other: "Other.",
    },
  },
});

let runtime: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  transport.receive = undefined;
  fetchMock = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function emit(event: ProviderEvent) {
  transport.receive?.(event);
}

async function start() {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, SKIP_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  return steeringCommand();
}

function steeringCommand() {
  const commands = transport.send.mock.calls
    .map(([command]) => command)
    .filter(
      (command): command is Extract<ClientCommand, { type: "session.instructions.append" }> =>
        command.type === "session.instructions.append",
    );
  const command = commands.at(-1);
  if (!command) throw new Error("Expected a steering append");
  return command;
}

const events = providerEvents(emit);

function acknowledge(command: Extract<ClientCommand, { type: "session.instructions.append" }>, startMs: number) {
  events.acknowledgeSteering(command.event_id, startMs);
}

async function observedQuiet(ms = 250) {
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(ms);
}

async function flushPromises() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

it.each(["initial steering", "unknown media", "active media"] as const)(
  "rejects a skip with %s without clearing handoff or media state",
  async scenario => {
    const initial = await start();
    if (scenario !== "initial steering") acknowledge(initial, 0);
    if (scenario === "active media") emit({ type: "output.activity", state: "active" });
    const before = runtime.snapshot();

    runtime.skipScene();

    expect(runtime.snapshot().runtime).toEqual(before.runtime);
    expect(runtime.snapshot().display).toEqual(before.display);
    expect(runtime.snapshot().awaitingSteering).toBe(scenario === "initial steering");
    expect(transport.send).toHaveBeenCalledTimes(1);
    if (scenario === "initial steering") {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runtime.snapshot()).toMatchObject({
        status: "ended",
        error: expect.stringContaining("steering acknowledgment timed out"),
      });
    }
  },
);

it("rejects a skip while a child candidate is pending, preserving its recovery state", async () => {
  const initial = await start();
  acknowledge(initial, 0);
  await observedQuiet();
  emit({ type: "microphone.activity_started" });
  const before = runtime.snapshot().runtime;

  runtime.skipScene();

  expect(runtime.snapshot().runtime).toEqual(before);
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", childSpeaking: true, childCandidate: {} });
  expect(transport.send).toHaveBeenCalledTimes(1);
});

it("waits for quiet drain, exact render confirmation, and the matching next steering acknowledgment", async () => {
  const initial = await start();
  runtime.skipScene();
  expect(runtime.snapshot().runtime?.phase).toBe("active"); // unavailable is not quiet evidence

  acknowledge(initial, 0);
  emit({ type: "output.activity", state: "active" });
  runtime.skipScene();
  expect(runtime.snapshot().runtime?.phase).toBe("active");

  await observedQuiet();
  runtime.skipScene();
  const requested = runtime.snapshot().display;
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "second" });
  expect(transport.send).toHaveBeenCalledTimes(1);

  runtime.confirmRendered({ ...requested, token: "stale-token" });
  expect(transport.send).toHaveBeenCalledTimes(1);
  runtime.confirmRendered(requested);
  const next = steeringCommand();
  expect(next.event_id).not.toBe(initial.event_id);
  expect(runtime.snapshot()).toMatchObject({ status: "live", awaitingSteering: true, display: requested });

  acknowledge(initial, 1); // stale acknowledgment cannot release the next visit
  runtime.skipScene();
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  expect(runtime.snapshot().awaitingSteering).toBe(true);

  acknowledge(next, 2);
  await observedQuiet();
  runtime.skipScene();
  const terminal = runtime.snapshot().display;
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", lessonComplete: true });
  expect(terminal).toMatchObject({ nodeId: null, sceneId: null });
  runtime.confirmRendered(terminal);
  expect(runtime.snapshot()).toMatchObject({ status: "ended", runtime: { phase: "complete", lessonComplete: true } });
  expect(transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append")).toHaveLength(
    2,
  );
});

it("ignores a delayed classifier result after an accepted skip", async () => {
  let resolveClassification!: (response: Response) => void;
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/classify")
      return new Promise<Response>(resolve => {
        resolveClassification = resolve;
      });
    return Promise.resolve(Response.json({ ok: true }));
  });
  const initial = await start();
  acknowledge(initial, 0);
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "A thought.", startMs: 10, endMs: 20 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenCalledWith("/api/classify", expect.any(Object));

  await observedQuiet();
  runtime.skipScene();
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "second" });

  resolveClassification(
    Response.json({
      proposal: {
        nodeId: "first",
        transcriptRevision: 1,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
      },
    }),
  );
  await flushPromises();
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "second", answerAccepted: false });
  expect(runtime.snapshot().display.nodeId).toBe("second");
});

it("does not cancel classification when a skip is rejected for unavailable media", async () => {
  let resolveClassification!: (response: Response) => void;
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/classify")
      return new Promise<Response>(resolve => {
        resolveClassification = resolve;
      });
    return Promise.resolve(Response.json({ ok: true }));
  });
  const initial = await start();
  acknowledge(initial, 0);
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "A thought.", startMs: 10, endMs: 20 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenCalledWith("/api/classify", expect.any(Object));

  runtime.skipScene(); // media is still unavailable, so this must not abort classification
  resolveClassification(
    Response.json({
      proposal: {
        nodeId: "first",
        transcriptRevision: 1,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
      },
    }),
  );
  await flushPromises();

  expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", nodeId: "first", answerAccepted: true });
  expect(runtime.snapshot().display.nodeId).toBe("first");
});

it("reducer requires current quiet drain and preserves only authored concept carry-forward", () => {
  const lesson = validateLessonDefinition({
    ...SKIP_LESSON,
    nodes: {
      first: {
        ...SKIP_LESSON.nodes.first,
        concepts: [
          { id: "known", description: "Known concept." },
          { id: "partial", description: "Partial concept." },
        ],
        completionPolicy: "allow_unresolved",
        onSuccess: { kind: "node", nodeId: "second", carryForwardCriteria: ["known"] },
      },
      second: {
        ...SKIP_LESSON.nodes.second,
        concepts: [{ id: "known", description: "Known concept." }],
        completionPolicy: "allow_unresolved",
      },
    },
  });
  const base = createLessonRuntime("reducer-skip", { quietDrainMs: 100, lesson });
  const demonstrated: ConceptEvidenceRecord = {
    criterionId: "known",
    status: "demonstrated",
    understanding: "independent",
    source: null,
    promptingHistory: [],
  };
  const partial: ConceptEvidenceRecord = {
    ...demonstrated,
    criterionId: "partial",
    status: "partial",
    understanding: null,
  };
  const state = {
    ...base,
    outputActivity: "quiet" as const,
    quietSinceMs: 10,
    nowMs: 110,
    conceptEvidence: { "first:known": demonstrated, "first:partial": partial },
  };
  const skipped = reduceLessonRuntime(
    state,
    { type: "scene.skipped", source: runtimeSource(state), atMs: 110 },
    lesson,
  );
  expect(skipped.state.phase).toBe("rendering");
  expect(skipped.state.conceptEvidence).toEqual({
    "first:known": demonstrated,
    "first:partial": partial,
    "second:known": { ...demonstrated, criterionId: "known" },
  });
  expect(skipped.effects).toEqual([{ type: "render.requested", identity: skipped.state.pendingRender?.identity }]);

  for (const unavailable of [
    { ...state, outputActivity: "unavailable" as const },
    { ...state, quietSinceMs: null },
    { ...state, quietSinceMs: 20 },
    { ...state, childCandidate: { hasChildTranscript: false, tutorOutputObserved: false } },
  ]) {
    const rejected = reduceLessonRuntime(
      unavailable,
      { type: "scene.skipped", source: runtimeSource(unavailable), atMs: 110 },
      lesson,
    );
    expect(rejected.state).toBe(unavailable);
    expect(rejected.effects).toEqual([]);
  }
});
