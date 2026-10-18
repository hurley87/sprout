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
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

// Reported Oct 17 words. The original af06ed93 export was deleted, so timings are synthetic.
const recordedRequest = "Let's move on. I've answered the question.";
const recordedTutorReply = "Okay, thanks. We can move on.";
const definition = { ...lesson, initialNodeId: "exographics" };
const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it.each([
  recordedRequest,
  "Let's move on.",
  "Can we move on?",
  "Next question, please.",
  "I've answered the question. Let's move on.",
  "I don't know. Can we skip this question?",
  "I'm done with this question. Next.",
  "I have answered the question. Could we move on, please?",
  "Please move on. I've answered that question.",
  "I am done with the question. Next question.",
  "Next. I don't know.",
  "I don’t know, please move on",
  "Okay, next question, then.",
  "Yeah, I think next question. I think I have answered this.",
  "I am, I think next\nquestion. I think I've answered this",
])("recognizes bounded learner navigation: %s", request => {
  expect(learnerRequestedNext(`Tutor: What do you think?\nChild: ${request}`)).toBe(true);
});
it.each([
  "I've answered the question.",
  "I'm done with this question.",
  "I don't know.",
  "I don't think next question.",
  "Don't move on.",
  "We should not move on.",
  'He said "move on".',
  '"Let\'s move on."',
  "'Next question, please.'",
  "The phrase move on means to proceed.",
  "If I said next question, would you move on?",
  "Can you explain the next question?",
  "I think next question is about schools.",
  "Let's move on. Actually, don't move on.",
  "Next question, but first explain this.",
  "I've answered the question incorrectly. Let's move on.",
  "Next. My answer is that memory is biological.",
  "I've answered the question? Let's move on.",
  "I'm done with this question, but I have a question. Next.",
  "We can move on.",
  "The tutor asked us to move on.",
  "Let’s move on is a useful phrase.",
])("rejects explanations, quotes, hypotheticals and substantive additions: %s", text => {
  expect(learnerRequestedNext(`Child: ${text}`)).toBe(false);
});
it("reads the latest learner utterance and never uses tutor navigation as a learner request", () => {
  expect(learnerRequestedNext(`Child: I don't know.\nTutor: Let's move on.`)).toBe(false);
  expect(learnerRequestedNext(`Tutor: ${recordedRequest}`)).toBe(false);
  expect(learnerRequestedNext(`Child: Next.\nTutor: Okay.\nChild: Wait, why?`)).toBe(false);
  expect(learnerRequestedNext(`Child: ${recordedRequest}\nTutor: ${recordedTutorReply}`)).toBe(true);
});
function harness() {
  let state = createLessonRuntime("learner-navigation", { lesson: definition, quietDrainMs: 500 });
  const send = (event: Record<string, unknown>, delta = 1) => {
    const result = reduceLessonRuntime(
      state,
      {
        source: runtimeSource(state),
        ...event,
        atMs: state.nowMs + delta,
      } as LessonRuntimeEvent,
      definition,
    );
    state = result.state;
    return result;
  };
  send({ type: "child.turn.started" });
  send({ type: "transcript.updated", speaker: "child", revision: 1, transcriptSnapshot: `Child: ${recordedRequest}` });
  send({ type: "child.turn.ended" });
  const request = (source = classificationSource(state)) =>
    send({
      type: "conversation.advance.requested",
      source,
      transcriptSnapshot: `Child: ${recordedRequest}`,
    });
  return {
    get state() {
      return state;
    },
    send,
    request,
  };
}
it("advances with no mastery or tutor approval after quiet drain, exactly once", () => {
  const h = harness();
  h.send({ type: "output.activity", state: "quiet" });
  h.request();
  expect(h.state).toMatchObject({ conversationAdvanceRequested: "learner", tutorClosure: null, conceptEvidence: {} });
  h.send({ type: "clock.tick" }, 499);
  expect(h.state.phase).toBe("active");
  const transition = h.send({ type: "clock.tick" });
  expect(transition.effects.filter(e => e.type === "render.requested")).toHaveLength(1);
  expect(h.state).toMatchObject({ nodeId: "recap", phase: "rendering", answerAccepted: false, conceptEvidence: {} });
  const identity = h.state.pendingRender!.identity;
  h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity });
  expect(h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity }).effects).toEqual([]);
  expect(h.send({ type: "clock.tick" }, 1000).effects).toEqual([]);
});
it("holds navigation during active tutor audio and preserves it across tutor revisions and classification", () => {
  const h = harness();
  h.send({ type: "output.activity", state: "active" });
  h.request();
  h.send({ type: "transcript.updated", speaker: "tutor", revision: 2 });
  const source = classificationSource(h.state)!;
  h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: `Child: ${recordedRequest}\nTutor: ${recordedTutorReply}`,
    proposal: {
      nodeId: source.nodeId,
      transcriptRevision: source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "unclear",
      supportState: "none",
      tutorState: "unknown",
      conceptObservations: [],
    },
  });
  expect(h.state.conversationAdvanceRequested).toBe("learner");
  h.send({ type: "clock.tick" }, 2000);
  expect(h.state.phase).toBe("active");
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 500);
  expect(h.state.nodeId).toBe("recap");
  expect(h.state.conceptEvidence).toEqual({});
});
it.each(["child.turn.started", "transcript.updated"])("revokes navigation on substantive interruption via %s", type => {
  const h = harness();
  h.send({ type: "output.activity", state: "active" });
  h.request();
  h.send({ type, speaker: "child", revision: 2, transcriptSnapshot: `Child: ${recordedRequest} Actually, why?` });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.send({ type: "child.turn.ended" });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state.nodeId).toBe("exographics");
});
it.each(["transcriptRevision", "visitId", "childTurnId", "nodeId", "runtimeId"] as const)(
  "rejects a request with stale %s",
  field => {
    const h = harness();
    const source = classificationSource(h.state)!;
    h.request({ ...source, [field]: typeof source[field] === "number" ? Number(source[field]) - 1 : "stale" });
    expect(h.state.conversationAdvanceRequested).toBe(false);
  },
);
it("blocks navigation during speech and preserves an accepted request across discarded microphone energy", () => {
  const h = harness();
  h.send({ type: "output.activity", state: "quiet" });
  h.request();
  h.send({ type: "child.candidate.started" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state.phase).toBe("active");
  expect(h.state.conversationAdvanceRequested).toBe("learner");
  expect(h.send({ type: "child.candidate.discarded" }).state.nodeId).toBe("recap");
});
it("rejects navigation while confirmed learner speech is ongoing", () => {
  const h = harness();
  h.send({ type: "child.turn.started" });
  h.send({
    type: "conversation.advance.requested",
    source: { ...runtimeSource(h.state), nodeId: h.state.nodeId, transcriptRevision: h.state.transcriptRevision },
    transcriptSnapshot: `Child: ${recordedRequest}`,
  });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state).toMatchObject({ phase: "active", conversationAdvanceRequested: false });
});
it.each(["none", "before_debounce", "after_request"])(
  "real scheduler advances the reported request without Jev or mastery (tutor reply: %s)",
  async tutorReply => {
    useRuntimeFakeTimers();
    const fetchMock = vi.fn(async () => Response.json({}, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const events = providerEvents(event => transport.receive!(event));
    const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
    try {
      runtime.confirmRendered(runtime.snapshot().display);
      const steering = transport.send.mock.calls.at(-1)![0];
      if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
      events.acknowledgeSteering(steering.event_id, 0);
      transport.receive!({ type: "output.activity", state: tutorReply === "none" ? "quiet" : "active" });
      events.childTurn(recordedRequest, 100);
      if (tutorReply !== "none") {
        if (tutorReply === "after_request") {
          await vi.advanceTimersByTimeAsync(1000);
          expect(runtime.snapshot().runtime?.conversationAdvanceRequested).toBe("learner");
        }
        events.tutorTurn(recordedTutorReply, 300);
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(runtime.snapshot().runtime).toMatchObject({
        nodeId: "recap",
        phase: "rendering",
        conceptEvidence: {},
        answerAccepted: false,
      });
      // Tutor stabilization may start a classifier call before the navigation
      // debounce expires. Its mocked HTTP failure must not hold navigation.
      if (tutorReply !== "before_debounce") expect(fetchMock).not.toHaveBeenCalled();
      const display = runtime.snapshot().display;
      runtime.confirmRendered(display);
      runtime.confirmRendered(display);
      expect(
        transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append"),
      ).toHaveLength(2);
    } finally {
      runtime.stop();
    }
  },
);

it.each([0, 1000])("real scheduler revokes navigation when the learner continues after %sms", async delay => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  const events = providerEvents(event => transport.receive!(event));
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    const steering = transport.send.mock.calls.at(-1)![0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "active" });
    events.childTurn(recordedRequest, 100);
    await vi.advanceTimersByTimeAsync(delay);
    events.childTurn("Actually, can you explain exographics?", 300);
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime).toMatchObject({
      nodeId: "exographics",
      phase: "active",
      conversationAdvanceRequested: false,
    });
  } finally {
    runtime.stop();
  }
});
