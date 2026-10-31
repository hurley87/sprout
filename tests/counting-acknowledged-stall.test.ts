import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import {
  classificationSource,
  runtimeSource,
  type ClassificationSource,
  type LessonRuntimeState,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import {
  createReducerHarness,
  prepareLearnerClassification,
  providerEvents,
  useRuntimeFakeTimers,
} from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

const lesson = { ...COUNTING_LESSON, initialNodeId: "count-3-ducklings" };
type Step = { atMs: number; label?: string; event: ProviderEvent };
const say =
  (speaker: "sprout" | "child") =>
  (delta: string, startMs: number): ProviderEvent => ({
    type: "transcript",
    speaker,
    delta,
    startMs,
    endMs: startMs + 200,
  });
const tutor = say("sprout");
const child = say("child");
const output = (state: "active" | "quiet"): ProviderEvent => ({ type: "output.activity", state });

/** Scene 4 of sprout-lesson-37b847a9 (real microphone), relative to its steering
 * acknowledgment. Provider transcript intervals and local microphone/PCM timings
 * are kept; tutor fragments are merged where no gate observes the split. */
function exportTimeline(answer = "Three"): Step[] {
  return [
    { atMs: 1046, event: tutor("See the little ducklings paddling in a line?", 60400) },
    { atMs: 2415, event: output("active") },
    { atMs: 3265, event: output("quiet") },
    { atMs: 3404, event: tutor(" How many ducklings are there?", 62800) },
    { atMs: 3416, event: output("active") },
    { atMs: 6565, event: output("quiet") },
    { atMs: 7349, event: { type: "microphone.activity_started" } },
    { atMs: 7432, event: { type: "microphone.speech_started" } },
    { atMs: 8575, event: { type: "microphone.speech_stopped", quietMs: 900 } },
    { atMs: 8593, event: child(answer, 69000) },
    { atMs: 9133, event: tutor("Yes,", 69800) },
    { atMs: 9460, event: tutor(" three ducks!", 70200) },
    { atMs: 10075, event: output("active") },
    { atMs: 10345, event: tutor(" The parade", 71000) },
    { atMs: 10416, event: output("quiet") },
    { atMs: 10665, event: output("active") },
    { atMs: 10870, event: tutor(" is ready to splash.", 71600) },
    { atMs: 11115, event: output("quiet") },
    { atMs: 11166, event: output("active") },
    { atMs: 11365, event: output("quiet") },
    { atMs: 11516, event: output("active") },
    { atMs: 11565, event: output("quiet") },
    { atMs: 11615, event: output("active") },
    { atMs: 12615, event: output("quiet") },
    { atMs: 12666, event: output("active") },
    { atMs: 13115, event: output("quiet") },
    // Short microphone bursts while the acknowledged snapshot is being classified.
    { atMs: 13649, label: "first-candidate", event: { type: "microphone.activity_started" } },
    { atMs: 13825, label: "first-discard", event: { type: "microphone.activity_discarded" } },
    { atMs: 14684, label: "second-candidate", event: { type: "microphone.activity_started" } },
    { atMs: 14858, event: { type: "microphone.activity_discarded" } },
    { atMs: 15649, label: "third-candidate", event: { type: "microphone.activity_started" } },
    // Two confirmed ~1 s turns for which GPT-Live never produced any transcript.
    { atMs: 15733, event: { type: "microphone.speech_started" } },
    { atMs: 16699, event: { type: "microphone.speech_stopped", quietMs: 900 } },
    { atMs: 20574, event: { type: "microphone.activity_started" } },
    { atMs: 20658, event: { type: "microphone.speech_started" } },
    { atMs: 21616, label: "textless-ended", event: { type: "microphone.speech_stopped", quietMs: 900 } },
  ];
}

type ClassifyBody = { nodeId: string; transcriptRevision: number; transcript: string };
/** Deterministic test double: judges the latest child answer for three ducklings. */
function judge(body: ClassifyBody) {
  const lines = body.transcript.split("\n");
  const answer = lines
    .findLast(line => line.startsWith("Child: "))
    ?.slice(7)
    .trim()
    .toLowerCase();
  const last = lines.at(-1) ?? "";
  return {
    proposal: classifierProposal(body, {
      answerOutcome: answer === "three" ? "correct" : "incorrect",
      answerCommitment: "committed",
      tutorState: last.startsWith("Tutor: Yes") ? "acknowledging" : last.startsWith("Tutor:") ? "asking" : "unknown",
    }),
  };
}

let runtime: LessonRuntime | undefined;
let held: (() => void)[] = [];
let holdClassifier = true;
beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  held = [];
  holdClassifier = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({ ok: true });
      const response = Response.json(judge(JSON.parse(String(init?.body))));
      // 450 ms is within this export's observed classifier latency (230-1900 ms) and
      // longer than the ~430 ms gaps in which the original runtime lost every race.
      if (!holdClassifier) return new Promise<Response>(resolve => setTimeout(() => resolve(response), 450));
      return new Promise<Response>(resolve => held.push(() => resolve(response)));
    }),
  );
});
afterEach(() => {
  runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function acknowledgeLatestSteering() {
  const steering = transport.send.mock.calls.findLast(
    ([command]) => command.type === "session.instructions.append" && command.event_id.includes(":steer:"),
  )?.[0];
  if (steering?.type !== "session.instructions.append") throw new Error("Expected steering");
  providerEvents(transport.receive!).acknowledgeSteering(steering.event_id, 0);
}
async function start() {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  acknowledgeLatestSteering();
  return runtime;
}
/** Release held classifier responses; later requests answer after a fixed latency. */
async function releaseClassifier() {
  holdClassifier = false;
  for (const resolve of held.splice(0)) resolve();
  await vi.advanceTimersByTimeAsync(0);
}
async function replay(lessonRuntime: LessonRuntime, steps: Step[], releaseAt?: string) {
  let elapsed = 0;
  for (const step of steps) {
    await vi.advanceTimersByTimeAsync(step.atMs - elapsed);
    elapsed = step.atMs;
    if (lessonRuntime.snapshot().runtime?.phase !== "active") return;
    transport.receive!(step.event);
    if (releaseAt !== undefined && step.label === releaseAt) {
      // Let the classifier answer a little inside this window, as a real response would.
      await vi.advanceTimersByTimeAsync(20);
      elapsed += 20;
      await releaseClassifier();
    }
  }
}
const events = (type: string) => runtime!.observe().events.filter(event => event.type === type);
const recoveryPrompts = () =>
  transport.send.mock.calls.filter(
    ([command]) => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"),
  );

describe("acknowledged counting answer with discarded microphone noise (export 37b847a9)", () => {
  it.each(["first-candidate", "first-discard", "second-candidate"])(
    "keeps classifying through short bursts and advances once (classifier answers at %s)",
    async releaseAt => {
      const lessonRuntime = await start();
      await replay(lessonRuntime, exportTimeline(), releaseAt);
      await vi.advanceTimersByTimeAsync(400);
      expect(events("render.requested")).toHaveLength(1);
      expect(lessonRuntime.snapshot().display.nodeId).toBe("count-4-flowers");
      lessonRuntime.confirmRendered(lessonRuntime.snapshot().display);
      expect(lessonRuntime.snapshot().runtime).toMatchObject({ phase: "active", nodeId: "count-4-flowers" });
      // Provisional energy no longer voids the in-flight acknowledged classification.
      expect(
        events("classifier.cancelled").filter(
          event => (event.detail as { reason: string }).reason === "child_turn_started",
        ),
      ).toEqual([]);
      expect(recoveryPrompts()).toEqual([]);
    },
  );

  it.each([
    { releaseAt: "third-candidate", restoredAccepted: true },
    { releaseAt: "textless-ended", restoredAccepted: false },
  ])(
    "does not ask the child to repeat after wordless turns (classifier answers at $releaseAt)",
    async ({ releaseAt, restoredAccepted }) => {
      const lessonRuntime = await start();
      await replay(lessonRuntime, exportTimeline(), releaseAt);
      // The confirmed wordless turns suspend completion; nothing advances yet.
      expect(events("render.requested")).toEqual([]);
      expect(lessonRuntime.snapshot().runtime).toMatchObject({
        nodeId: "count-3-ducklings",
        hasChildTranscript: false,
        answerAccepted: false,
      });
      // The existing bounded missing-text window still applies before anything resolves.
      await vi.advanceTimersByTimeAsync(3900);
      expect(events("render.requested")).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(events("answer_recovery.prior_answer_restored")).toHaveLength(1);
      expect(events("answer_recovery.prior_answer_restored")[0].detail).toEqual({ answerAccepted: restoredAccepted });
      expect(events("render.requested")).toHaveLength(1);
      expect(lessonRuntime.snapshot().display.nodeId).toBe("count-4-flowers");
      expect(recoveryPrompts()).toEqual([]);
      await vi.advanceTimersByTimeAsync(6000);
      expect(events("render.requested")).toHaveLength(1);
    },
  );

  it("still supersedes with a new transcribed wrong answer and keeps its recovery", async () => {
    const lessonRuntime = await start();
    const steps = exportTimeline();
    const last = steps.findIndex(step => step.label === "first-candidate");
    // A real self-correction, transcribed, before the classifier answers.
    await replay(lessonRuntime, [
      ...steps.slice(0, last),
      { atMs: 13649, event: { type: "microphone.activity_started" } },
      { atMs: 13732, event: { type: "microphone.speech_started" } },
      { atMs: 13900, event: child("Four", 74600) },
      { atMs: 14700, event: { type: "microphone.speech_stopped", quietMs: 900 } },
    ]);
    await releaseClassifier();
    await vi.advanceTimersByTimeAsync(1000);
    expect(lessonRuntime.snapshot().runtime).toMatchObject({
      nodeId: "count-3-ducklings",
      phase: "active",
      hasChildTranscript: true,
      answerAccepted: false,
      textlessTurnPrior: null,
    });
    // A wordless turn after a judged wrong answer still gets the one recovery prompt.
    transport.receive!({ type: "microphone.activity_started" });
    transport.receive!({ type: "microphone.speech_started" });
    await vi.advanceTimersByTimeAsync(900);
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(events("answer_recovery.prior_answer_restored")).toEqual([]);
    expect(recoveryPrompts()).toHaveLength(1);
    expect(events("render.requested")).toEqual([]);
  });

  it("Stop during the missing-text window ends without completion or recovery", async () => {
    const lessonRuntime = await start();
    await replay(lessonRuntime, exportTimeline(), "third-candidate");
    await vi.advanceTimersByTimeAsync(1000);
    lessonRuntime.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lessonRuntime.snapshot().status).toBe("ended");
    expect(lessonRuntime.snapshot().runtime).toMatchObject({
      phase: "stopped",
      lessonComplete: false,
      nodeId: "count-3-ducklings",
      answerAccepted: false,
    });
    expect(events("render.requested")).toEqual([]);
    expect(events("answer_recovery.prior_answer_restored")).toEqual([]);
    expect(recoveryPrompts()).toEqual([]);
  });
});

describe("counting reducer: deferred candidates and wordless turns", () => {
  const proposal = (state: LessonRuntimeState, overrides: Record<string, unknown> = {}) => ({
    ...classifierProposal(state, {
      answerOutcome: "correct",
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
    ...overrides,
  });
  function harness() {
    const h = createReducerHarness("reducer", { lesson: COUNTING_LESSON });
    const source = () => runtimeSource(h.state);
    return {
      get state() {
        return h.state;
      },
      send: h.send,
      /** The exact current source, even on a wordless turn where classificationSource is null. */
      current: (): ClassificationSource => ({
        ...source(),
        nodeId: h.state.nodeId,
        transcriptRevision: h.state.transcriptRevision,
      }),
      /** Child answers, tutor acknowledges, output drains to quiet; classifier not yet answered. */
      acknowledged() {
        h.send({ type: "output.activity", source: source(), state: "quiet" });
        prepareLearnerClassification(h, 1);
        h.send({ type: "transcript.updated", source: source(), speaker: "tutor", revision: 2 });
        h.send({ type: "output.activity", source: source(), state: "active" });
        h.send({ type: "output.activity", source: source(), state: "quiet" });
        return classificationSource(h.state)!;
      },
      wordlessTurn() {
        h.send({ type: "child.candidate.started", source: source() });
        h.send({ type: "child.turn.confirmed", source: source() });
        h.send({ type: "child.turn.ended", source: source() }, 900);
      },
    };
  }

  it("a short candidate keeps the classification source, and the result applies after discard", () => {
    const h = harness();
    const source = h.acknowledged();
    h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
    expect(h.state.childTurnId).toBe(source.childTurnId);
    const during = h.send({ type: "proposal.received", source, proposal: proposal(h.state) });
    expect(during.proposalConsumption?.consumption).toBe("consumed");
    expect(during.effects).toEqual([]);
    h.send({ type: "child.candidate.discarded", source: runtimeSource(h.state) });
    // Fresh quiet after the burst, then exactly one transition.
    expect(h.state.phase).toBe("active");
    const tick = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 300);
    expect(tick.effects).toMatchObject([{ type: "render.requested" }]);
    expect(h.state.pendingRender?.identity.nodeId).toBe("count-2-ducks");
  });

  it("restores accepted evidence after a wordless turn, but never from a stale source", () => {
    const h = harness();
    const source = h.acknowledged();
    h.send({ type: "proposal.received", source, proposal: proposal(h.state) });
    // Accepted, but the child makes a confirmed wordless sound before the drain completes.
    h.wordlessTurn();
    expect(h.state).toMatchObject({ answerAccepted: false, hasChildTranscript: false });
    expect(h.state.textlessTurnPrior).toMatchObject({
      answerAccepted: true,
      consumedRevision: source.transcriptRevision,
    });
    // The pre-turn classifier source is stale now.
    expect(
      h.send({ type: "proposal.received", source, proposal: proposal(h.state) }).proposalConsumption,
    ).toMatchObject({
      consumption: "ignored",
    });
    const current = h.current();
    expect(
      h.send({ type: "textless.turn.resolved", source: { ...current, childTurnId: source.childTurnId } }).state
        .answerAccepted,
    ).toBe(false);
    expect(
      h.send({
        type: "textless.turn.resolved",
        source: { ...current, transcriptRevision: current.transcriptRevision - 1 },
      }).state.answerAccepted,
    ).toBe(false);
    h.send({ type: "textless.turn.resolved", source: current });
    expect(h.state).toMatchObject({ answerAccepted: true, hasChildTranscript: true, textlessTurnPrior: null });
    // The stale pre-turn source still cannot be consumed after restoration.
    expect(
      h.send({ type: "proposal.received", source, proposal: proposal(h.state) }).proposalConsumption,
    ).toMatchObject({
      consumption: "ignored",
    });
    expect(h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 300).effects).toMatchObject([
      { type: "render.requested" },
    ]);
  });

  it("does not restore after new learner words, while speaking, or with output active", () => {
    const h = harness();
    const source = h.acknowledged();
    h.send({ type: "proposal.received", source, proposal: proposal(h.state) });
    h.wordlessTurn();
    const resolve = () => h.send({ type: "textless.turn.resolved", source: h.current() });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    expect(resolve().state.answerAccepted).toBe(false);
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
    expect(resolve().state.answerAccepted).toBe(false);
    h.send({ type: "child.turn.confirmed", source: runtimeSource(h.state) });
    // A real, transcribed self-correction supersedes the held answer.
    h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "child", revision: 10 });
    h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
    expect(h.state.textlessTurnPrior).toBeNull();
    expect(resolve().state).toMatchObject({ answerAccepted: false, phase: "active" });
    // A judged wrong answer is not held across a later wordless turn.
    h.send({
      type: "proposal.received",
      source: classificationSource(h.state)!,
      proposal: proposal(h.state, { answerOutcome: "incorrect", tutorState: "unknown" }),
    });
    h.wordlessTurn();
    expect(h.state.textlessTurnPrior).toBeNull();
  });

  it("Stop wins over a pending restoration", () => {
    const h = harness();
    const source = h.acknowledged();
    h.send({ type: "proposal.received", source, proposal: proposal(h.state) });
    h.wordlessTurn();
    const current = h.current();
    h.send({ type: "stop", runtimeId: h.state.runtimeId });
    const after = h.send({ type: "textless.turn.resolved", source: current });
    expect(after.effects).toEqual([]);
    expect(h.state).toMatchObject({
      phase: "stopped",
      lessonComplete: false,
      answerAccepted: false,
      pendingRender: null,
    });
  });
});
