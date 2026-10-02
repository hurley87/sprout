import { immediateAcknowledgment } from "./helpers/immediate-acknowledgment";
import { afterEach, expect, it, vi } from "vitest";
import { LessonSession, type Transport } from "../lib/session";
import { type Evidence, type SessionRecorder } from "../lib/session-recorder";
import { recognitionRecovery } from "../lib/recognition-recovery";
import { evaluationResultContext, sceneAt, replacementSessionInput, parseReplacementSeed } from "../lib/lesson";
import {
  validateObserverProposal,
  type CanonicalObservationRecord,
  type ObserverProposal,
} from "../lib/observation-contracts";
import { reviewPlaybackAtMs } from "../lib/parent-review";
import { observationFixtures } from "./fixtures/observation-contracts";
import { UtteranceAccumulator } from "../lib/transcript";

it.each([
  ["Eight", undefined, "clarification"],
  ["Eight", 8, "instructional_support"],
  ["Nine", 8, "clarification"],
  ["Two", undefined, "instructional_support"],
  ["two?", undefined, "clarification"],
  ["One, two", undefined, "instructional_support"],
  ["three or eight", undefined, "clarification"],
  ["unintelligible", undefined, "clarification"],
] as const)("uses bounded recovery for %s without assuming an ASR error", (text, prior, expected) => {
  expect(recognitionRecovery(text, prior)).toBe(expected);
});

it("keeps clarification distinct from instructional support in original and replacement context", () => {
  const common = {
    evaluatedScene: sceneAt(2),
    displayedScene: sceneAt(2),
    transcriptRevision: 1,
    answerVersion: "35800:Eight",
    meaning: "did_not_meet_advancement_criterion",
    action: "STAY",
  } as const;
  const context = evaluationResultContext({ ...common, evaluatedAnswer: "Eight" });
  expect(context).toContain("Could you say your number again?");
  expect(context).not.toContain("Point to each butterfly as you count it once.");
  expect(evaluationResultContext({ ...common, evaluatedAnswer: "Two" })).toContain(
    "Point to each butterfly as you count it once.",
  );
  const seed = {
    sceneIndex: 2,
    evaluatedSceneIndex: 2,
    childUtterance: "Eight",
    transcriptRevision: 2,
    answerVersion: "40000:Eight",
    decision: "STAY",
    recovery: "instructional_support",
  } as const;
  expect(parseReplacementSeed(seed)).toEqual(seed);
  expect(replacementSessionInput(seed)[1].content[0].text).toContain("Point to each butterfly as you count it once.");
});

function contractFixture() {
  return structuredClone(observationFixtures.find(f => f.name === "correct-total-without-spoken-count")!);
}
function uncertain(proposal: ObserverProposal): ObserverProposal {
  return {
    ...proposal,
    observation: {
      behavior: "uncertain_exchange",
      outcome: "uncertain",
      speakerAttribution: "child_or_nearby_speaker",
      countSequenceObserved: false,
      description: "Timing and recognition remain uncertain.",
      support: { status: "not_established", kinds: [], sourceEventIds: [] },
      uncertaintyReasons: ["missing_scene_context", "unclear_speech"],
    },
  };
}

it("does not use the butterfly provider clock to attribute a response to strawberries", () => {
  const { record, proposal } = contractFixture();
  const scene = record.events.find(e => e.evidence?.type === "scene_displayed")!;
  scene.atMs = 16590;
  const response = record.events.find(e => e.evidence?.type === "utterance")!;
  if (response.evidence?.type !== "utterance" || scene.evidence?.type !== "scene_displayed") throw new Error("fixture");
  Object.assign(response.evidence, {
    startMs: 50600,
    endMs: 50800,
    firstObservedAtMs: 43075,
    lastObservedAtMs: 43075,
    providerTiming: { clock: "provider", startMs: 50600, endMs: 50800, sourceId: 1 },
    responseScene: {
      provenance: "application_transcript_context",
      sceneId: scene.evidence.sceneId,
      displayedAtMs: 16590,
      status: "stable",
    },
  });
  delete response.evidence.sessionTiming;
  response.atMs = 45575;
  proposal!.exchangeAtMs = response.atMs;
  record.events.push({ _id: "strawberries", atMs: 43640, evidence: { ...scene.evidence, sceneId: "picnic" } });
  const before = structuredClone(record);
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
  const sources = record.events.map(e => ({ id: e._id, eventKey: e._id, atMs: e.atMs, evidence: e.evidence! }));
  expect(reviewPlaybackAtMs(proposal!, sources)).toBe(43075);
  expect(record).toEqual(before);
  // A separately established mapping may validate the original butterfly scene.
  response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 42500, endMs: 42900 };
  expect(validateObserverProposal(proposal, record).ok).toBe(true);
  proposal!.sources = proposal!.sources.map(s => (s.role === "scene" ? { eventId: "strawberries", role: "scene" } : s));
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
});

it("requires uncertainty for legacy timing and unconfirmed recognition, without rewriting source data", () => {
  const { record, proposal } = contractFixture();
  const response = record.events.find(e => e.evidence?.type === "utterance")!;
  if (response.evidence?.type !== "utterance") throw new Error("fixture");
  delete response.evidence.sessionTiming;
  const before = structuredClone(record);
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
  expect(record).toEqual(before);
  response.evidence.sessionTiming = { clock: "session", provenance: "mapped_provider", startMs: 1600, endMs: 2000 };
  response.evidence.recognition = "needs_confirmation";
  expect(validateObserverProposal(proposal, record).ok).toBe(false);
  expect(validateObserverProposal(uncertain(proposal!), record).ok).toBe(true);
});

it("orders support on mapped session time rather than large provider offsets or arrival time", () => {
  const f = structuredClone(observationFixtures.find(f => f.name === "hint-and-counting-together")!);
  const response = f.record.events.find(e => e.evidence?.type === "utterance")!;
  const support = f.record.events.find(e => e.evidence?.type === "support")!;
  if (response.evidence?.type !== "utterance") throw new Error("fixture");
  response.evidence.startMs = 50600;
  support.atMs = response.evidence.sessionTiming!.startMs + 1;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(false);
  support.atMs = response.evidence.sessionTiming!.startMs - 1;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(true);
  delete response.evidence.sessionTiming;
  expect(validateObserverProposal(f.proposal, f.record).ok).toBe(false);
});

it("does not turn STAY, suggested help or delivered neutral clarification into recorded instructional support", () => {
  const { record, proposal } = contractFixture();
  record.events.push(
    {
      _id: "stay",
      atMs: 900,
      timeline: { type: "answer_evaluation_resolved", status: "evaluated", probability: 0.01, decision: "STAY" },
    },
    {
      _id: "suggested-help",
      atMs: 1000,
      timeline: {
        type: "evaluation_control",
        action: "application_outcome_released",
        reason: "Count them one at a time.",
      },
    },
    {
      _id: "generated-help",
      atMs: 1100,
      timeline: { type: "sprout_generated_utterance", text: "Count with me." },
    },
    {
      _id: "delivered-clarification",
      atMs: 1200,
      evidence: { type: "utterance", speaker: "sprout", text: "Could you say your number again?", state: "finalized" },
    },
  );
  expect(validateObserverProposal(proposal, record).ok).toBe(true);
  for (const id of ["suggested-help", "generated-help", "delivered-clarification"]) {
    const withHelp = structuredClone(proposal!);
    withHelp.sources.push({ role: "support", eventId: id });
    withHelp.observation.support = { status: "recorded", kinds: ["hint"], sourceEventIds: [id] };
    expect(validateObserverProposal(withHelp, record).ok).toBe(false);
  }
  const mistaken = structuredClone(proposal!);
  mistaken.observation.statedTotal = 2;
  mistaken.observation.outcome = "incorrect";
  expect(validateObserverProposal(mistaken, record).ok).toBe(false);
});

it("records changed arrival context across fragments and separates provider sources", () => {
  const accumulator = new UtteranceAccumulator();
  const context = (sceneId: string, sourceId = 1) => ({
    providerTiming: { clock: "provider" as const, startMs: 100, endMs: 200, sourceId },
    responseScene: {
      provenance: "application_transcript_context" as const,
      sceneId,
      displayedAtMs: 0,
      status: "stable" as const,
    },
  });
  accumulator.append("One, ", 100, 200, true, 10, context("ducks"));
  accumulator.append("two", 200, 300, true, 20, context("butterflies"));
  const prior = accumulator.append("Three", 0, 100, true, 30, context("butterflies", 2));
  expect(prior?.context?.responseScene).toMatchObject({ sceneId: "ducks", status: "changed" });
  expect(prior?.context?.providerTiming).toMatchObject({ sourceId: 1, startMs: 100, endMs: 300 });
  expect(accumulator.take()).toMatchObject({ text: "Three", context: { providerTiming: { sourceId: 2 } } });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("clarifies Eight, allows help after repeating it, and still advances on Three with original scene attribution", async () => {
  vi.useFakeTimers();
  const writes: Evidence[] = [];
  const recorder: SessionRecorder = {
    create: async () => "synthetic",
    activate: async () => {},
    append: async (_key, _at, evidence) => {
      writes.push(evidence);
    },
    appendTimeline: async () => {},
    attachRecording: async () => {},
    markIncomplete: async () => {},
    finalize: async () => {},
  };
  const transport: Transport = {
    activeSourceId: 1,
    start: async () => {},
    send: vi.fn(),
    setOutputBlocked: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
  };
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(
    transport,
    async ({ utterance }) => ({
      status: "evaluated",
      probability: utterance === "Eight" ? 0.01 : 0.99,
      model: "synthetic",
      latencyMs: 1,
    }),
    vi.fn(),
    undefined,
    recorder,
  );
  await session.start();
  session.receive({ type: "session.started" });
  session.displayed(0, session.snapshot.displayToken);
  const say = async (text: string, startMs: number) => {
    session.receive({
      type: "transcript",
      speaker: "child",
      delta: text,
      startMs,
      endMs: startMs + 200,
      sourceId: transport.activeSourceId,
    });
    await vi.advanceTimersByTimeAsync(2000);
  };
  await say("One", 6200);
  session.displayed(1, session.snapshot.displayToken);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  await say("Two", 15800);
  session.displayed(2, session.snapshot.displayToken);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  await say("Eight", 35800);
  expect(session.snapshot.sceneIndex).toBe(2);
  expect(vi.mocked(transport.send).mock.calls.at(-1)?.[0]).toMatchObject({
    content: expect.stringContaining("Could you say your number again?"),
  });
  await vi.advanceTimersByTimeAsync(1000);
  await say("Eight", 40000);
  expect(vi.mocked(transport.send).mock.calls.at(-1)?.[0]).toMatchObject({
    content: expect.stringContaining("Point to each butterfly as you count it once."),
  });
  await vi.advanceTimersByTimeAsync(1000);
  await say("Three", 50600);
  session.displayed(3, session.snapshot.displayToken);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  await session.recordingSettled();
  const responses = writes.filter((e): e is Extract<Evidence, { type: "utterance" }> => e.type === "utterance");
  expect(responses.filter(e => e.text === "Eight").map(e => e.recognition)).toEqual([
    "needs_confirmation",
    "no_ambiguity_detected",
  ]);
  expect(responses.at(-1)).toMatchObject({
    text: "Three",
    providerTiming: { clock: "provider", startMs: 50600 },
    responseScene: { sceneId: "butterfly-garden", status: "stable" },
  });
  expect(responses.at(-1)?.sessionTiming).toBeUndefined();
  expect(session.snapshot.sceneIndex).toBe(3);
  session.end("parent_stop");
  await session.recordingSettled();
});

it("validates a concrete correct response from real LessonSession recorder output", async () => {
  vi.useFakeTimers();
  const writes: Array<{ atMs: number; evidence: Evidence }> = [];
  const recorder: SessionRecorder = {
    create: async () => "synthetic",
    activate: async () => {},
    append: async (_key, atMs, evidence) => {
      writes.push({ atMs, evidence });
    },
    appendTimeline: async () => {},
    attachRecording: async () => {},
    markIncomplete: async () => {},
    finalize: async () => {},
  };
  const transport: Transport = {
    activeSourceId: 1,
    start: async () => {},
    // This mirrors BrowserTransport: fence synchronously, then accept input.
    openInput: fence => {
      fence(1);
      return true;
    },
    send: vi.fn(),
    setOutputBlocked: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
  };
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(
    transport,
    async () => ({ status: "evaluated", probability: 0.99, model: "synthetic", latencyMs: 1 }),
    vi.fn(),
    undefined,
    recorder,
  );
  await session.start();
  session.receive({ type: "session.started" });
  session.displayed(0, session.snapshot.displayToken);
  await vi.advanceTimersByTimeAsync(1000);
  session.receive({ type: "transcript", speaker: "child", delta: "One", startMs: 50600, endMs: 50800, sourceId: 1 });
  await vi.advanceTimersByTimeAsync(3100);
  session.end("parent_stop");
  await session.recordingSettled();

  const scene = writes.find(
    write => write.evidence.type === "scene_displayed" && write.evidence.sceneId === "hello-duck",
  )!;
  const response = writes.find(
    (write): write is { atMs: number; evidence: Extract<Evidence, { type: "utterance" }> } =>
      write.evidence.type === "utterance" && write.evidence.text === "One",
  )!;
  if (scene.evidence.type !== "scene_displayed") throw new Error("expected recorded scene evidence");
  expect(response.evidence.sessionTiming).toMatchObject({
    clock: "session",
    provenance: "source_input_bound",
    sourceId: transport.activeSourceId,
    startMs: scene.atMs,
    inputScene: { sceneId: scene.evidence.sceneId, displayedAtMs: scene.atMs },
  });
  expect(response.evidence.providerTiming).toMatchObject({ startMs: 50600, endMs: 50800, sourceId: 1 });
  expect(response.evidence.sessionTiming!.endMs).toBeGreaterThanOrEqual(response.evidence.lastObservedAtMs!);

  const fixture = contractFixture();
  const canonical: CanonicalObservationRecord = {
    session: { _id: "synthetic", state: "ended", recordStatus: "complete" },
    events: [
      { _id: "scene", atMs: scene.atMs, evidence: scene.evidence },
      { _id: "response", atMs: response.atMs, evidence: response.evidence },
    ],
  };
  if (!fixture.proposal) throw new Error("expected concrete proposal fixture");
  const proposal: ObserverProposal = {
    ...fixture.proposal,
    sessionId: "synthetic",
    exchangeAtMs: response.atMs,
    observation: {
      ...fixture.proposal.observation,
      statedTotal: 1,
      targetQuantity: 1,
      description: "The recorded response gives the displayed quantity.",
    },
    sources: [
      { eventId: "scene", role: "scene" },
      { eventId: "response", role: "response" },
    ],
  };
  const validation = validateObserverProposal(proposal, canonical);
  if (!validation.ok) throw new Error(JSON.stringify(validation.issues));
});
