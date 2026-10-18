import { afterEach, expect, it, vi } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
  type ClassificationSource,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

// The Oct 17 af06ed93 export was deleted. These are the reported verbatim words,
// with synthetic times/revisions; the Oct 16 recorded replay remains in catching-unicorns-closure.test.ts.
const close = "I think we've covered what we need here.";
const transcript = `Tutor: What does exographics mean?\nChild: I don't know.\nTutor: ${close}`;
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
function proposal(source: ClassificationSource, tutorState = "acknowledging") {
  return {
    nodeId: source.nodeId,
    transcriptRevision: source.transcriptRevision,
    childActivity: "unknown",
    answerOutcome: "unclear",
    supportState: "none",
    tutorState,
    conceptObservations: [{ criterionId: "cultural-agreement", observation: "not_yet" }],
  };
}
function harness() {
  let state = createLessonRuntime("closure-authority", { lesson: definition, quietDrainMs: 500 });
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
  const text = (snapshot: string, speaker = "child") =>
    send({
      type: "transcript.updated",
      speaker,
      revision: state.transcriptRevision + 1,
      transcriptSnapshot: snapshot,
    });
  const classify = (snapshot = transcript, tutorState = "acknowledging") => {
    const source = classificationSource(state)!;
    return send({
      type: "proposal.received",
      source,
      proposal: proposal(source, tutorState),
      transcriptSnapshot: snapshot,
    });
  };
  const learner = (words: string) => {
    send({ type: "child.turn.started" });
    text(`${transcript}\nChild: ${words}`);
    send({ type: "child.turn.ended" });
  };
  send({ type: "child.turn.started" });
  text("Child: I don't know.");
  send({ type: "child.turn.ended" });
  send({ type: "output.activity", state: "active" });
  text(transcript, "tutor");
  return {
    get state() {
      return state;
    },
    send,
    text,
    classify,
    learner,
  };
}
it.each(["Great.", "Okay.", "Sounds good!", "Thanks."])(
  "accepts delayed exact-source tutor closure after %s and waits for output drain",
  words => {
    const h = harness();
    h.learner(words);
    h.classify(`${transcript}\nChild: ${words}`);
    expect(h.state).toMatchObject({
      conversationAdvanceRequested: "tutor",
      transcriptSource: "child",
      phase: "active",
    });
    expect(h.state.tutorClosure?.source).toEqual(classificationSource(h.state));
    h.send({ type: "clock.tick" }, 1000);
    expect(h.state.phase).toBe("active");
    h.send({ type: "output.activity", state: "quiet" });
    h.send({ type: "clock.tick" }, 499);
    expect(h.state.phase).toBe("active");
    const result = h.send({ type: "clock.tick" });
    expect(result.effects.filter(e => e.type === "render.requested")).toHaveLength(1);
    expect(h.state).toMatchObject({ nodeId: "recap", phase: "rendering", answerAccepted: false });
    expect(Object.values(h.state.conceptEvidence).map(e => e.status)).toEqual(["not_yet"]);
    const identity = h.state.pendingRender!.identity;
    expect(h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity }).effects).toHaveLength(1);
    expect(h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity }).effects).toEqual([]);
    expect(h.send({ type: "clock.tick" }, 1000).effects).toEqual([]);
  },
);
it.each(["Great", "Okay", "Sounds good", "Thanks"])(
  "retains previously accepted closure across %s without reclassification",
  words => {
    const h = harness();
    h.classify();
    const authority = h.state.tutorClosure;
    h.send({ type: "child.turn.started" });
    expect(h.state.conversationAdvanceRequested).toBe(false);
    h.text(`${transcript}\nChild: ${words}`);
    expect(h.state.tutorClosure).toBe(authority);
    h.send({ type: "output.activity", state: "quiet" });
    h.send({ type: "clock.tick" }, 1000);
    expect(h.state.phase).toBe("active"); // Even an acknowledged close cannot bypass live speech.
    expect(h.send({ type: "child.turn.ended" }).state.nodeId).toBe("recap");
  },
);
it.each([
  "Great, but why does that work?",
  "What does exographics mean?",
  "Actually, I meant an engram.",
  "No, I disagree.",
  "Okay?",
  "Great. My answer is different now.",
])("revokes accepted closure on substantive learner text: %s", words => {
  const h = harness();
  h.classify();
  h.learner(words);
  expect(h.state.tutorClosure).toBeNull();
  // A label about the older tutor message cannot override the new learner exchange.
  h.classify(`${transcript}\nChild: ${words}`);
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state).toMatchObject({ phase: "active", conversationAdvanceRequested: false });
});
it("revokes closure when an acknowledgment grows into a correction in later transcript fragments", () => {
  const h = harness();
  h.classify();
  h.send({ type: "child.turn.started" });
  h.text(`${transcript}\nChild: Great`);
  expect(h.state.tutorClosure).not.toBeNull();
  h.text(`${transcript}\nChild: Great, actually I want to change my answer.`);
  h.send({ type: "child.turn.ended" });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state).toMatchObject({ tutorClosure: null, phase: "active", conversationAdvanceRequested: false });
});
it.each([
  ["Sounds", "good"],
  ["Thank", "you"],
])("suspends closure across split acknowledgment %s %s", (first, last) => {
  const h = harness();
  h.classify();
  const authority = h.state.tutorClosure;
  h.send({ type: "child.turn.started" });
  h.text(`${transcript}\nChild: ${first}`);
  h.send({ type: "child.turn.ended" });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state.tutorClosure).toBe(authority);
  expect(h.state).toMatchObject({ phase: "active", conversationAdvanceRequested: false });
  h.text(`${transcript}\nChild: ${first}\nChild: ${last}`);
  expect(h.state.nodeId).toBe("recap");
});
it("does not infer closure from Great after another tutor question", () => {
  const h = harness();
  h.classify();
  const snapshot = `${transcript}\nTutor: Can you give another example?\nChild: Great`;
  h.text(`${transcript}\nTutor: Can you give another example?`, "tutor");
  h.send({ type: "child.turn.started" });
  h.text(snapshot);
  h.send({ type: "child.turn.ended" });
  expect(h.state.tutorClosure).toBeNull();
  h.classify(snapshot, "asking");
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state).toMatchObject({ phase: "active", conversationAdvanceRequested: false });
});
it.each(["transcriptRevision", "childTurnId", "visitId", "nodeId", "runtimeId"] as const)(
  "rejects mismatched classification source %s even with a current acknowledging payload",
  field => {
    const h = harness();
    h.learner("Great");
    const source = classificationSource(h.state)!;
    const stale = { ...source, [field]: typeof source[field] === "number" ? Number(source[field]) - 1 : "stale" };
    h.send({
      type: "proposal.received",
      source: stale,
      proposal: proposal(source),
      transcriptSnapshot: `${transcript}\nChild: Great`,
    });
    expect(h.state).toMatchObject({ tutorClosure: null, conversationAdvanceRequested: false, consumedRevision: null });
  },
);
it("rejects both an earlier revision's proposal and a duplicate proposal", () => {
  const h = harness();
  const earlier = classificationSource(h.state)!;
  h.learner("Great");
  h.send({ type: "proposal.received", source: earlier, proposal: proposal(earlier), transcriptSnapshot: transcript });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.classify(`${transcript}\nChild: Great`);
  const accepted = h.state.tutorClosure;
  h.classify(`${transcript}\nChild: Great`, "asking");
  expect(h.state.tutorClosure).toBe(accepted);
});
it("holds accepted closure through discarded microphone energy and renders once after drain", () => {
  const h = harness();
  h.learner("Great");
  h.classify(`${transcript}\nChild: Great`);
  const authority = h.state.tutorClosure;
  h.send({ type: "child.candidate.started" });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state.phase).toBe("active");
  expect(h.state.tutorClosure).toBe(authority);
  expect(h.send({ type: "child.candidate.discarded" }).effects).toHaveLength(1);
  expect(h.send({ type: "clock.tick" }, 1000).effects).toEqual([]);
});
it("keeps audio that already drained before the learner acknowledgment", () => {
  const h = harness();
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  h.learner("Great");
  expect(h.state.tutorOutputObserved).toBe(true);
  h.classify(`${transcript}\nChild: Great`);
  h.send({ type: "clock.tick" }, 500);
  expect(h.state.nodeId).toBe("recap");
});
it("does not reuse unavailable audio through an acknowledgment", () => {
  const h = harness();
  h.classify();
  h.send({ type: "child.turn.started" });
  h.send({ type: "output.activity", state: "unavailable" });
  h.text(`${transcript}\nChild: Great`);
  h.send({ type: "child.turn.ended" });
  h.send({ type: "output.activity", state: "quiet" });
  h.send({ type: "clock.tick" }, 1000);
  expect(h.state.phase).toBe("active");
});
it("transitions the reported Question 4 exchange through the real scheduler with no further tutor text", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({}, { status: 503 });
      const input = JSON.parse(init!.body as string);
      return Response.json({
        proposal: proposal(input, input.transcript.endsWith("Child: Great.") ? "acknowledging" : "asking"),
      });
    }),
  );
  const events = providerEvents(event => transport.receive!(event));
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    const steering = transport.send.mock.calls.at(-1)![0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    events.acknowledgeSteering(steering.event_id, 0);
    events.childTurn("I don't know.", 100);
    events.tutorTurn(close, 300);
    events.childTurn("Great.", 500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "recap", phase: "rendering", answerAccepted: false });
    const display = runtime.snapshot().display;
    runtime.confirmRendered(display);
    runtime.confirmRendered(display);
    expect(
      transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append"),
    ).toHaveLength(2);
  } finally {
    runtime.stop();
  }
});
