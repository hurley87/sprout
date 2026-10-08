import { sourceOutputs } from "./fixtures/concept-source-outputs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CATCHING_UNICORNS_LESSON as CONVERSATIONAL_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
// Retain coverage for the shared mastery-gated policy; production Sprout uses conversationFirst.
const CATCHING_UNICORNS_LESSON = { ...CONVERSATIONAL_LESSON, conversationFirst: false };
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { mapConversationObservation } from "../lib/lesson-runtime/conversation-observer-contract";
import type { ConversationStateOutputs } from "../lib/lesson-runtime/conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { CLASSIFIER_VERSION, CONVERSATION_CLASSIFICATION_THRESHOLDS } from "../lib/lesson-runtime/conversation-observer-contract";
import engramReplay from "./fixtures/catching-unicorns-engram-replay.json";
import laterReplay from "./fixtures/catching-unicorns-compare-exographics-replay.json";
import interruptionReplay from "./fixtures/catching-unicorns-interruption-replay.json";
import progressReplay from "./fixtures/catching-unicorns-exographics-progress-replay.json";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import locationReplay from "./fixtures/catching-unicorns-engram-location-replay.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));

vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void) {
      transport.receive = receive;
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close = transport.close;
  },
}));

let runtime: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    if (url !== "/api/classify") throw new Error(`Unexpected fetch: ${url}`);
    const input = JSON.parse(init?.body as string);
    const node = CATCHING_UNICORNS_LESSON.nodes[input.nodeId];
    return Response.json({
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: input.transcript.includes("Tutor:") ? "acknowledging" : "unknown",
        conceptObservations: (node.concepts ?? []).map(concept => ({
          criterionId: concept.id,
          observation: "demonstrated_independent",
        })),
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function emit(event: ProviderEvent) {
  transport.receive?.(event);
}

it("checks presence once when detected speech has no transcript, without accepting or advancing", async () => {
  await start(CATCHING_UNICORNS_LESSON);
  const recoveries = () => transport.send.mock.calls.map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"));
  emit({ type: "microphone.speech_started" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoveries()).toHaveLength(0);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(3999);
  expect(recoveries()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(recoveries()).toHaveLength(1);
  const checkIn = recoveries()[0];
  expect(checkIn).toMatchObject({ content: expect.stringContaining("I didn't catch your answer. Are you still there?") });
  if (checkIn.type !== "session.instructions.append") throw new Error("Expected check-in");
  // Receiving an instruction acknowledgment is not a spoken response or learner evidence.
  emit({ type: "context.appended", name: "session.instructions.appended", clientEventId: checkIn.event_id, startMs: 100 });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(recoveries()).toHaveLength(1);
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "engram", phase: "active", hasChildTranscript: false,
    answerAccepted: false, acknowledgmentObserved: false, conceptEvidence: {},
  });
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/classify")).toHaveLength(0);
});

async function start(
  lesson: typeof CATCHING_UNICORNS_LESSON = { ...CATCHING_UNICORNS_LESSON, requirePresentationConfirmation: true },
) {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0]?.[0];
  if (steering?.type !== "session.instructions.append") throw new Error("Expected initial steering");
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: steering.event_id,
    startMs: 0,
  });
  emit({ type: "output.activity", state: "quiet" });
}

function childTurn() {
  emit({ type: "microphone.activity_started" });
  emit({
    type: "transcript",
    speaker: "child",
    delta: "It is memory carried inside a person.",
    startMs: 100,
    endMs: 200,
  });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

function tutorTranscript(delta: string, startMs: number) {
  emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
}

it("rejects continuation after a new tutor revision until the real runtime reclassifies it", async () => {
  await start();
  childTurn();
  await vi.advanceTimersByTimeAsync(300);
  tutorTranscript("Yes, that is internal biological memory.", 300);
  await vi.advanceTimersByTimeAsync(600);

  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    nodeId: "engram",
    transitionReady: true,
    answerAccepted: true,
    acknowledgmentObserved: true,
  });

  tutorTranscript("One more detail about the idea.", 500);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    nodeId: "engram",
    transitionReady: false,
    answerAccepted: false,
    acknowledgmentObserved: false,
  });
  runtime.continueAfterPresentation();
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  expect(runtime.snapshot().runtime?.phase).toBe("active");

  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime?.transitionReady).toBe(true);
  runtime.continueAfterPresentation();
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "exogram" });
});

it.each([true, false])(
  "handles confirmation with uncertain demonstration only when concept evidence was retained: %s",
  async retained => {
    // Controlled scores leave demonstration itself uncertain, even after
    // confirmation. They do not assert provider accuracy.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live") return Response.json({ ok: true });
      const input = JSON.parse(init?.body as string);
      const confirming = input.transcript.includes("That answers this question.");
      const tutor = input.transcript.includes("Tutor:");
      const choice = <T extends string>(selected: T, labels: readonly T[]) => ({
        choice: selected,
        confidence: 0.99,
        probabilities: Object.fromEntries(
          labels.map(label => [label, label === selected ? 0.99 : 0.01 / (labels.length - 1)]),
        ) as Record<T, number>,
      });
      const decision = mapConversationObservation(
        { ...input, lesson: CATCHING_UNICORNS_LESSON },
        {
          objectiveState: choice("completed", [
            "completed",
            "incorrect",
            "unclear_or_incomplete",
            "unresolved_help",
            "no_attempt",
          ]),
          tutorState: choice(confirming ? "confirmed_completion" : tutor ? "clarifying" : "other", [
            "confirmed_completion",
            "clarifying",
            "helping",
            "asking",
            "other",
          ]),
          concepts: {
            "concept_engram-biological":
              retained && !tutor
                ? choice("demonstrated_independent", [
                    "not_yet",
                    "partial",
                    "demonstrated_independent",
                    "demonstrated_prompted",
                  ])
                : {
                    choice: "demonstrated_prompted",
                    confidence: 0.36,
                    probabilities: {
                      not_yet: 0,
                      partial: 0.2,
                      demonstrated_independent: 0.39,
                      demonstrated_prompted: 0.41,
                    },
                  },
          },
        },
      );
      if (confirming) expect(decision.proposal?.conceptObservations).toEqual([]);
      return Response.json({ proposal: decision.proposal });
    });

    await start();
    childTurn();
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.snapshot().runtime?.conceptEvidence["engram:engram-biological"]?.status === "demonstrated").toBe(
      retained,
    );

    tutorTranscript("That is a solid distinction. Can you rephrase it in your own words?", 300);
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().runtime?.transitionReady).toBe(false);
    runtime.continueAfterPresentation();
    expect(runtime.snapshot().runtime?.nodeId).toBe("engram");

    tutorTranscript("That answers this question. Use Continue when you are ready.", 500);
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().runtime).toMatchObject({
      answerAccepted: true,
      acknowledgmentObserved: true,
      transitionReady: retained,
    });
    runtime.continueAfterPresentation();
    expect(runtime.snapshot().runtime?.nodeId).toBe(retained ? "exogram" : "engram");
  },
);

it("automatically advances the demo only after accepted evidence, tutor confirmation and quiet audio", async () => {
  await start(CATCHING_UNICORNS_LESSON);
  childTurn();
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  emit({ type: "transcript", speaker: "sprout", delta: "That answers this question.", startMs: 300, endMs: 400 });
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "exogram" });
});

it("replays the recorded Engram retries and advances despite uncertain prompting attribution", async () => {
  const classified: string[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const snapshot = engramReplay.snapshots.find(item => item.transcript === input.transcript);
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error("Unexpected replay transcript");
    classified.push(input.transcript);
    const decision = mapConversationObservation(
      { ...input, lesson: CATCHING_UNICORNS_LESSON },
      snapshot.outputs as ConversationStateOutputs,
    );
    const diagnostic = {
      classifierVersion: CLASSIFIER_VERSION,
      decision: decision.status,
      outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}),
      outputs: decision.outputs,
      labelCompletionEligible: decision.labelCompletionEligible,
      thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      elapsedMs: 12,
    };
    expect(parseLiveClassificationDiagnostic(diagnostic, CATCHING_UNICORNS_LESSON, "engram")).toEqual(diagnostic);
    return Response.json({ proposal: decision.proposal, diagnostic });
  });
  await start(CATCHING_UNICORNS_LESSON);
  let priorLines = 0;
  let timestamp = 100;
  for (const [index, snapshot] of engramReplay.snapshots.entries()) {
    const lines = snapshot.transcript.split("\n");
    for (const line of lines.slice(priorLines)) {
      const child = line.startsWith("Child:");
      if (child) emit({ type: "microphone.activity_started" });
      emit({ type: "transcript", speaker: child ? "child" : "sprout", delta: line.slice(line.indexOf(":") + 2), startMs: timestamp, endMs: timestamp + 100 });
      if (child) emit({ type: "microphone.speech_stopped", quietMs: 900 });
      else emit({ type: "output.activity", state: "active" });
      timestamp += 200;
    }
    priorLines = lines.length;
    if (index === engramReplay.snapshots.length - 1) {
      await vi.advanceTimersByTimeAsync(1000);
      expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
    }
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().runtime?.nodeId).toBe(index === engramReplay.snapshots.length - 1 ? "exogram" : "engram");
  }
  expect(classified).toEqual(engramReplay.snapshots.map(snapshot => snapshot.transcript));
  expect(runtime.snapshot().runtime?.conceptEvidence["engram:engram-biological"]).toMatchObject({
    status: "demonstrated", understanding: null,
  });
});

it("recovers the recorded Exographics hold without counting the tutor's supplied answers as learner evidence", async () => {
  const recorded = laterReplay.scenes.exographics;
  let corrected = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const outputs = structuredClone(recorded.outputs) as ConversationStateOutputs;
    if (corrected) {
      outputs.objectiveState = { choice: "completed", confidence: 0.99, probabilities: { completed: 0.99, incorrect: 0, unclear_or_incomplete: 0.01, unresolved_help: 0, no_attempt: 0 } };
      const confirmed = input.transcript.endsWith("That completes this question.");
      outputs.tutorState = { choice: confirmed ? "confirmed_completion" : "asking", confidence: 0.99, probabilities: { confirmed_completion: confirmed ? 0.99 : 0, asking: confirmed ? 0 : 0.99, clarifying: 0.01, helping: 0, other: 0 } };
      const latestChild = transcriptMessages(input.transcript)!.findLastIndex(message => message.speaker === "Child");
      outputs.sources = sourceOutputs(input.transcript, { "visual-symbols": latestChild, "cultural-agreement": latestChild, "beyond-prose": 5, "abstract-concepts": latestChild });
      for (const key of Object.keys(outputs.concepts!)) outputs.concepts = { ...outputs.concepts, [key]: { choice: "demonstrated_prompted", confidence: 0.99, probabilities: { not_yet: 0, partial: 0.01, demonstrated_independent: 0, demonstrated_prompted: 0.99 } } };
    }
    const decision = mapConversationObservation({ ...input, lesson: CATCHING_UNICORNS_LESSON }, outputs);
    return Response.json({ proposal: decision.proposal, diagnostic: {
      classifierVersion: CLASSIFIER_VERSION, decision: decision.status, outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}), outputs: decision.outputs,
      labelCompletionEligible: decision.labelCompletionEligible, thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, elapsedMs: 12,
    } });
  });
  await start({ ...CATCHING_UNICORNS_LESSON, initialNodeId: "exographics" });
  let timestamp = 100;
  for (const line of recorded.transcript.split("\n")) {
    const child = line.startsWith("Child:");
    if (child) emit({ type: "microphone.activity_started" });
    emit({ type: "transcript", speaker: child ? "child" : "sprout", delta: line.slice(line.indexOf(":") + 2), startMs: timestamp, endMs: timestamp + 100 });
    if (child) emit({ type: "microphone.speech_stopped", quietMs: 900 });
    timestamp += 200;
  }
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime?.nodeId).toBe("exographics");
  expect(runtime.snapshot().runtime?.conceptEvidence["exographics:beyond-prose"]?.status).toBe("demonstrated");
  expect(runtime.snapshot().runtime?.conceptEvidence["exographics:cultural-agreement"]).toBeUndefined();
  expect(runtime.snapshot().runtime?.conceptEvidence["exographics:abstract-concepts"]).toBeUndefined();
  await vi.advanceTimersByTimeAsync(4000);
  const recoveries = transport.send.mock.calls.map(([command]) => command).filter(command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"));
  expect(recoveries).toHaveLength(1);
  expect(recoveries[0]).toMatchObject({ content: expect.stringContaining("cultural-agreement") });
  expect(recoveries[0]).toMatchObject({ content: expect.stringContaining("abstract-concepts") });
  expect(recoveries[0]).toMatchObject({ content: expect.not.stringContaining('"id":"beyond-prose"') });
  await vi.advanceTimersByTimeAsync(5000);
  expect(transport.send.mock.calls.map(([command]) => command).filter(command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"))).toHaveLength(1);
  corrected = true;
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "Drawn symbols on paper have meanings people agree on, and they can represent abstract ideas like justice, not just objects.", startMs: timestamp, endMs: timestamp + 100 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.snapshot().runtime?.nodeId).toBe("exographics");
  tutorTranscript("That completes this question.", timestamp + 200);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime?.nodeId).toBe("why-exographics");
});

it("recovers an interrupted confirmation followed by learner acknowledgments without requiring the answer again", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const decision = mapConversationObservation({ ...input, lesson: CATCHING_UNICORNS_LESSON }, interruptionReplay.outputs as ConversationStateOutputs);
    const diagnostic = {
      classifierVersion: CLASSIFIER_VERSION, decision: decision.status, outcome: decision.outcome,
      outputs: decision.outputs, labelCompletionEligible: decision.labelCompletionEligible,
      thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS, nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision, elapsedMs: 12,
    };
    expect(parseLiveClassificationDiagnostic(diagnostic, CATCHING_UNICORNS_LESSON, "engram")).toEqual(diagnostic);
    return Response.json({ proposal: decision.proposal, diagnostic });
  });
  await start(CATCHING_UNICORNS_LESSON);
  let timestamp = 100;
  for (const line of interruptionReplay.transcript.split("\n")) {
    const child = line.startsWith("Child:");
    if (child) emit({ type: "microphone.activity_started" });
    else emit({ type: "output.activity", state: "active" });
    emit({ type: "transcript", speaker: child ? "child" : "sprout", delta: line.slice(line.indexOf(":") + 2), startMs: timestamp, endMs: timestamp + 100 });
    if (child) emit({ type: "microphone.speech_stopped", quietMs: 900 });
    timestamp += 200;
  }
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "engram", answerAccepted: true, acknowledgmentObserved: false });
  expect(runtime.snapshot().runtime?.conceptEvidence["engram:engram-biological"]?.status).toBe("demonstrated");
  await vi.advanceTimersByTimeAsync(4000);
  expect(transport.send.mock.calls.map(([command]) => command)).toContainEqual(expect.objectContaining({
    type: "session.instructions.append",
    content: expect.stringContaining("Do not ask the learner to repeat settled points"),
  }));
  expect(transport.send.mock.calls.map(([command]) => command)).toContainEqual(expect.objectContaining({
    type: "session.instructions.append", content: expect.stringContaining("Speak now:"),
  }));
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  tutorTranscript("Yes, your explanation of memory inside the mind answers this question.", timestamp);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "exogram", phase: "rendering" });
});

it("replays Exographics progress and requests completion after the earlier support recovery was spent", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const confirmed = input.transcript.endsWith("Yes, that completes this question.");
    const snapshot = progressReplay.snapshots.find(item => JSON.stringify(transcriptMessages(item.transcript)) === JSON.stringify(transcriptMessages(input.transcript)));
    // The two held snapshots are original report scores. The closing tutor
    // response below is a controlled transport scenario, not a provider replay.
    const outputs = structuredClone(snapshot?.outputs ?? progressReplay.snapshots[1].outputs) as ConversationStateOutputs;
    if (!snapshot && !confirmed) throw new Error("Unexpected replay transcript");
    if (confirmed) outputs.tutorState = {
      choice: "confirmed_completion", confidence: 1,
      probabilities: { confirmed_completion: 1, clarifying: 0, helping: 0, asking: 0, other: 0 },
    };
    const decision = mapConversationObservation({ ...input, lesson: CATCHING_UNICORNS_LESSON }, outputs);
    return Response.json({ proposal: decision.proposal, diagnostic: {
      classifierVersion: CLASSIFIER_VERSION, decision: decision.status, outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}), outputs: decision.outputs,
      labelCompletionEligible: decision.labelCompletionEligible, thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, elapsedMs: 12,
    } });
  });
  await start({ ...CATCHING_UNICORNS_LESSON, initialNodeId: "exographics" });
  let previousLines = 0;
  let timestamp = 100;
  const recoveries = () => transport.send.mock.calls.map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":answer-recovery:"));
  for (const [index, snapshot] of progressReplay.snapshots.entries()) {
    const messages = transcriptMessages(snapshot.transcript)!;
    for (const message of messages.slice(previousLines)) {
      const child = message.speaker === "Child";
      if (child) emit({ type: "microphone.activity_started" });
      emit({ type: "transcript", speaker: child ? "child" : "sprout", delta: message.text, startMs: timestamp, endMs: timestamp + 100 });
      if (child) emit({ type: "microphone.speech_stopped", quietMs: 900 });
      timestamp += 200;
    }
    previousLines = messages.length;
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().runtime?.nodeId).toBe("exographics");
    if (index === 0) {
      expect(runtime.snapshot().runtime?.conceptEvidence["exographics:visual-symbols"]?.status).not.toBe("demonstrated");
      await vi.advanceTimersByTimeAsync(4000);
      expect(recoveries()).toHaveLength(1);
      expect(recoveries()[0]).toMatchObject({ content: expect.stringContaining("Private focus: visual-symbols") });
    } else {
      for (const concept of CATCHING_UNICORNS_LESSON.nodes.exographics.concepts!)
        expect(runtime.snapshot().runtime?.conceptEvidence[`exographics:${concept.id}`]?.status).toBe("demonstrated");
      expect(recoveries()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(recoveries()).toHaveLength(2);
      expect(recoveries()[1]).toMatchObject({ content: expect.stringContaining("This supersedes earlier recovery focus") });
      expect(recoveries()[1]).toMatchObject({ content: expect.stringContaining("Accepted private targets: visual-symbols, cultural-agreement, beyond-prose, abstract-concepts") });
      await vi.advanceTimersByTimeAsync(5000);
      expect(recoveries()).toHaveLength(2);
    }
  }
  tutorTranscript("Yes, that completes this question.", timestamp);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "why-exographics", phase: "rendering" });
});

it("replays the first-question microphone starvation, recovers, and requires fresh learner evidence before advancing", async () => {
  let freshAnswer = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const outputs = structuredClone(freshAnswer ? locationReplay.outputs : locationReplay.originalEarlyOutputs) as ConversationStateOutputs;
    if (freshAnswer) outputs.sources = sourceOutputs(input.transcript, {
      "engram-biological": transcriptMessages(input.transcript)!.findLastIndex(message => message.speaker === "Child"),
    });
    const decision = mapConversationObservation({ ...input, lesson: CATCHING_UNICORNS_LESSON }, outputs);
    return Response.json({ proposal: decision.proposal, diagnostic: {
      classifierVersion: CLASSIFIER_VERSION, decision: decision.status, outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}), outputs: decision.outputs,
      labelCompletionEligible: decision.labelCompletionEligible, thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, elapsedMs: 12,
    } });
  });
  await start(CATCHING_UNICORNS_LESSON);
  for (const item of locationReplay.events) {
    await vi.advanceTimersByTimeAsync(item.atMs - performance.now());
    emit(item.event as ProviderEvent);
  }
  const requests = runtime.report().events.filter(event => event.type === "answer_recovery.requested");
  expect(requests).toHaveLength(1);
  expect(requests[0].atMs).toBeLessThan(35000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "engram", hasChildTranscript: false, answerAccepted: false });
  expect(transport.send.mock.calls.map(([command]) => command)).toContainEqual(expect.objectContaining({
    type: "session.instructions.append", event_id: expect.stringContaining(":answer-recovery:"),
  }));
  freshAnswer = true;
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "It is biological memory inside my mind.", startMs: 50000, endMs: 50100 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  tutorTranscript("Yes, that's right.", 50200);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "exogram", phase: "rendering" });
});
