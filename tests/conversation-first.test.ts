import { useRuntimeFakeTimers, providerEvents } from "./helpers/runtime-harness";
import { afterEach, expect, it, vi } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  classificationSource,
  createLessonRuntime,
  learnerRequestedNext,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
} from "../lib/lesson-runtime/conversation-assessment";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import replay from "./fixtures/catching-unicorns-stall-replay.json";
import questionSix from "./fixtures/catching-unicorns-question-six-replay.json";
import {
  createLiveSessionConfig,
  teachingInstruction,
  answerRecoveryInstruction,
} from "../lib/lesson-runtime/live-context";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { classifierProposal } from "./helpers/runtime-classifier";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";

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

// Scripted observer decisions exercise the actual transport/reducer boundary.
// Neither these transcripts nor the mock decisions evaluate a voice model.
it.each([
  {
    name: "association-only synthesis followed by a neutral reasoning probe",
    nodeId: "synthesis",
    criterionId: "synthesis-culture",
    answer: "Symbols, literacy and universities are connected.",
    reply: "How does that connection work in your university example?",
    act: "clarifying",
    observation: "partial",
  },
  {
    name: "sufficient causal explanation closes without requiring the other synthesis targets",
    nodeId: "synthesis",
    criterionId: "synthesis-reasoning",
    answer:
      "Writing the intermediate sums keeps them visible so I can check them and continue without remembering each one.",
    reply: "You explained how the visible steps let you check and continue your reasoning.",
    act: "acknowledging",
    observation: "demonstrated_independent",
  },
  {
    name: "explicit CAF clarification supplies a distinction but no learner demonstration",
    nodeId: "caf-application",
    criterionId: "caf-education-evidence",
    answer: "I named a college. Is that what you are getting at?",
    reply:
      "I mean basic education for most people versus advanced study for some. Which part does your example support?",
    act: "helping",
    observation: "partial",
  },
  {
    name: "CAF uncertainty closes with an unresolved application rather than a canonical conclusion",
    nodeId: "caf-application",
    criterionId: "caf-education-evidence",
    answer:
      "A college might support advanced study for some, but I do not know what basic education most members receive.",
    reply: "You have proposed evidence for advanced study and left the broader education claim open.",
    act: "acknowledging",
    observation: "partial",
  },
] as const)("preserves conversation and evidence boundaries: $name", async scenario => {
  useRuntimeFakeTimers();
  let afterHelp = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== "/api/classify") return Response.json({}, { status: 503 });
    const input = JSON.parse(init?.body as string);
    const messages = transcriptMessages(input.transcript)!;
    const learnerIndex = afterHelp
      ? messages.findLastIndex(message => message.speaker === "Child")
      : messages.findIndex(message => message.speaker === "Child");
    return Response.json({
      proposal: classifierProposal(input, {
        answerOutcome: "unclear",
        tutorState: messages.at(-1)?.speaker === "Tutor" ? scenario.act : "unknown",
        conceptObservations: [
          {
            criterionId: scenario.criterionId,
            observation: afterHelp ? "demonstrated_prompted" : scenario.observation,
            childMessageIndex: learnerIndex,
          },
        ],
      }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...lesson, initialNodeId: scenario.nodeId });
  const edge = lesson.nodes[scenario.nodeId].onSuccess;
  if (edge.kind !== "node") throw new Error("Expected next scene");
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const steering = transport.send.mock.calls[0][0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    expect(steering.content).toContain(lesson.nodes[scenario.nodeId].tutorBrief);
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn(scenario.answer, 100);
    await vi.advanceTimersByTimeAsync(300);
    const evidenceKey = `${scenario.nodeId}:${scenario.criterionId}`;
    const evidence = structuredClone(runtime.snapshot().runtime!.conceptEvidence[evidenceKey]);
    expect(evidence).toMatchObject({
      status: scenario.observation === "partial" ? "partial" : "demonstrated",
      source: { childTranscript: scenario.answer },
    });
    // Tutor assistance/acknowledgment cannot create additional learner evidence.
    transport.receive!({ type: "transcript", speaker: "sprout", delta: scenario.reply, startMs: 300, endMs: 400 });
    transport.receive!({ type: "output.activity", state: "active" });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().runtime?.nodeId).toBe(scenario.nodeId);
    expect(runtime.snapshot().runtime?.conceptEvidence[evidenceKey]).toEqual(evidence);
    const closes = scenario.act === "acknowledging";
    if (closes) {
      // An actual learner follow-up cancels pending closure before audio drains.
      events.childTurn("Could you clarify that?", 500);
      await vi.advanceTimersByTimeAsync(300);
      transport.receive!({ type: "output.activity", state: "quiet" });
      await vi.advanceTimersByTimeAsync(600);
      expect(runtime.snapshot().runtime?.nodeId).toBe(scenario.nodeId);
      expect(runtime.snapshot().runtime?.conversationAdvanceRequested).toBe(false);
      events.tutorTurn("I am acknowledging the part you explained and leaving the other claims open.", 700);
    }
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().runtime?.nodeId).toBe(closes ? edge.nodeId : scenario.nodeId);
    expect(runtime.snapshot().runtime?.conceptEvidence[evidenceKey]).toEqual(evidence);
    expect(Object.keys(runtime.snapshot().runtime!.conceptEvidence)).toEqual([evidenceKey]);
    if (!closes) {
      if (scenario.act === "helping") {
        afterHelp = true;
        const explanation =
          "In my example, basic reading, writing and arithmetic courses offered to all members would support broad basic education; degree programs would support advanced study for some. I still need to verify those claims.";
        events.childTurn(explanation, 500);
        await vi.advanceTimersByTimeAsync(300);
        expect(runtime.snapshot().runtime?.conceptEvidence[evidenceKey]).toMatchObject({
          status: "demonstrated",
          understanding: "prompted",
          source: { childTranscript: explanation },
        });
        expect(runtime.snapshot().runtime?.nodeId).toBe(scenario.nodeId);
        events.tutorTurn("You have separated the scope of the college example from the evidence still needed.", 700);
        await vi.advanceTimersByTimeAsync(600);
      }
      // Clarification is still available, and explicit navigation does not grant mastery.
      const beforeNavigation = structuredClone(runtime.snapshot().runtime!.conceptEvidence);
      events.childTurn("Please move on.", 900);
      await vi.advanceTimersByTimeAsync(900);
      expect(runtime.snapshot().runtime?.nodeId).toBe(edge.nodeId);
      expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(beforeNavigation);
    }
  } finally {
    runtime.stop();
    await vi.advanceTimersByTimeAsync(0);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function harness() {
  const definition = { ...lesson, initialNodeId: "exographics" };
  let state = createLessonRuntime("stall-replay", { lesson: definition, quietDrainMs: 50 });
  function send(event: Record<string, unknown>, delta = 1) {
    const result = reduceLessonRuntime(
      state,
      { ...event, atMs: state.nowMs + delta } as LessonRuntimeEvent,
      definition,
    );
    state = result.state;
    return result;
  }
  send({ type: "child.turn.started", source: runtimeSource(state) });
  send({ type: "transcript.updated", source: runtimeSource(state), revision: 1, speaker: "child" });
  send({ type: "child.turn.ended", source: runtimeSource(state) });
  return {
    get state() {
      return state;
    },
    send,
    definition,
  };
}
it("advances the recorded split-source stall while retaining three concepts and unresolved visual symbols", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "tutor" });
  const source = classificationSource(h.state)!;
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    replay.outputs as ConversationStateOutputs,
  );
  expect(decision.outcome).toBe("allow_semantic_completion_evidence");
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  expect(h.state.answerAccepted).toBe(false);
  expect(h.state.conceptEvidence["exographics:visual-symbols"]).toBeUndefined();
  expect(Object.values(h.state.conceptEvidence).filter(e => e.status === "demonstrated")).toHaveLength(3);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  expect(h.state.nodeId).toBe("exographics");
  const result = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(result.state).toMatchObject({ nodeId: "why-exographics", phase: "rendering" });
});
it("ignores stale closure and revoked completion after a tutor follow-up", () => {
  const h = harness();
  const stale = classificationSource(h.state)!;
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "tutor" });
  const source = classificationSource(h.state)!;
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    replay.outputs as ConversationStateOutputs,
  );
  h.send({
    type: "proposal.received",
    source: stale,
    proposal: decision.proposal,
    transcriptSnapshot: replay.transcript,
  });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  expect(h.state.conversationAdvanceRequested).toBe("tutor");
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 3, speaker: "tutor" });
  expect(h.state.conversationAdvanceRequested).toBe(false);
});
it.each(["Next question, then", "Please move on", "Can we go to the next question?", "Skip this question."])(
  "honors %s without accepting uncertain evidence",
  text => {
    const h = harness();
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({
      type: "conversation.advance.requested",
      source: classificationSource(h.state),
      transcriptSnapshot: `Child: ${text}`,
    });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
    expect(h.state.nodeId).toBe("why-exographics");
    expect(h.state.conceptEvidence).toEqual({});
  },
);
it("never treats quoted requests, tutor speech, or a learner answer containing next question as a navigation request", () => {
  for (const text of [
    "Tutor: Next question, then",
    'Child: The book says "next question".',
    "Child: What does the next question mean?",
    "Child: Next question, but first explain this.",
  ])
    expect(learnerRequestedNext(text)).toBe(false);
});
const assessmentBody = () => ({
  version: ASSESSMENT_VERSION,
  answers: Object.fromEntries(
    Object.keys(assessmentQuestions(lesson)).map(key => [
      key,
      key.endsWith(":understanding")
        ? {
            type: "choice",
            choice: "partial",
            confidence: 0.6,
            probabilities: { not_yet: 0.1, partial: 0.6, demonstrated: 0.3 },
          }
        : {
            type: "choice",
            choice: "unclear",
            confidence: 1,
            probabilities: { independent: 0, prompted: 0, unclear: 1 },
          },
    ]),
  ),
});
it("preserves full probabilities and uncertain grading without single-message attribution", () => {
  const body = assessmentBody();
  const result = normalizeAssessment(body, lesson)!;
  expect(result.results["exographics:visual-symbols"].understanding.outcome).toBe("uncertain");
  expect(result.results["exographics:visual-symbols"].understanding.scores.probabilities.partial).toBe(0.6);
  expect(assessmentQuestions(lesson)["exographics:visual-symbols:understanding"].instructions).toContain(
    "combined across multiple learner answers",
  );
  const broken = structuredClone(body);
  broken.answers["exographics:visual-symbols:understanding"].probabilities.partial = 2;
  expect(normalizeAssessment(broken, lesson)).toBeNull();
});
it("advances explicit next in the real runtime even with classifier outage, and assesses the saved conversation after stopping", async () => {
  useRuntimeFakeTimers();
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/assess"
      ? Response.json({ assessment: normalizeAssessment(assessmentBody(), lesson) })
      : url === "/api/classify"
        ? Response.json({}, { status: 503 })
        : Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...lesson, initialNodeId: "exographics" });
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("Next question, then", 100);
  await vi.advanceTimersByTimeAsync(900);
  expect(runtime.snapshot().display.nodeId).toBe("why-exographics");
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/classify")).toBe(false);
  runtime.confirmRendered(runtime.snapshot().display);
  runtime.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.report().conversation?.[0].transcript).toContain("Next question, then");
  expect(runtime.report().assessment?.status).toBe("complete");
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
});

it.each([
  { nodeId: "recap", configured: true },
  { nodeId: "summary", configured: true },
  { nodeId: "ordinary", configured: false },
  { nodeId: "recap", configured: false },
])("assesses on confirmed entry to $nodeId only when configured=$configured", async ({ nodeId, configured }) => {
  useRuntimeFakeTimers();
  const fetchMock = vi.fn(async () => Response.json({ assessment: normalizeAssessment(assessmentBody(), lesson) }));
  vi.stubGlobal("fetch", fetchMock);
  const { assessConversationOnEntry, ...ordinaryScene } = lesson.nodes.recap;
  expect(assessConversationOnEntry).toBe(true);
  const definition = {
    ...lesson,
    initialNodeId: "synthesis",
    nodes: {
      ...lesson.nodes,
      synthesis: { ...lesson.nodes.synthesis, onSuccess: { kind: "node" as const, nodeId } },
      [nodeId]: { ...ordinaryScene, id: nodeId, ...(configured ? { assessConversationOnEntry: true } : {}) },
    },
  };
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const steering = transport.send.mock.calls[0][0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Next question, then", 100);
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().runtime).toMatchObject({ nodeId, phase: "rendering" });
    expect(fetchMock).not.toHaveBeenCalled();

    const display = runtime.snapshot().display;
    runtime.confirmRendered(display);
    // Assessment starts at render confirmation, without waiting for the steering acknowledgment.
    expect(fetchMock).toHaveBeenCalledTimes(configured ? 1 : 0);
    if (configured) {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/assess",
        expect.objectContaining({
          body: JSON.stringify({
            lessonId: lesson.id,
            visits: runtime.report().conversation,
            owner: { runtimeId: runtime.report().runtimeId, generation: 1 },
          }),
        }),
      );
      runtime.confirmRendered(display);
      runtime.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(runtime.report().assessment?.status).toBe("complete");
    }
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  } finally {
    runtime.stop();
    await vi.advanceTimersByTimeAsync(0);
  }
});

it.each(["active", "unavailable"] as const)("holds a next request while audio is %s", activity => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: activity });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: "Child: Next question, then",
  });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(h.state.nodeId).toBe("why-exographics");
});
it("revokes a next request when a new learner turn interrupts it", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: "Child: Next question, then",
  });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
  expect(h.state.conversationAdvanceRequested).toBe(false);
});

it.each([
  questionSix.request,
  "Yep, next question",
  "yep next question",
  "YEP, NEXT QUESTION!",
  "Yep. Next question?",
  "  Yep, \t next\nquestion.  ",
  "Yeah, I think next question. I think I have answered this.",
  "I am, I think next\nquestion. I think I've answered this",
])("recognizes conversational navigation: %s", request => {
  expect(learnerRequestedNext(`Child: ${request}\nTutor: Okay, we'll move on.`)).toBe(true);
});
it.each([
  '"Yep, next question"',
  'Yep, he said "next question".',
  "Yep, don't move on.",
  "Yep, if I say next question, will you move on?",
  "Yep, what does the next question mean?",
  "Yep, next question is about schools.",
  "Yep, next question. Actually, don't move on.",
  "Yep, next question, but first explain this.",
  "I don't think next question.",
  "I think we should not move on.",
  "Don't move on.",
  'He said "next question".',
  "She asked us to move on.",
  "Next question, but first explain this.",
  "Can you explain the next question?",
  "If I say next question, will you move on?",
  "I think next question is about schools.",
  "I think next question. Actually, don't move on.",
])("rejects negative, quoted, hypothetical and answer intent: %s", request => {
  expect(learnerRequestedNext(`Child: ${request}`)).toBe(false);
});
it("replays question six empty turn, split tutor closure and audio gaps without granting mastery or advancing twice", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, {
    ...lesson,
    initialNodeId: "techno-literate-culture",
  });
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  const receive = transport.receive!;
  events.acknowledgeSteering(steering.event_id, 0);
  receive({ type: "output.activity", state: "quiet" });
  receive({ type: "microphone.activity_started" });
  receive({ type: "transcript", speaker: "child", delta: questionSix.request, ...questionSix.requestInterval });
  let elapsed = 0;
  for (const item of questionSix.events) {
    await vi.advanceTimersByTimeAsync(item.atMs - elapsed);
    elapsed = item.atMs;
    receive(item.event as ProviderEvent);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
  }
  expect(runtime.snapshot().runtime?.hasChildTranscript).toBe(false);
  expect(classificationSource(runtime.snapshot().runtime!)).toBeNull();
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().display.nodeId).toBe("caf-application");
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  const journal = runtime.observe().events;
  expect(journal.filter(e => e.type === "render.requested")).toHaveLength(1);
  expect(journal.some(e => e.type === "classifier.started")).toBe(false);
  expect(journal.some(e => e.type === "gpt_live.answer_recovery_append")).toBe(false);
  expect(runtime.report().conversation?.[0].transcript).toContain("Okay, we'll move on.");
  runtime.stop();
});
it("retains partial evidence when a request advances with no current-turn transcript", () => {
  const h = harness();
  const source = classificationSource(h.state)!;
  const outputs = structuredClone(replay.outputs) as ConversationStateOutputs;
  const partial = {
    choice: "partial",
    confidence: 1,
    probabilities: { not_yet: 0, partial: 1, demonstrated_independent: 0, demonstrated_prompted: 0 },
  } as const;
  outputs.concepts = { ...outputs.concepts, "concept_visual-symbols": partial };
  outputs.sources = {
    ...outputs.sources,
    "source_visual-symbols": {
      choice: "message_1",
      confidence: 1,
      probabilities: { none: 0, message_1: 1, message_3: 0 },
    },
  };
  const decision = mapConversationObservation(
    { ...source, lesson: h.definition, transcript: replay.transcript },
    outputs,
  );
  h.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: replay.transcript });
  const evidence = structuredClone(h.state.conceptEvidence);
  expect(evidence["exographics:visual-symbols"].status).toBe("partial");
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  expect(classificationSource(h.state)).toBeNull();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: { ...runtimeSource(h.state), nodeId: h.state.nodeId, transcriptRevision: h.state.transcriptRevision },
    transcriptSnapshot: `Child: ${questionSix.request}\nTutor: Okay, we'll move on.`,
  });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 51);
  expect(h.state.nodeId).toBe("why-exographics");
  expect(h.state.conceptEvidence).toEqual(evidence);
});
it("limits question-six help through all instruction layers while preserving provenance", () => {
  const context = currentNodeContext(lesson, "techno-literate-culture");
  expect(lesson.nodes["techno-literate-culture"].presentation.prompt).toBe("Give two examples of what makes a culture techno-literate.");
  expect(context.tutorBrief).toContain("at most one short, neutral clarification");
  expect(context.tutorBrief).toContain("Tutor words are not learner evidence");
  const config = createLiveSessionConfig(lesson);
  expect(config.instructions).toContain("only when explicitly permitted by the current scene tutor brief");
  expect(config.instructions).not.toContain("Never state hidden canonical answers");
  expect(teachingInstruction(context, lesson)).toContain("at most one short, neutral clarification");
  const h = harness();
  expect(answerRecoveryInstruction(lesson, h.state)).toContain("targeted scaffolding");
  expect(assessmentQuestions(lesson)["techno-literate-culture:education-system:understanding"].instructions).toContain(
    "Tutor-only content",
  );
});

it("revokes pending navigation on actual new learner text, even without another microphone onset", () => {
  const h = harness();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: `Child: ${questionSix.request}`,
  });
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 2, speaker: "child" });
  expect(h.state.conversationAdvanceRequested).toBe(false);
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.nodeId).toBe("exographics");
});

it("advances two culture examples only after tutor acknowledgment and audio drain, then waits for CAF rendering and steering acknowledgment", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({}, { status: 503 });
      const input = JSON.parse(init?.body as string);
      const messages = transcriptMessages(input.transcript)!;
      return Response.json({
        proposal: classifierProposal(input, {
          answerOutcome: "correct",
          tutorState: messages.at(-1)?.speaker === "Tutor" ? "acknowledging" : "unknown",
          conceptObservations: ["widespread-literacy", "idea-discoverers"].map(criterionId => ({
            criterionId,
            observation: "demonstrated_independent" as const,
            childMessageIndex: messages.findIndex(message => message.speaker === "Child"),
          })),
        }),
      });
    }),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, {
    ...lesson,
    initialNodeId: "techno-literate-culture",
  });
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const steering = transport.send.mock.calls[0][0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    expect(steering.content).toContain("Give two examples of what makes a culture techno-literate.");
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Most people can read and write; some specialize in finding new ideas.", 100);
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    const evidence = structuredClone(runtime.snapshot().runtime!.conceptEvidence);
    expect(Object.keys(evidence)).toEqual([
      "techno-literate-culture:widespread-literacy",
      "techno-literate-culture:idea-discoverers",
    ]);
    transport.receive!({
      type: "transcript",
      speaker: "sprout",
      delta: "Thank you for those two examples.",
      startMs: 300,
      endMs: 400,
    });
    transport.receive!({ type: "output.activity", state: "active" });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    transport.receive!({ type: "output.activity", state: "unavailable" });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    await vi.advanceTimersByTimeAsync(500);
    // Unavailable audio revokes the pending closure; restored quiet cannot revive it.
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    events.tutorTurn("You gave two relevant examples.", 500);
    await vi.advanceTimersByTimeAsync(600);
    expect(runtime.snapshot().display.nodeId).toBe("caf-application");
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(evidence);
    expect(transport.send).toHaveBeenCalledTimes(1);
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const nextSteering = transport.send.mock.calls[1][0];
    if (nextSteering.type !== "session.instructions.append") throw new Error("Expected CAF steering");
    expect(nextSteering.content).toContain("four-characteristic techno-literate-culture framework");
    expect(runtime.snapshot().awaitingSteering).toBe(true);
    events.acknowledgeSteering(nextSteering.event_id, 600);
    expect(runtime.snapshot().awaitingSteering).toBe(false);
    expect(runtime.snapshot().runtime?.phase).toBe("active");
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(evidence);
  } finally {
    runtime.stop();
  }
});

it("honors yep navigation through speech, audio drain and render gates while retaining partial evidence", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({}, { status: 503 });
      const input = JSON.parse(init?.body as string);
      return Response.json({
        proposal: classifierProposal(input, {
          answerOutcome: "unclear",
          tutorState: "unknown",
          conceptObservations: [
            {
              criterionId: "widespread-literacy",
              observation: "partial",
              childMessageIndex: 0,
            },
          ],
        }),
      });
    }),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, {
    ...lesson,
    initialNodeId: "techno-literate-culture",
  });
  try {
    const initialDisplay = runtime.snapshot().display;
    runtime.confirmRendered(initialDisplay);
    await vi.advanceTimersByTimeAsync(0);
    const steering = transport.send.mock.calls[0][0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
    events.acknowledgeSteering(steering.event_id, 0);
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Some people can read.", 100);
    await vi.advanceTimersByTimeAsync(300);
    const evidence = structuredClone(runtime.snapshot().runtime!.conceptEvidence);
    expect(evidence["techno-literate-culture:widespread-literacy"].status).toBe("partial");
    events.tutorTurn("I didn't catch your answer. Are you still there?", 300);
    transport.receive!({ type: "microphone.activity_started" });
    transport.receive!({ type: "transcript", speaker: "child", delta: "Yep, next question", startMs: 500, endMs: 600 });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    expect(runtime.snapshot().runtime?.conversationAdvanceRequested).toBe(false);
    transport.receive!({ type: "output.activity", state: "active" });
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    await vi.advanceTimersByTimeAsync(900);
    expect(runtime.snapshot().runtime?.conversationAdvanceRequested).toBe("learner");
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.snapshot().display.nodeId).toBe("techno-literate-culture");
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.snapshot().display.nodeId).toBe("caf-application");
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(evidence);
    runtime.confirmRendered(initialDisplay);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    expect(transport.send).toHaveBeenCalledTimes(1);
    runtime.confirmRendered(runtime.snapshot().display);
    await vi.advanceTimersByTimeAsync(0);
    const nextSteering = transport.send.mock.calls[1][0];
    if (nextSteering.type !== "session.instructions.append") throw new Error("Expected CAF steering");
    expect(runtime.snapshot().awaitingSteering).toBe(true);
    events.acknowledgeSteering(nextSteering.event_id, 700);
    expect(runtime.snapshot().runtime?.phase).toBe("active");
    expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(evidence);
    expect(runtime.observe().events.filter(event => event.type === "render.requested")).toHaveLength(1);
  } finally {
    runtime.stop();
  }
});
