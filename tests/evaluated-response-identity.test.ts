import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { TRANSCRIPT_FALLBACK_MS, type AnswerResult, type EvaluateAnswer } from "../lib/answer";
import { LessonSession, type Transport } from "../lib/session";
import type { Evidence, TimelineEvent, SessionRecorder } from "../lib/session-recorder";
import { TranscriptWindow, WINDOW_CHARS, UtteranceAccumulator } from "../lib/transcript";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function recorded(evaluate: EvaluateAnswer) {
  vi.useFakeTimers();
  const events: { eventKey: string; atMs: number; evidence?: Evidence; timeline?: TimelineEvent }[] = [];
  const recorder: SessionRecorder = {
    create: async () => "synthetic",
    activate: async () => {},
    append: async (eventKey, atMs, evidence) => {
      events.push({ eventKey, atMs, evidence: structuredClone(evidence) });
    },
    appendTimeline: async (eventKey, atMs, timeline) => {
      events.push({ eventKey, atMs, timeline: structuredClone(timeline) });
    },
    attachRecording: async () => {},
    markIncomplete: async () => {},
    finalize: async () => {},
  };
  const transport: Transport = {
    start: async () => {},
    send: () => {},
    setOutputBlocked: () => {},
    stopMedia: () => {},
    close: () => {},
  };
  const session = new LessonSession(transport, evaluate, () => {}, undefined, recorder);
  await session.start();
  session.receive({ type: "session.started" });
  session.displayed(0);
  const say = (delta: string, startMs: number, sourceId?: number) =>
    session.receive({
      type: "transcript",
      speaker: "child",
      delta,
      startMs,
      endMs: startMs + 100,
      ...(sourceId === undefined ? {} : { sourceId }),
    });
  const controls = () =>
    events.flatMap(event => (event.timeline?.type === "evaluation_control" ? [event.timeline] : []));
  const speech = () => events.flatMap(event => (event.evidence?.type === "utterance" ? [event.evidence] : []));
  const persist = async () => {
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    const sessionId = await t.mutation(api.sessions.create, {});
    await t.mutation(api.sessions.activate, { sessionId });
    for (const event of events) await t.mutation(api.sessions.appendEvent, { sessionId, ...event });
    const saved = await t.query(api.sessions.getRecord, { sessionId });
    expect(
      saved?.events.map(({ eventKey, atMs, evidence, timeline }) => ({ eventKey, atMs, evidence, timeline })),
    ).toEqual(events.map(event => ({ evidence: undefined, timeline: undefined, ...event })));
  };
  return { session, events, say, controls, speech, persist };
}

it("retains original and superseded identities when adjacent fragments change source, including late results and persistence", async () => {
  const pending: Array<(result: AnswerResult) => void> = [];
  const f = await recorded(() => new Promise(resolve => pending.push(resolve)));
  f.say("One", 100, 1);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + 1);
  f.say(" no, Two", 200, 2);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + 1);
  pending[0]({ status: "evaluated", probability: 1, model: "late", latencyMs: 1 });
  pending[1]({ status: "unavailable", reason: "synthetic", latencyMs: 1 });
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  expect(f.controls().find(e => e.action === "superseded")).toMatchObject({
    sourceId: 1,
    transcriptRevision: 1,
    correlationKey: "0|1|100:One|1",
    responseIdentity: { sourceStatus: "known", fragmentKeys: ["transcript_1"] },
  });
  expect(f.controls().find(e => e.action === "result_superseded")).toMatchObject({
    sourceId: 1,
    correlationKey: "0|1|100:One|1",
    responseIdentity: { fragmentKeys: ["transcript_1"] },
  });
  expect(f.controls().find(e => e.action === "evaluation_result")).toMatchObject({
    sourceId: 2,
    transcriptRevision: 2,
    answerVersion: "100:One no, Two",
    responseIdentity: { sourceStatus: "mixed", fragmentKeys: ["transcript_1", "transcript_2"] },
  });
  expect(f.controls().find(e => e.action === "result_superseded")?.responseIdentity?.recognitionContext).toMatchObject({
    recovery: "instructional_support",
    recognition: "no_ambiguity_detected",
  });
  expect(f.controls().find(e => e.action === "evaluation_result")?.responseIdentity?.recognitionContext).toMatchObject({
    recognition: "needs_confirmation",
  });
  const speech = f.events.flatMap(e => (e.evidence?.type === "utterance" ? [e.evidence] : []));
  expect(speech.map(e => [e.text, e.providerTiming?.sourceId, e.transcriptFragments?.map(f => f.key)])).toEqual([
    ["One", 1, ["transcript_1"]],
    [" no, Two", 2, ["transcript_2"]],
  ]);
  expect(speech.map(e => e.recognition)).toEqual(["no_ambiguity_detected", "needs_confirmation"]);
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("preserves a missing provider identity through transcript corrections and persistence", async () => {
  const f = await recorded(async () => ({ status: "unavailable", reason: "synthetic", latencyMs: 1 }));
  f.say("Two", 100);
  await vi.advanceTimersByTimeAsync(100);
  f.say(" no, One", 200);
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  const result = f.controls().find(e => e.action === "evaluation_result")!;
  expect(result).toMatchObject({
    correlationKey: "0|2|100:Two no, One|unknown-source",
    transcriptRevision: 2,
    responseIdentity: { sourceStatus: "missing", fragmentKeys: ["transcript_1", "transcript_2"] },
  });
  expect(result.sourceId).toBeUndefined();
  const response = f.events.find(e => e.evidence?.type === "utterance")!.evidence;
  expect(response?.type === "utterance" && response.sessionTiming).toBeUndefined();
  expect(response?.type === "utterance" && response.recognition).toBe("needs_confirmation");
  expect(result.responseIdentity?.recognitionContext?.recognition).toBe("needs_confirmation");
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("retains repeated-answer recognition when advancement clears confirmation before durable flush", async () => {
  let calls = 0;
  const f = await recorded(async () => ({
    status: "evaluated",
    probability: ++calls === 1 ? 0.01 : 0.99,
    model: "synthetic",
    latencyMs: 1,
  }));
  f.say("Eight", 100, 1);
  await vi.advanceTimersByTimeAsync(2000);
  f.say("Eight", 5000, 1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.displayed(1);
  await f.session.recordingSettled();
  expect(f.speech().map(e => e.recognition)).toEqual(["needs_confirmation"]);
  await vi.advanceTimersByTimeAsync(600);
  await f.session.recordingSettled();
  expect(f.speech().map(e => e.recognition)).toEqual(["needs_confirmation", "no_ambiguity_detected"]);
  const revision = f
    .controls()
    .find(e => e.action === "application_outcome_released" && e.applicationAction === "ADVANCE")!;
  expect(revision.responseIdentity).toMatchObject({
    fragmentKeys: ["transcript_2"],
    evaluatedScene: { sceneId: "hello-duck" },
    recognitionContext: {
      provenance: "application_text_policy",
      repeatedTotal: 8,
      recognition: "no_ambiguity_detected",
    },
  });
  expect(f.speech()[1].responseScene).toMatchObject({ sceneId: "hello-duck", status: "stable" });
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("a correction cannot corroborate itself or borrow confidence from a superseded evaluation", async () => {
  const pending: Array<(result: AnswerResult) => void> = [];
  const f = await recorded(() => new Promise(resolve => pending.push(resolve)));
  f.say("Eight", 100, 1);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + 1);
  f.say(" no, One", 200, 1);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + 1);
  pending[0]({ status: "evaluated", probability: 1, model: "late", latencyMs: 1 });
  pending[1]({ status: "evaluated", probability: 0.01, model: "current", latencyMs: 1 });
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  expect(f.speech()).toMatchObject([{ text: "Eight no, One", recognition: "needs_confirmation" }]);
  expect(f.controls().find(e => e.action === "result_superseded")?.responseIdentity).toMatchObject({
    fragmentKeys: ["transcript_1"],
    recognitionContext: { recognition: "needs_confirmation" },
  });
  expect(f.controls().find(e => e.action === "evaluation_result")?.responseIdentity).toMatchObject({
    fragmentKeys: ["transcript_1", "transcript_2"],
    recognitionContext: { recovery: "clarification", recognition: "needs_confirmation" },
  });
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("a punctuation revision after clarification release does not count as a new repeated answer", async () => {
  const f = await recorded(async () => ({ status: "evaluated", probability: 0.01, model: "synthetic", latencyMs: 1 }));
  f.say("Eight", 100, 1);
  await vi.advanceTimersByTimeAsync(2000);
  f.say(".", 200, 1);
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  expect(f.speech()).toMatchObject([{ text: "Eight.", recognition: "needs_confirmation" }]);
  const revision = f.controls().find(e => e.action === "evaluation_result" && e.transcriptRevision === 2)!;
  expect(revision.responseIdentity?.recognitionContext).toEqual({
    provenance: "application_text_policy",
    recovery: "clarification",
    recognition: "needs_confirmation",
  });
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("retains a clear complete count revision independently of the several evaluations joined to one utterance", async () => {
  const f = await recorded(async () => ({ status: "unavailable", reason: "synthetic", latencyMs: 1 }));
  f.say("One, ", 100, 1);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + 1);
  f.say("two", 200, 1);
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  expect(f.speech()).toMatchObject([{ text: "One, two", recognition: "no_ambiguity_detected" }]);
  expect(
    f
      .controls()
      .filter(e => e.action === "evaluation_result")
      .map(e => e.responseIdentity?.fragmentKeys),
  ).toEqual([["transcript_1"], ["transcript_1", "transcript_2"]]);
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("retains uncertainty for unevaluated transition speech even when its isolated number is clear", async () => {
  const f = await recorded(async () => ({ status: "evaluated", probability: 1, model: "synthetic", latencyMs: 1 }));
  f.say("One", 100, 1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.say("Two", 5000, 1);
  await vi.advanceTimersByTimeAsync(3000);
  await f.session.recordingSettled();
  expect(f.speech()).toMatchObject([
    { text: "One", recognition: "no_ambiguity_detected" },
    { text: "Two", recognition: "needs_confirmation" },
  ]);
  expect(f.controls().filter(e => e.action === "evaluation_started")).toHaveLength(1);
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
});

it("does not clarify full canonical text using a truncated window or a different display of the same scene", () => {
  const accumulator = new UtteranceAccumulator();
  const context = {
    providerTiming: { clock: "provider" as const, startMs: 0, endMs: 100, sourceId: 1 },
    responseScene: {
      provenance: "application_transcript_context" as const,
      sceneId: "ducks",
      displayedAtMs: 0,
      status: "stable" as const,
    },
    recognition: "needs_confirmation" as const,
  };
  accumulator.append("Unclear. ", 0, 100, true, 100, context, "first");
  accumulator.append("One", 100, 200, true, 200, context, "second");
  expect(
    accumulator.retainRecognition(
      { text: "One", startMs: 0, fragments: [{ key: "second", sourceId: 1 }], fragmentsComplete: true },
      "no_ambiguity_detected",
    ),
  ).toBe("needs_confirmation");
  accumulator.append(
    "Two",
    200,
    300,
    true,
    300,
    { ...context, responseScene: { ...context.responseScene, displayedAtMs: 150 } },
    "third",
  );
  const full = {
    text: "Unclear. OneTwo",
    startMs: 0,
    fragments: ["first", "second", "third"].map(key => ({ key, sourceId: 1 })),
    fragmentsComplete: true,
  };
  expect(accumulator.retainRecognition(full, "no_ambiguity_detected")).toBe("needs_confirmation");
  expect(accumulator.take()?.context).toMatchObject({
    recognition: "needs_confirmation",
    responseScene: { status: "changed" },
  });
});

it("drops only fragments outside the bounded answer window and resets joins at a new utterance", () => {
  const window = new TranscriptWindow();
  window.append("One", 0, 100, { key: "first", sourceId: 1 });
  window.append("x".repeat(WINDOW_CHARS - 1), 100, 200, { key: "middle", sourceId: 1 });
  expect(window.append("Two", 200, 300, { key: "last", sourceId: 1 }).fragments).toEqual([
    { key: "middle", sourceId: 1 },
    { key: "last", sourceId: 1 },
  ]);
  expect(window.append("Three", 5000, 5100, { key: "next", sourceId: 2 }).fragments).toEqual([
    { key: "next", sourceId: 2 },
  ]);
  const incomplete = new TranscriptWindow();
  incomplete.append("One", 0, 100);
  expect(incomplete.append(" no, Two", 100, 200, { key: "captured", sourceId: 2 })).toMatchObject({
    fragments: [{ key: "captured", sourceId: 2 }],
    fragmentsComplete: false,
  });
});
