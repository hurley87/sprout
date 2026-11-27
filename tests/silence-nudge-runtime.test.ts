import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  mapConversationObservation,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { EFFECT_TAIL_MS, LESSON_TIMING, LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { classifierProposal } from "./helpers/runtime-classifier";
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

const lesson: LessonDefinition = {
  ...DINO_CAR_CRUNCH_LESSON,
  silenceNudges: [
    { afterQuietMs: 7_000, instruction: "NUDGE ONE" },
    { afterQuietMs: 12_000, instruction: "NUDGE TWO" },
  ],
};
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const appends = (kind: string) =>
  transport.send.mock.calls.flatMap(([command]) =>
    command.type === "session.instructions.append" && command.event_id.includes(`:${kind}:`) ? [command.content] : [],
  );
const nudges = () => appends("silence-nudge");
const replyAppends = () => appends("reply-nudge");
const dinoReply = DINO_CAR_CRUNCH_LESSON.replyNudge!;
let runtime: LessonRuntime;

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) =>
      Response.json({
        proposal: classifierProposal(JSON.parse(init.body as string), {
          answerOutcome: "none",
          tutorState: "asking",
        }),
      }),
    ),
  );
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function start(definition = lesson) {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
  events.tutorTurn("This is Rex! How many cars can Rex eat?", 100);
}

it("re-asks a silent learner, then checks in once, then stays quiet", async () => {
  start();
  await vi.advanceTimersByTimeAsync(6_999);
  expect(nudges()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE"]);

  events.tutorTurn("You can tell Rex out loud! How many cars?", 8_000);
  await vi.advanceTimersByTimeAsync(11_999);
  expect(nudges()).toEqual(["NUDGE ONE"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE", "NUDGE TWO"]);

  events.tutorTurn("Are you still there?", 21_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual(["NUDGE ONE", "NUDGE TWO"]);
  expect(runtime.report().events.map(event => event.type)).toEqual(
    expect.arrayContaining(["silence_nudge.scheduled", "silence_nudge.requested", "gpt_live.silence_nudge_append"]),
  );
});

it("does not nudge a learner who answers", async () => {
  start();
  await vi.advanceTimersByTimeAsync(3_000);
  events.childTurn("seven", 3_200);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});

it("is not pushed back by repeated discarded microphone bursts", async () => {
  // The Nov 27 test session: room-noise bursts every few seconds each restarted the old 7 s wait,
  // delaying the first nudge from ~11 s to 30 s.
  start();
  const quietAt = performance.now();
  for (const atMs of [2_000, 4_000, 5_000]) {
    await vi.advanceTimersByTimeAsync(quietAt + atMs - performance.now());
    emit({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(200);
    emit({ type: "microphone.activity_discarded" });
  }
  await vi.advanceTimersByTimeAsync(quietAt + 6_999 - performance.now());
  expect(nudges()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE"]);
});

it("cancels a pending nudge when the lesson stops", async () => {
  start();
  await vi.advanceTimersByTimeAsync(5_000);
  runtime.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});

it("leaves lessons without authored nudges unchanged", async () => {
  start({ ...lesson, silenceNudges: undefined });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});

it("requests a reply once when the child answers and the tutor stays silent", async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ proposal: null }));
  start();
  events.childTurn("Three, four, five, six.", 300);

  await vi.advanceTimersByTimeAsync(dinoReply.afterQuietMs - 1);
  expect(replyAppends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(replyAppends()).toEqual([dinoReply.instruction]);
  events.childTurn("Five, six.", 7_000);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(replyAppends()).toEqual([dinoReply.instruction]);
  expect(nudges()).toEqual([]);
  expect(runtime.report().events.map(event => event.type)).toEqual(
    expect.arrayContaining([
      "classifier.abstained",
      "reply_nudge.scheduled",
      "reply_nudge.requested",
      "gpt_live.reply_nudge_append",
    ]),
  );
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", nodeId: "warm-up", answerAccepted: false });
});

it.each([
  { reason: "the tutor replies", interrupt: () => events.tutorTurn("What comes after six?", 3_500) },
  { reason: "the session stops", interrupt: () => runtime.stop() },
])("cancels a pending reply nudge when $reason", async ({ interrupt }) => {
  start();
  events.childTurn("Three, four, five, six.", 300);
  await vi.advanceTimersByTimeAsync(3_000);
  interrupt();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(replyAppends()).toEqual([]);
  expect(runtime.report().events.map(event => event.type)).toContain("reply_nudge.cancelled");
});

it("cancels a pending reply nudge when a skip commits a new visit", async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ proposal: null }));
  start();
  emit({ type: "output.activity", state: "active" });
  events.childTurn("Three, four, five, six.", 300);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(3_000);

  runtime.skipScene();
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "twenty-three" });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(replyAppends()).toEqual([]);
  expect(runtime.report().events.map(event => event.type)).toContain("reply_nudge.cancelled");
});

it("holds a reply nudge while a page sound effect is active", async () => {
  start();
  events.childTurn("Three, four, five, six.", 300);
  await vi.advanceTimersByTimeAsync(dinoReply.afterQuietMs - 500);
  expect(runtime.beginEffect("test sound", 1_000)).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000 + EFFECT_TAIL_MS - 1);
  expect(replyAppends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(2);
  expect(replyAppends()).toEqual([dinoReply.instruction]);
});

it("waits for pending answer recovery and starts a fresh interval after its send", async () => {
  const definition = { ...lesson, replyNudge: { ...dinoReply, afterQuietMs: 3_000 } };
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const { nodeId, transcriptRevision, transcript } = JSON.parse(init!.body as string);
    const { proposal, status, ...diagnostic } = mapConversationObservation(
      { lesson: definition, nodeId, transcriptRevision, transcript },
      {
        objectiveState: {
          choice: "incorrect",
          confidence: 1,
          probabilities: { completed: 0, incorrect: 1, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
        },
        tutorState: {
          choice: "asking",
          confidence: 1,
          probabilities: { confirmed_completion: 0, clarifying: 0, helping: 0, asking: 1, other: 0 },
        },
        answerCommitment: {
          choice: "committed",
          confidence: 1,
          probabilities: { committed: 1, unresolved: 0, withdrawn: 0, no_answer: 0 },
        },
      },
    );
    return Response.json({
      proposal,
      diagnostic: {
        ...diagnostic,
        decision: status,
        classifierVersion: CLASSIFIER_VERSION,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId,
        transcriptRevision,
        elapsedMs: 0,
      },
    });
  });
  start(definition);
  events.childTurn("Three, four, five, six.", 300);
  const recoveryDeadline = LESSON_TIMING.childSnapshotDebounceMs + ANSWER_RECOVERY_WAIT_MS;
  await vi.advanceTimersByTimeAsync(recoveryDeadline - 1);
  expect(appends("answer-recovery")).toEqual([]);
  expect(replyAppends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(appends("answer-recovery")).toEqual([definition.recovery.incorrectAnswerInstruction]);
  await vi.advanceTimersByTimeAsync(definition.replyNudge.afterQuietMs - 1);
  expect(replyAppends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(replyAppends()).toEqual([dinoReply.instruction]);
});

it("spends the reply nudge when the send fails", async () => {
  start();
  transport.send.mockImplementationOnce(() => {
    throw new Error("Transport closed");
  });
  events.childTurn("Three, four, five, six.", 300);
  await vi.advanceTimersByTimeAsync(dinoReply.afterQuietMs);
  expect(runtime.report().events.map(event => event.type)).toContain("reply_nudge.send_failed");

  events.childTurn("Five, six.", 7_000);
  await vi.advanceTimersByTimeAsync(dinoReply.afterQuietMs);
  expect(replyAppends()).toEqual([dinoReply.instruction]);
});

it("leaves lessons without an authored reply nudge unchanged after a child turn", async () => {
  start({ ...lesson, replyNudge: undefined });
  events.childTurn("Three, four, five, six.", 300);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(replyAppends()).toEqual([]);
  expect(runtime.report().events.map(event => event.type)).not.toContain("reply_nudge.scheduled");
});
