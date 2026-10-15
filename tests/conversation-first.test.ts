import { useRuntimeFakeTimers, providerEvents } from "./helpers/runtime-harness";
import { afterEach, expect, it, vi } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  classificationSource,
  createLessonRuntime,
  learnerRequestedNext,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { assessmentQuestions, normalizeAssessment } from "../lib/lesson-runtime/conversation-assessment";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import replay from "./fixtures/catching-unicorns-stall-replay.json";
const nextRequest = "Yeah, I think next question. I think I have answered this.";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
const events = providerEvents(event => transport.receive!(event));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function harness() {
  const definition = { ...lesson, initialNodeId: "exographics" };
  let state = createLessonRuntime("stall-replay", { lesson: definition, quietDrainMs: 50 });
  function send(event: Record<string, unknown>, delta = 1) {
    const result = reduceLessonRuntime(
      state,
      { ...event, atMs: state.nowMs + delta } as LessonRuntimeEvent,
      definition,
    );
    state = result.state;
    return result;
  }
  send({ type: "child.turn.started", source: runtimeSource(state) });
  send({ type: "transcript.updated", source: runtimeSource(state), revision: 1, speaker: "child" });
  send({ type: "child.turn.ended", source: runtimeSource(state) });
  return {
    get state() {
      return state;
    },
    send,
    definition,
  };
}
it("advances the recorded split-source stall while retaining three concepts and unresolved visual symbols", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "tutor" });
  const source = classificationSource(h.state)!;
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    replay.outputs as ConversationStateOutputs,
  );
  expect(decision.outcome).toBe("allow_semantic_completion_evidence");
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  expect(h.state.answerAccepted).toBe(false);
  expect(h.state.conceptEvidence["exographics:visual-symbols"]).toBeUndefined();
  expect(Object.values(h.state.conceptEvidence).filter(e => e.status === "demonstrated")).toHaveLength(3);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  expect(h.state.nodeId).toBe("exographics");
  const result = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(result.state).toMatchObject({ nodeId: "recap", phase: "rendering" });
});
it("ignores stale closure and revoked completion after a tutor follow-up", () => {
  const h = harness();
  const stale = classificationSource(h.state)!;
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "tutor" });
  const source = classificationSource(h.state)!;
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    replay.outputs as ConversationStateOutputs,
  );
  h.send({
    type: "proposal.received",
    source: stale,
    proposal: decision.proposal,
    transcriptSnapshot: replay.transcript,
  });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  expect(h.state.conversationAdvanceRequested).toBe("tutor");
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 3, speaker: "tutor" });
  expect(h.state.conversationAdvanceRequested).toBe(false);
});
it.each(["Next question, then", "Please move on", "Can we go to the next question?", "Skip this question."])(
  "honors %s without accepting uncertain evidence",
  text => {
    const h = harness();
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({
      type: "conversation.advance.requested",
      source: classificationSource(h.state),
      transcriptSnapshot: `Child: ${text}`,
    });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
    expect(h.state.nodeId).toBe("recap");
    expect(h.state.conceptEvidence).toEqual({});
  },
);
it("never treats quoted requests, tutor speech, or a learner answer containing next question as a navigation request", () => {
  for (const text of [
    "Tutor: Next question, then",
    'Child: The book says "next question".',
    "Child: What does the next question mean?",
    "Child: Next question, but first explain this.",
  ])
    expect(learnerRequestedNext(text)).toBe(false);
});
const assessmentBody = () => ({
  answers: Object.fromEntries(
    Object.keys(assessmentQuestions(lesson)).map(key => [
      key,
      {
        type: "choice",
        choice: "partial",
        confidence: 0.6,
        probabilities: { not_yet: 0.1, partial: 0.6, demonstrated_independent: 0.3, demonstrated_prompted: 0 },
      },
    ]),
  ),
});
it("preserves full probabilities and uncertain grading without single-message attribution", () => {
  const body = assessmentBody();
  const result = normalizeAssessment(body, lesson)!;
  expect(result.results["exographics:visual-symbols"].outcome).toBe("uncertain");
  expect(result.results["exographics:visual-symbols"].scores.probabilities.partial).toBe(0.6);
  expect(assessmentQuestions(lesson)["exographics:visual-symbols"].instructions).toContain(
    "combined across multiple learner answers",
  );
  const broken = structuredClone(body);
  broken.answers["exographics:visual-symbols"].probabilities.partial = 2;
  expect(normalizeAssessment(broken, lesson)).toBeNull();
});
it("advances explicit next in the real runtime even with classifier outage, and assesses the saved conversation after stopping", async () => {
  useRuntimeFakeTimers();
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/assess"
      ? Response.json({ assessment: normalizeAssessment(assessmentBody(), lesson) })
      : url === "/api/classify"
        ? Response.json({}, { status: 503 })
        : Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...lesson, initialNodeId: "exographics" });
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("Next question, then", 100);
  await vi.advanceTimersByTimeAsync(900);
  expect(runtime.snapshot().display.nodeId).toBe("recap");
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/classify")).toBe(false);
  runtime.confirmRendered(runtime.snapshot().display);
  runtime.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.report().conversation?.[0].transcript).toContain("Next question, then");
  expect(runtime.report().assessment?.status).toBe("complete");
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
});

it.each([
  { nodeId: "recap", configured: true },
  { nodeId: "summary", configured: true },
  { nodeId: "ordinary", configured: false },
  { nodeId: "recap", configured: false },
])("assesses on confirmed entry to $nodeId only when configured=$configured", async ({ nodeId, configured }) => {
  useRuntimeFakeTimers();
  const fetchMock = vi.fn(async () => Response.json({ assessment: normalizeAssessment(assessmentBody(), lesson) }));
  vi.stubGlobal("fetch", fetchMock);
  const { assessConversationOnEntry, ...ordinaryScene } = lesson.nodes.recap;
  expect(assessConversationOnEntry).toBe(true);
  const definition = {
    ...lesson,
    initialNodeId: "exographics",
    nodes: {
      ...lesson.nodes,
      exographics: { ...lesson.nodes.exographics, onSuccess: { kind: "node" as const, nodeId } },
      [nodeId]: { ...ordinaryScene, id: nodeId, ...(configured ? { assessConversationOnEntry: true } : {}) },
    },
  };
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const steering = transport.send.mock.calls[0][0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Next question, then", 100);
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().runtime).toMatchObject({ nodeId, phase: "rendering" });
    expect(fetchMock).not.toHaveBeenCalled();

    const display = runtime.snapshot().display;
    runtime.confirmRendered(display);
    // Assessment starts at render confirmation, without waiting for the steering acknowledgment.
    expect(fetchMock).toHaveBeenCalledTimes(configured ? 1 : 0);
    if (configured) {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/assess",
        expect.objectContaining({
          body: JSON.stringify({ lessonId: lesson.id, visits: runtime.report().conversation }),
        }),
      );
      runtime.confirmRendered(display);
      runtime.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(runtime.report().assessment?.status).toBe("complete");
    }
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  } finally {
    runtime.stop();
    await vi.advanceTimersByTimeAsync(0);
  }
});

it.each(["active", "unavailable"] as const)("holds a next request while audio is %s", activity => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: activity });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: "Child: Next question, then",
  });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(h.state.nodeId).toBe("recap");
});
it("revokes a next request when a new learner turn interrupts it", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: "Child: Next question, then",
  });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
  expect(h.state.conversationAdvanceRequested).toBe(false);
});

it.each([
  nextRequest,
  "Yeah, I think next question. I think I have answered this.",
  "I am, I think next\nquestion. I think I've answered this",
])("recognizes conversational navigation: %s", request => {
  expect(learnerRequestedNext(`Child: ${request}\nTutor: Okay, we'll move on.`)).toBe(true);
});
it.each([
  "I don't think next question.",
  "I think we should not move on.",
  "Don't move on.",
  'He said "next question".',
  "She asked us to move on.",
  "Next question, but first explain this.",
  "Can you explain the next question?",
  "If I say next question, will you move on?",
  "I think next question is about schools.",
  "I think next question. Actually, don't move on.",
])("rejects negative, quoted, hypothetical and answer intent: %s", request => {
  expect(learnerRequestedNext(`Child: ${request}`)).toBe(false);
});
it("retains partial evidence when a request advances with no current-turn transcript", () => {
  const h = harness();
  const source = classificationSource(h.state)!;
  const outputs = structuredClone(replay.outputs) as ConversationStateOutputs;
  const partial = {
    choice: "partial",
    confidence: 1,
    probabilities: { not_yet: 0, partial: 1, demonstrated_independent: 0, demonstrated_prompted: 0 },
  } as const;
  outputs.concepts = { ...outputs.concepts, "concept_visual-symbols": partial };
  outputs.sources = {
    ...outputs.sources,
    "source_visual-symbols": {
      choice: "message_1",
      confidence: 1,
      probabilities: { none: 0, message_1: 1, message_3: 0 },
    },
  };
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    outputs,
  );
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  const evidence = structuredClone(h.state.conceptEvidence);
  expect(evidence["exographics:visual-symbols"].status).toBe("partial");
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  expect(classificationSource(h.state)).toBeNull();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: { ...runtimeSource(h.state), nodeId: h.state.nodeId, transcriptRevision: h.state.transcriptRevision },
    transcriptSnapshot: `Child: ${nextRequest}\nTutor: Okay, we'll move on.`,
  });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(h.state.nodeId).toBe("recap");
  expect(h.state.conceptEvidence).toEqual(evidence);
});

it("revokes pending navigation on actual new learner text, even without another microphone onset", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: `Child: ${nextRequest}`,
  });
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "child" });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
});

it("follows the four-question path through recap and completes without another learner answer", async () => {
  useRuntimeFakeTimers();
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe("/api/assess");
    return Response.json({}, { status: 503 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    let providerTime = 0;
    for (const nodeId of ["engram", "exogram", "compare", "exographics"]) {
      expect(runtime.snapshot().runtime?.nodeId).toBe(nodeId);
      const steering = transport.send.mock.calls.at(-1)![0];
      if (steering.type !== "session.instructions.append") throw new Error("Expected scene steering");
      events.acknowledgeSteering(steering.event_id, providerTime);
      transport.receive!({ type: "output.activity", state: "quiet" });
      events.childTurn("Next question, then", providerTime + 100);
      await vi.advanceTimersByTimeAsync(900);
      runtime.confirmRendered(runtime.snapshot().display);
      providerTime += 1000;
    }
    expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "recap", phase: "active", hasChildTranscript: false });
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
    const close = transport.send.mock.calls.at(-1)![0];
    if (close.type !== "session.instructions.append") throw new Error("Expected recap steering");
    expect(close.content).toContain("terminal recap, not a question");
    events.acknowledgeSteering(close.event_id, providerTime);
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().status).toBe("live"); // Silence alone cannot complete recap.
    transport.receive!({ type: "output.activity", state: "active" });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().status).toBe("live");
    transport.receive!({ type: "output.activity", state: "unavailable" });
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().status).toBe("live"); // Unavailable output revokes observed audio.
    events.tutorTurn("The discussion is finished. Review the recap on screen.", providerTime + 100);
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    const terminal = runtime.snapshot().display;
    expect(terminal.nodeId).toBeNull();
    runtime.confirmRendered(terminal);
    expect(runtime.snapshot()).toMatchObject({ status: "ended", runtime: { nodeId: "recap", phase: "complete" } });
    expect(transport.close).toHaveBeenCalledOnce();
    const appends = transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append");
    expect(appends).toHaveLength(5);
    runtime.confirmRendered(terminal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/assess")).toBe(true);
  } finally {
    runtime.stop();
  }
});
