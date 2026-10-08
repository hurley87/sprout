import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyConversationStateWithDiagnostics } from "../lib/experiments/issue-57/legacy/jev-conversation-state-classifier";
import { COUNTING_LESSON_GRAPH, COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import { SPROUT_LIVE_CONFIG, teachingInstruction } from "./helpers/counting-live-context";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "./helpers/counting-runtime";
import { conversationProbabilities, conversationProviderBody } from "./fixtures/conversation-classification";

// Literal diagnostic excerpt, not independent audio verification or a claim of mastery.
// sprout-lesson-e5458bfc-058b-4947-878e-43760307b4d3.json, final revision 24.
const recordedInput = {
  nodeId: "count-1-duck" as const,
  transcriptRevision: 24,
  transcript:
    "Tutor: How many ducks do you see on the screen?\nChild: Can you help\n" +
    "Tutor: Sure. Let's count slowly together. Start with one...\nChild: One\n" +
    "Tutor: Yes. One duck. You're counting carefully!",
};
const recordedProbabilities = {
  answerCorrect: 0.94,
  answerIncorrect: 0.03,
  answerUnclear: 0.13,
  answerNone: 0.03,
  needsHelp: 0.23,
  tutorAcknowledging: 0.96,
  tutorAsking: 0.03,
  tutorClarifying: 0.07,
  tutorHelping: 0.09,
};
const learnerLedHelp = "Child: Can you help\nTutor: Point to the duck and count it. What do you get?";

function mockProvider(values = conversationProbabilities()) {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(conversationProviderBody(values)),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("current support after help (mock provider, no semantic calibration)", () => {
  it("preserves the recorded abstention, full history, and latest acknowledgment without coercing support", async () => {
    const fetch = mockProvider(recordedProbabilities);
    const decision = await classifyConversationStateWithDiagnostics(recordedInput, new AbortController().signal);
    expect(decision).toMatchObject({
      status: "abstained",
      reason: "support_ambiguous",
      probabilities: recordedProbabilities,
      detail: { category: "support", candidate: "needsHelp", candidateProbability: 0.23 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const wire = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(wire.state).toEqual({
      ...recordedInput,
      supportEvidence: {
        precedingContext: [
          { speaker: "Tutor", text: "How many ducks do you see on the screen?" },
          { speaker: "Child", text: "Can you help" },
          { speaker: "Tutor", text: "Sure. Let's count slowly together. Start with one..." },
        ],
        latestChildAttempt: { speaker: "Child", text: "One" },
        subsequentMessages: [{ speaker: "Tutor", text: "Yes. One duck. You're counting carefully!" }],
      },
      scene: { object: "duck", quantity: 1 },
      learningObjective: "Identify the total of one displayed duck.",
      tutorObservation: {
        latestMessage: "Yes. One duck. You're counting carefully!",
        precedingChildAttempt: "One",
      },
    });
    // Verify delivered temporal/support criteria, not their effect on real Jev scores.
    const support = wire.questions.needsHelp;
    expect(support.instructions).toContain("Track help requests and their resolution in transcript order");
    expect(support.instructions).toContain("Tutor acknowledgment alone cannot resolve difficulty");
    expect(support.instructions).toContain("repeating a tutor-supplied number");
    expect(support.criteria.true).toContain("remains unresolved after considering later child responses");
    expect(support.criteria.true).toContain("A renewed help request remains current");
    expect(support.criteria.false).toContain("no continuing difficulty or renewed request");
    expect(support.criteria.false).toContain("not independent mastery");
  });

  it.each([
    {
      label: "help alone",
      transcript: learnerLedHelp,
      values: { answerCorrect: 0.01, answerNone: 0.97, needsHelp: 0.96, tutorAcknowledging: 0.01, tutorHelping: 0.97 },
      answerOutcome: "none",
      supportState: "needs_help",
      tutorState: "helping",
    },
    {
      label: "historical help followed by a learner-supplied settled answer and acknowledgment",
      transcript: learnerLedHelp + "\nChild: One\nTutor: Yes, one duck!",
      values: {},
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
    },
    {
      label: "correct answer with a renewed explicit help request",
      transcript: learnerLedHelp + "\nChild: One\nTutor: Yes, one duck!\nChild: I still need help",
      values: { needsHelp: 0.97 },
      answerOutcome: "correct",
      supportState: "needs_help",
      tutorState: "acknowledging",
    },
    {
      label: "incorrect follow-up leaves prior help unresolved",
      transcript: learnerLedHelp + "\nChild: Two\nTutor: Try pointing and counting again.",
      values: {
        answerCorrect: 0.01,
        answerIncorrect: 0.97,
        needsHelp: 0.97,
        tutorAcknowledging: 0.01,
        tutorHelping: 0.97,
      },
      answerOutcome: "incorrect",
      supportState: "needs_help",
      tutorState: "helping",
    },
    {
      label: "unclear follow-up leaves prior help unresolved",
      transcript: learnerLedHelp + "\nChild: One? I don't know\nTutor: Can you count the duck?",
      values: {
        answerCorrect: 0.01,
        answerUnclear: 0.97,
        needsHelp: 0.97,
        tutorAcknowledging: 0.01,
        tutorHelping: 0.97,
      },
      answerOutcome: "unclear",
      supportState: "needs_help",
      tutorState: "helping",
    },
    {
      label: "tutor-supplied total alone is not a child answer",
      transcript: "Child: Can you help\nTutor: Start with one. One duck!",
      values: { answerCorrect: 0.01, answerNone: 0.97, needsHelp: 0.97, tutorAcknowledging: 0.01, tutorHelping: 0.97 },
      answerOutcome: "none",
      supportState: "needs_help",
      tutorState: "helping",
    },
    {
      label: "tentative repetition does not resolve help even if the tutor says yes",
      transcript: "Child: Can you help\nTutor: Start with one\nChild: One? I still don't know\nTutor: Yes, one duck!",
      values: { answerCorrect: 0.01, answerUnclear: 0.97, needsHelp: 0.97, tutorAcknowledging: 0.01 },
      answerOutcome: "unclear",
      supportState: "needs_help",
      tutorState: "unknown",
    },
  ] as const)("retains evidence and maps supplied observations for $label", async example => {
    const fetch = mockProvider(conversationProbabilities(example.values));
    const input = { ...recordedInput, transcript: example.transcript };
    const decision = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
    expect(decision).toMatchObject({
      status: "accepted",
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        answerOutcome: example.answerOutcome,
        supportState: example.supportState,
        tutorState: example.tutorState,
      },
    });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).state.transcript).toBe(example.transcript);
  });
});

describe("help instruction delivery (static, not GPT-Live conversational quality)", () => {
  it.each(COUNTING_NODE_IDS)("supplies learner-led counting in the authored brief for %s", id => {
    const brief = COUNTING_LESSON_GRAPH[id].tutorBrief;
    expect(brief).toContain("point to");
    expect(brief).toContain("themselves");
    expect(brief).toContain("wait");
    if (id === "count-1-duck") expect(brief).toContain("starting the count reveals the total");
    else expect(brief).toContain("without starting or finishing the count or giving the total");
  });

  it("delivers full hint guidance in durable session instructions", () => {
    const instruction = SPROUT_LIVE_CONFIG.instructions;
    expect(instruction).toContain('"Point to each duck and say the counting words. What do you get?"');
    expect(instruction).toContain("use the current object's name");
    expect(instruction).toContain("Do not start or finish the count for the child");
    expect(instruction).toContain("supply the total through a leading question");
    expect(instruction).toContain('"Start with one" reveals the answer');
    expect(instruction).toContain('"Point to the duck and count it. What do you get?"');
    expect(instruction).toContain("If the child only echoes a number you supplied or remains unsure");
  });
  it.each(COUNTING_NODE_IDS)("keeps the %s append compact with its current brief and support reminders", id => {
    const node = COUNTING_LESSON_GRAPH[id];
    const instruction = teachingInstruction({
      nodeId: id,
      scene: { id: node.sceneId, object: node.object, quantity: node.quantity },
      learningObjective: node.learningObjective,
      tutorBrief: node.tutorBrief,
    });
    expect(instruction).toContain(node.tutorBrief);
    expect(instruction).toContain("Follow the session counting and help guidance");
    expect(instruction).toContain("let the child supply the count and total");
    expect(instruction).toContain("never supply the count or total as a hint");
    // Static text-size regression for our authored English, not a model tokenizer.
    // Current appends are separately checked with public tokenizers against 500 tokens.
    expect(new TextEncoder().encode(instruction).length).toBeLessThanOrEqual(1200);
  });
});

describe("help recovery authority (mock semantic observations)", () => {
  it.each([
    { answerOutcome: "none", supportState: "needs_help", tutorState: "helping" },
    { answerOutcome: "incorrect", supportState: "needs_help", tutorState: "helping" },
    { answerOutcome: "unclear", supportState: "needs_help", tutorState: "clarifying" },
    { answerOutcome: "correct", supportState: "needs_help", tutorState: "acknowledging" },
  ] as const)(
    "holds $answerOutcome/$supportState, then recovers only with fresh success and the full handoff",
    observation => {
      let state = createLessonRuntime("help-recovery", { quietDrainMs: 250 });
      const send = (event: LessonRuntimeEvent) => {
        const result = reduceLessonRuntime(state, event);
        state = result.state;
        return result.effects;
      };
      const child = () => {
        send({ type: "child.turn.started", source: runtimeSource(state), atMs: state.nowMs + 1 });
        send({
          type: "transcript.updated",
          source: runtimeSource(state),
          speaker: "child",
          revision: state.transcriptRevision + 1,
          atMs: state.nowMs + 1,
        });
        send({ type: "child.turn.ended", source: runtimeSource(state), atMs: state.nowMs + 1 });
      };
      const observe = (
        fields:
          | typeof observation
          | { answerOutcome: "correct"; supportState: "none"; tutorState: "unknown" | "acknowledging" },
      ) => {
        send({
          type: "transcript.updated",
          source: runtimeSource(state),
          speaker: "tutor",
          revision: state.transcriptRevision + 1,
          atMs: state.nowMs + 1,
        });
        return send({
          type: "proposal.received",
          source: classificationSource(state)!,
          proposal: {
            nodeId: state.nodeId,
            transcriptRevision: state.transcriptRevision,
            childActivity: "unknown",
            ...fields,
          },
          atMs: state.nowMs + 1,
        });
      };
      const output = (activity: "active" | "quiet") =>
        send({ type: "output.activity", source: runtimeSource(state), state: activity, atMs: state.nowMs + 1 });
      const tick = (ms: number) => send({ type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + ms });
      child();
      observe(observation);
      const staleSource = classificationSource(state)!;
      output("active");
      output("quiet");
      expect(tick(250)).toEqual([]);
      expect(state).toMatchObject({
        nodeId: "count-1-duck",
        phase: "active",
        pendingRender: null,
        answerAccepted: false,
      });

      child();
      const success = { answerOutcome: "correct", supportState: "none", tutorState: "acknowledging" } as const;
      expect(
        send({
          type: "proposal.received",
          source: staleSource,
          proposal: {
            nodeId: staleSource.nodeId,
            transcriptRevision: staleSource.transcriptRevision,
            childActivity: "unknown",
            ...success,
          },
          atMs: state.nowMs + 1,
        }),
      ).toEqual([]);
      expect(state.answerAccepted).toBe(false);
      observe({ ...success, tutorState: "unknown" });
      output("active");
      output("quiet");
      expect(tick(250)).toEqual([]); // Drained output alone cannot supply acknowledgment.
      output("active");
      expect(observe(success)).toEqual([]); // Acknowledgment cannot hand off during relevant output.
      expect(state.phase).toBe("active");
      output("quiet");
      expect(tick(249)).toEqual([]);
      expect(tick(1)).toMatchObject([{ type: "render.requested", identity: { nodeId: "count-2-ducks" } }]);
      const pending = state.pendingRender!.identity;
      expect(state.phase).toBe("rendering");
      expect(
        send({
          type: "render.confirmed",
          runtimeId: state.runtimeId,
          identity: { ...pending, token: "wrong" },
          atMs: state.nowMs + 1,
        }),
      ).toEqual([]);
      expect(
        send({ type: "render.confirmed", runtimeId: state.runtimeId, identity: pending, atMs: state.nowMs + 1 }),
      ).toMatchObject([{ type: "steering.ready", context: { nodeId: "count-2-ducks" } }]);
    },
  );
});
