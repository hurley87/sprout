import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { ICE_CREAM_LESSON, ICE_CREAM_NODE_IDS } from "../lib/lesson-runtime/ice-cream-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { COUNTING_HALLOWEEN_LESSON } from "../lib/lesson-runtime/counting-halloween-lesson";
import {
  conversationObserverState,
  conversationStateQuestions,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { currentNodeContext, lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

describe("ice cream lesson", () => {
  it("validates the shared node and scene contract", () => {
    expect(validateLessonDefinition(ICE_CREAM_LESSON)).toBe(ICE_CREAM_LESSON);
    expect(lessonNodeOrder(ICE_CREAM_LESSON)).toEqual(ICE_CREAM_NODE_IDS);
    expect(ICE_CREAM_NODE_IDS.map(id => ICE_CREAM_LESSON.nodes[id].presentation)).toEqual([
      { sceneId: "open-shop", answerKind: "count", answer: 2, object: "cone", quantity: 2 },
      { sceneId: "pink-scoop", answerKind: "colour", answer: "pink", choices: "pink or yellow" },
      {
        sceneId: "pink-scoops",
        answerKind: "count",
        answer: 2,
        object: "pink scoop",
        quantity: 2,
        distractor: "one yellow scoop",
      },
      {
        sceneId: "build-first",
        answerKind: "order_step",
        answer: "pink",
        step: 1,
        steps: 2,
        order: "pink first, then yellow",
      },
      {
        sceneId: "build-second",
        answerKind: "order_step",
        answer: "yellow",
        step: 2,
        steps: 2,
        order: "pink first, then yellow",
      },
      { sceneId: "tall-cone", answerKind: "count", answer: 3, object: "scoop", quantity: 3 },
    ]);
    for (const [index, id] of ICE_CREAM_NODE_IDS.entries()) {
      const node = ICE_CREAM_LESSON.nodes[id];
      expect(node.onSuccess).toEqual(
        index === ICE_CREAM_NODE_IDS.length - 1
          ? { kind: "complete" }
          : { kind: "node", nodeId: ICE_CREAM_NODE_IDS[index + 1] },
      );
      expect(node.completeAfterTutorOutput).toBeUndefined();
      expect(currentNodeContext(ICE_CREAM_LESSON, id).scene).toMatchObject({ id: node.presentation.sceneId });
    }
    for (const id of ["count-cones", "count-pink", "count-scoops"]) {
      expect(ICE_CREAM_LESSON.nodes[id].tutorBrief.split("?")[0]).not.toMatch(/\d|\b(?:two|three)\b/i);
    }
    expect(resolveLessonDefinition("ice-cream-shop")).toBe(ICE_CREAM_LESSON);
    expect(acceptsLearnerAnswerIndependently(ICE_CREAM_LESSON)).toBe(true);
  });

  it("uses answer-neutral commitment wording without changing counting questions", () => {
    const questions = conversationStateQuestions(ICE_CREAM_LESSON, "name-pink");
    expect(questions.answerCommitment.instructions).toContain("expected answer");
    expect(questions.answerCommitment.instructions).not.toContain("expected quantity");
    expect(
      conversationObserverState({
        lesson: ICE_CREAM_LESSON,
        nodeId: "order-second",
        transcript: "Child: yellow",
        transcriptRevision: 1,
      })?.scene,
    ).toEqual({ answerKind: "order_step", answer: "yellow", step: 2, steps: 2, order: "pink first, then yellow" });
    expect(conversationStateQuestions(COUNTING_LESSON, "count-1-duck")).toMatchSnapshot();
    expect(conversationStateQuestions(COUNTING_HALLOWEEN_LESSON, "count-1-ghost")).toMatchSnapshot();
  });
});

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());
it("allows the lesson and all its nodes in provider-free routes", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect((await live(request("live", { lessonId: "ice-cream-shop", sdp: "v=0" }))).status).toBe(503);
  for (const nodeId of ICE_CREAM_NODE_IDS)
    expect(
      (
        await classify(
          request("classify", {
            lessonId: "ice-cream-shop",
            nodeId,
            transcript: "Child: hello",
            transcriptRevision: 1,
          }),
        )
      ).status,
    ).toBe(503);
});

function replay(
  nodeId: string,
  answerOutcome: "correct" | "incorrect" | "unclear" | "none",
  answerCommitment: "committed" | "unresolved" | "no_answer",
  transcript: string,
) {
  const lesson = { ...ICE_CREAM_LESSON, initialNodeId: nodeId };
  const harness = createReducerHarness("ice-cream", { lesson, quietDrainMs: 1_000 });
  const source = prepareLearnerClassification(harness, 1);
  harness.send({
    type: "proposal.received",
    source,
    proposal: classifierProposal(source, { answerOutcome, answerCommitment, tutorState: "asking" }),
    transcriptSnapshot: transcript,
  });
  if (answerOutcome === "correct" && answerCommitment === "committed") {
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), speaker: "tutor", revision: 2 });
    const confirmationSource = classificationSource(harness.state)!;
    harness.send({
      type: "proposal.received",
      source: confirmationSource,
      proposal: classifierProposal(confirmationSource, {
        answerOutcome: "correct",
        answerCommitment: "committed",
        tutorState: "acknowledging",
      }),
      transcriptSnapshot: `${transcript}\nTutor: That's right.`,
    });
  }
  harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
  harness.send({ type: "clock.tick", source: runtimeSource(harness.state) }, 1_000);
  return { harness, source };
}

describe("learner-evidence reducer replays", () => {
  it.each([
    ["name-pink", "correct", "committed", "Child: pink", true],
    ["name-pink", "incorrect", "committed", "Child: yellow", false],
    ["name-pink", "none", "no_answer", "Child: strawberry", false],
    ["name-pink", "none", "no_answer", "Child: yes", false],
    ["name-pink", "none", "no_answer", "Tutor: pink. Child: pink", false],
    ["name-pink", "unclear", "unresolved", "Child: pink... or yellow?", false],
    ["order-first", "correct", "committed", "Child: pink", true],
    ["order-first", "incorrect", "committed", "Child: yellow", false],
    ["order-first", "correct", "committed", "Child: yellow—no, pink", true],
    ["order-second", "incorrect", "committed", "Child: pink", false],
    ["order-second", "correct", "committed", "Child: yellow", true],
  ] as const)("handles %s: %s / %s (%s)", (node, outcome, commitment, transcript, accepted) => {
    const { harness } = replay(node, outcome, commitment, transcript);
    expect(harness.state.phase === "rendering").toBe(accepted);
    if (accepted)
      expect(harness.state.pendingRender?.identity.nodeId).toBe(
        ICE_CREAM_LESSON.nodes[node].onSuccess.kind === "node"
          ? ICE_CREAM_LESSON.nodes[node].onSuccess.nodeId
          : undefined,
      );
    if (!accepted) expect(harness.state.answerAccepted).toBe(false);
  });

  it("rejects a stale first-step result after the second step renders", () => {
    const { harness, source } = replay("order-first", "correct", "committed", "Child: pink");
    const identity = harness.state.pendingRender!.identity;
    harness.send({ type: "render.confirmed", runtimeId: harness.state.runtimeId, identity });
    expect(harness.state.nodeId).toBe("order-second");
    harness.send({
      type: "proposal.received",
      source,
      proposal: classifierProposal(source, {
        answerOutcome: "correct",
        answerCommitment: "committed",
        tutorState: "asking",
      }),
      transcriptSnapshot: "Child: pink",
    });
    expect(harness.state).toMatchObject({ nodeId: "order-second", answerAccepted: false, phase: "active" });
  });
});
