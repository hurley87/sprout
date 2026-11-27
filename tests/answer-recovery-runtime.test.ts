import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  mapConversationObservation,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { LESSON_TIMING, LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
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

const events = providerEvents(event => transport.receive!(event));
const recoveryAppends = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(
      command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"),
    );
const { HIGH } = CONVERSATION_CLASSIFICATION_THRESHOLDS;
let runtime: LessonRuntime;

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  { incorrectScore: HIGH, authored: true, reason: "answerCommitment_no_winner", variant: "incorrect_answer" },
  { incorrectScore: HIGH - 0.01, authored: true, reason: "objectiveState_no_winner", variant: "generic" },
  { incorrectScore: HIGH, authored: false, reason: "answerCommitment_no_winner", variant: "generic" },
])(
  "sends $variant recovery with incorrect score $incorrectScore and authored instruction $authored",
  async ({ incorrectScore, authored, reason, variant }) => {
    const dino = DINO_CAR_CRUNCH_LESSON;
    const lesson = authored ? dino : { ...dino, recovery: { ...dino.recovery, incorrectAnswerInstruction: undefined } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { nodeId, transcriptRevision, transcript } = JSON.parse(init.body as string);
        const { proposal, status, ...diagnostic } = mapConversationObservation(
          { lesson, nodeId, transcriptRevision, transcript },
          {
            objectiveState: {
              choice: "incorrect",
              confidence: incorrectScore,
              probabilities: {
                completed: 0,
                incorrect: incorrectScore,
                unclear_or_incomplete: 1 - incorrectScore,
                unresolved_help: 0,
                no_attempt: 0,
              },
            },
            tutorState: {
              choice: "helping",
              confidence: 1,
              probabilities: { confirmed_completion: 0, clarifying: 0, helping: 1, asking: 0, other: 0 },
            },
            answerCommitment: {
              choice: "committed",
              confidence: 0.75,
              probabilities: { committed: 0.75, unresolved: 0.25, withdrawn: 0, no_answer: 0 },
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
      }),
    );
    runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
    runtime.confirmRendered(runtime.snapshot().display);
    events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
    events.tutorTurn("Three, four, five, six, and then…?", 100);
    events.childTurn("Three, four, five, six.", 300);
    await vi.advanceTimersByTimeAsync(LESSON_TIMING.childSnapshotDebounceMs + ANSWER_RECOVERY_WAIT_MS - 1);
    expect(recoveryAppends()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    const content =
      variant === "incorrect_answer"
        ? lesson.recovery.incorrectAnswerInstruction
        : lesson.recovery.answerRecoveryInstruction;
    expect(recoveryAppends()).toMatchObject([{ content }]);
    expect(runtime.report().events).toContainEqual(
      expect.objectContaining({
        type: "classifier.mapping",
        detail: expect.objectContaining({ decision: "abstained", reason }),
      }),
    );
    expect(runtime.report().events).toContainEqual(
      expect.objectContaining({
        type: "gpt_live.answer_recovery_append",
        detail: expect.objectContaining({ variant, content }),
      }),
    );
    expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", nodeId: "warm-up", answerAccepted: false });
  },
);
