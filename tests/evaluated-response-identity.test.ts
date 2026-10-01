import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { TRANSCRIPT_FALLBACK_MS, type AnswerResult, type EvaluateAnswer } from "../lib/answer";
import { LessonSession, type Transport } from "../lib/session";
import type { Evidence, TimelineEvent, SessionRecorder } from "../lib/session-recorder";
import { TranscriptWindow, WINDOW_CHARS } from "../lib/transcript";

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
  return { session, events, say, controls, persist };
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
  const speech = f.events.flatMap(e => (e.evidence?.type === "utterance" ? [e.evidence] : []));
  expect(speech.map(e => [e.text, e.providerTiming?.sourceId, e.transcriptFragments?.map(f => f.key)])).toEqual([
    ["One", 1, ["transcript_1"]],
    [" no, Two", 2, ["transcript_2"]],
  ]);
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
  await f.persist();
  f.session.end("parent_stop");
  await f.session.recordingSettled();
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
