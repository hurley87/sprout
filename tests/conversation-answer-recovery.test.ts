import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { answerRecoveryInstruction } from "../lib/lesson-runtime/live-context";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
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
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const recoveries = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(
      command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"),
    );
let runtime: LessonRuntime;
let closure = false;
beforeEach(async () => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  closure = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(init?.body as string);
      return Response.json({
        proposal: classifierProposal(input, {
          answerOutcome: "unclear",
          tutorState: closure ? "acknowledging" : "unknown",
          conceptObservations: [{ criterionId: "widespread-literacy", observation: "partial", childMessageIndex: 0 }],
        }),
      });
    }),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, {
    ...lesson,
    initialNodeId: "techno-literate-culture",
  });
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  emit({ type: "output.activity", state: "quiet" });
});
afterEach(() => {
  runtime.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function missingTurn() {
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}
async function capturedDiscussion() {
  events.childTurn("Most people can read and write; some specialize in discovering ideas.", 100);
  await vi.advanceTimersByTimeAsync(300);
  events.tutorTurn("That covers the piece well. Anything else to add?", 300);
  events.childTurn("Nope", 500);
  events.tutorTurn("Okay, thanks.", 700);
  // Deliberately unknown observer closure, as in the human export: conversational
  // closure is available to the voice model but has not authorized runtime completion.
  await vi.advanceTimersByTimeAsync(600);
}
it("does not let delayed recovery reopen captured discussion or infer mastery from thanks/nope", async () => {
  await capturedDiscussion();
  const evidence = structuredClone(runtime.snapshot().runtime!.conceptEvidence);
  missingTurn();
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(1);
  const request = recoveries()[0];
  if (request.type !== "session.instructions.append") throw new Error("Expected recovery");
  expect(request.content).toContain("Earlier learner answers are captured");
  expect(request.content).toContain("If the discussion already closed, acknowledge and pause without reopening it");
  expect(request.content).toContain("If they say they already answered, use the captured conversation");
  expect(request.content).toContain("superseded by new learner words");
  expect(request.content).not.toContain("invite them to try their answer again");
  expect(Buffer.byteLength(request.content)).toBeLessThanOrEqual(1000);
  events.childTurn("I've already answered", 900);
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(1);
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "techno-literate-culture",
    phase: "active",
    conversationAdvanceRequested: false,
  });
  expect(runtime.snapshot().runtime!.conceptEvidence).toEqual(evidence);
});
it("suppresses recovery when the closure recheck actually authorizes completion", async () => {
  await capturedDiscussion();
  const evidence = structuredClone(runtime.snapshot().runtime!.conceptEvidence);
  closure = true;
  missingTurn();
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(0);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "caf-application", phase: "rendering" });
  expect(runtime.snapshot().runtime!.conceptEvidence).toEqual(evidence);
});
it.each([3999, 4001])("handles new transcript at %i ms around recovery dispatch", async delay => {
  missingTurn();
  await vi.advanceTimersByTimeAsync(delay);
  // Late ASR for the same confirmed turn, without another microphone onset.
  emit({ type: "transcript", speaker: "child", delta: "Most people can read and write.", startMs: 100, endMs: 200 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(delay < 4000 ? 0 : 1);
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "techno-literate-culture",
    hasChildTranscript: true,
    conversationAdvanceRequested: false,
  });
  expect(runtime.snapshot().runtime!.conceptEvidence["techno-literate-culture:widespread-literacy"].status).toBe(
    "partial",
  );
});
it("honors navigation arriving during recovery wait and drains audio before advancing", async () => {
  missingTurn();
  await vi.advanceTimersByTimeAsync(3999);
  emit({ type: "output.activity", state: "active" });
  events.childTurn("Yep, next question", 100);
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(0);
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "techno-literate-culture",
    conversationAdvanceRequested: "learner",
  });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "caf-application", phase: "rendering" });
});
it("still checks a genuinely missing answer once without advancing", async () => {
  missingTurn();
  await vi.advanceTimersByTimeAsync(10000);
  expect(recoveries()).toHaveLength(1);
  expect(recoveries()[0]).toMatchObject({ content: expect.stringContaining("No learner answer is captured") });
  expect(recoveries()[0]).toMatchObject({
    content: expect.stringContaining("Only invite a missing answer if the question remains unanswered"),
  });
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "techno-literate-culture",
    phase: "active",
    conversationAdvanceRequested: false,
    conceptEvidence: {},
  });
  const instruction = answerRecoveryInstruction(
    lesson,
    createLessonRuntime("no-answer", { lesson }),
    "Child: Nope\nTutor: Thanks.",
  );
  expect(instruction).toContain("No learner answer is captured");
});
