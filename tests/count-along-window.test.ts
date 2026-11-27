import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { latestChildNumber } from "../lib/lesson-runtime/spoken-number";
import { classifierProposal } from "./helpers/runtime-classifier";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  suspendInput: vi.fn(),
  resumeInput: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
const definition = { ...DINO_CAR_CRUNCH_LESSON, countAlong: true as const };
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
let runtime: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  fetchMock = vi.fn(async (_url: unknown, init: RequestInit) =>
    Response.json({
      proposal: classifierProposal(JSON.parse(init.body as string), { answerOutcome: "none", tutorState: "asking" }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function start(lesson: LessonDefinition = definition) {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
  events.tutorTurn("How many?", 100);
}
const journal = () => runtime.report().events;

it("validates opt in and refuses unavailable or invalid windows", () => {
  expect(() => validateLessonDefinition({ ...definition, countAlong: false } as never)).toThrow("countAlong");
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  expect(runtime.beginCountAlong("test", 100)).toBe(false);
  start({ ...definition, countAlong: undefined });
  expect(runtime.beginCountAlong("test", 100)).toBe(false);
  start();
  for (const duration of [0, -1, 15001, Infinity, NaN]) expect(runtime.beginCountAlong("test", duration)).toBe(false);
  expect(runtime.beginCountAlong("test", 100)).toBe(true);
  expect(runtime.beginCountAlong("again", 100)).toBe(false);
  expect(journal().filter(e => e.type === "count_along.refused")).toHaveLength(6);
});

it("keeps each child turn and judges only after closing", async () => {
  start();
  expect(runtime.beginCountAlong("drops", 3000)).toBe(true);
  events.childTurn("One.", 300);
  await vi.advanceTimersByTimeAsync(900);
  events.childTurn("Two.", 1300);
  await vi.advanceTimersByTimeAsync(900);
  events.childTurn("Three.", 2300);
  await vi.advanceTimersByTimeAsync(1199);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(transport.suspendInput).not.toHaveBeenCalled();
  expect(journal().filter(e => e.type === "runtime.event.child.turn.ended")).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(301);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.transcript).toContain("Child: One.");
  expect(body.transcript).toContain("Child: Two.");
  expect(body.transcript).toContain("Child: Three.");
  expect(latestChildNumber(body.transcript)).toMatchObject({ status: "number", value: 3 });
  expect(latestChildNumber("Child: One. Two. Three.")).toMatchObject({ status: "number", value: 3 });
  expect(runtime.snapshot().countAlong).toBeNull();
});

it("cancels an in-flight classification and ignores its late result", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>(r => {
        resolve = r;
      }),
  );
  start();
  events.childTurn("One.", 300);
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(runtime.beginCountAlong("drops", 1000)).toBe(true);
  resolve(
    Response.json({
      proposal: classifierProposal(request, {
        answerOutcome: "correct",
        answerCommitment: "committed",
        tutorState: "acknowledging",
      }),
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().runtime?.answerAccepted).toBe(false);
  expect(journal().some(e => e.type === "classifier.cancelled")).toBe(true);
});

it("restarts silence and reply waits after the window", async () => {
  start({
    ...definition,
    silenceNudges: [{ afterQuietMs: 3000, instruction: "SILENCE" }],
    replyNudge: { afterQuietMs: 3000, instruction: "REPLY" },
  });
  await vi.advanceTimersByTimeAsync(2500);
  runtime.beginCountAlong("drops", 5000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("nudge"))).toBe(false);
  await vi.advanceTimersByTimeAsync(2999);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("nudge"))).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("silence-nudge"))).toBe(true);
});

it("closes on skip or stop and clears the old timer", async () => {
  start();
  await vi.advanceTimersByTimeAsync(2500);
  runtime.beginCountAlong("first", 5000);
  runtime.skipScene();
  expect(runtime.snapshot().countAlong).toBeNull();
  expect(journal().find(e => e.type === "count_along.ended")?.detail).toMatchObject({ reason: "scene_skipped" });
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 2000);
  expect(runtime.beginCountAlong("second", 10000)).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().countAlong?.name).toBe("second");
  runtime.stop();
  expect(runtime.snapshot().countAlong).toBeNull();
  expect(
    journal()
      .filter(e => e.type === "count_along.ended")
      .at(-1)?.detail,
  ).toMatchObject({ reason: "stop" });
});

it.each(["correct", "incorrect"] as const)("judges a %s final answer only after closing", async outcome => {
  const lesson = {
    ...definition,
    trackDifficulties: true as const,
    nodes: {
      ...definition.nodes,
      "warm-up": {
        ...definition.nodes["warm-up"],
        presentation: { ...definition.nodes["warm-up"].presentation, answer: 3 },
      },
    },
  };
  fetchMock.mockImplementation(async (_url, init) =>
    Response.json({
      proposal: classifierProposal(JSON.parse(init.body as string), {
        answerOutcome: outcome,
        answerCommitment: "committed",
        tutorState: "asking",
      }),
    }),
  );
  start(lesson);
  runtime.beginCountAlong("drops", 3000);
  events.childTurn("One.", 300);
  events.childTurn("Two.", 500);
  events.childTurn(outcome === "correct" ? "Three." : "Four.", 700);
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.difficulties).toEqual([]);
  await vi.advanceTimersByTimeAsync(301);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(runtime.snapshot().runtime?.answerAccepted).toBe(outcome === "correct");
  expect(runtime.snapshot().runtime?.difficulties).toHaveLength(outcome === "incorrect" ? 1 : 0);
});

it("waits for a turn still in progress when the window closes", async () => {
  start();
  runtime.beginCountAlong("drops", 1000);
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "One two three", startMs: 300, endMs: 400 });
  await vi.advanceTimersByTimeAsync(1500);
  expect(fetchMock).not.toHaveBeenCalled();
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not count the window toward a reply nudge", async () => {
  start({ ...definition, replyNudge: { afterQuietMs: 3000, instruction: "REPLY" } });
  runtime.beginCountAlong("drops", 5000);
  events.childTurn("Three.", 300);
  await vi.advanceTimersByTimeAsync(5000);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("reply-nudge"))).toBe(false);
  await vi.advanceTimersByTimeAsync(2999);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("reply-nudge"))).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.send.mock.calls.some(([c]) => c.event_id.includes("reply-nudge"))).toBe(true);
});

it("leaves an unflagged lesson's normal classification unchanged", async () => {
  start({ ...definition, countAlong: undefined });
  expect(runtime.snapshot()).not.toHaveProperty("countAlong");
  events.childTurn("Seven.", 300);
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not classify tutor output or request recovery during the window", async () => {
  start();
  runtime.beginCountAlong("replay", 10000);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  events.tutorTurn("One, two, three!", 500);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(transport.send.mock.calls.some(([c]) => /answer-recovery|reply-nudge|clarify/.test(c.event_id))).toBe(false);
});

it("restarts missing-transcript recovery after a wordless count", async () => {
  start();
  runtime.beginCountAlong("drops", 5000);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(journal().some(e => e.type === "answer_recovery.requested")).toBe(false);
  await vi.advanceTimersByTimeAsync(3999);
  expect(journal().some(e => e.type === "answer_recovery.requested")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(journal().some(e => e.type === "answer_recovery.requested")).toBe(true);
});

it("refuses a window during rendering and closes on disconnect", async () => {
  start();
  await vi.advanceTimersByTimeAsync(2500);
  runtime.skipScene();
  expect(runtime.beginCountAlong("rendering", 1000)).toBe(false);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 3000);
  expect(runtime.beginCountAlong("connected", 1000)).toBe(true);
  emit({ type: "session.closed" });
  expect(runtime.snapshot().countAlong).toBeNull();
  expect(
    journal()
      .filter(e => e.type === "count_along.ended")
      .at(-1)?.detail,
  ).toMatchObject({ reason: "disconnect" });
});

it("does not revive an old scheduled answer when no speech occurs during the window", async () => {
  start();
  events.childTurn("Seven.", 300);
  runtime.beginCountAlong("silent replay", 1000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).not.toHaveBeenCalled();
});
