import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { DINO_CAR_CRUNCH_LESSON, DINO_CAR_CRUNCH_NODE_IDS } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { currentNodeContext, lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

const lesson = DINO_CAR_CRUNCH_LESSON;
const ids = DINO_CAR_CRUNCH_NODE_IDS;
const answerWords = ["seven", "twenty-three", "forty-two", "fifty-six", "thirty-five", "twenty-nine"];
const numberWords =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i;

function answerPattern(answer: number, words: string) {
  return new RegExp(`\\b(?:${answer}|${words.replace("-", "[-\\s]+")})\\b`, "i");
}

describe("dino car crunch lesson", () => {
  it("validates the shared node and scene contract", () => {
    expect(validateLessonDefinition(lesson)).toBe(lesson);
    expect(lessonNodeOrder(lesson)).toEqual(ids);
    expect(ids.map(id => lesson.nodes[id].presentation)).toEqual([
      { sceneId: "warm-up", answerKind: "count", answer: 7, object: "car", firstCars: 3, moreCars: 4 },
      { sceneId: "twenty-three", answerKind: "count", answer: 23, object: "car", trucks: 2, looseCars: 3 },
      { sceneId: "forty-two", answerKind: "count", answer: 42, object: "car", trucks: 4, looseCars: 2 },
      { sceneId: "fifty-six", answerKind: "count", answer: 56, object: "car", trucks: 5, looseCars: 6 },
      { sceneId: "thirty-five", answerKind: "count", answer: 35, object: "car", trucks: 3, looseCars: 5 },
      { sceneId: "twenty-nine", answerKind: "count", answer: 29, object: "car", trucks: 2, looseCars: 9 },
    ]);
    for (const [index, id] of ids.entries()) {
      const node = lesson.nodes[id];
      const presentation = node.presentation;
      if (id === "warm-up")
        expect(presentation.answer).toBe(Number(presentation.firstCars) + Number(presentation.moreCars));
      else expect(presentation.answer).toBe(Number(presentation.trucks) * 10 + Number(presentation.looseCars));
      expect(node.onSuccess).toEqual(
        index === ids.length - 1 ? { kind: "complete" } : { kind: "node", nodeId: ids[index + 1] },
      );
      expect(node.completeAfterTutorOutput).toBeUndefined();
      expect(currentNodeContext(lesson, id).scene).toMatchObject({ id: presentation.sceneId });
    }
    expect(resolveLessonDefinition("dino-car-crunch")).toBe(lesson);
    expect(acceptsLearnerAnswerIndependently(lesson)).toBe(true);
    expect(lesson.addressLearnerByName).toBe(true);
  });

  it("does not disclose answers in questions, briefs, or tutor guidance", () => {
    for (const [index, id] of ids.entries()) {
      const node = lesson.nodes[id];
      expect(node.tutorBrief.split("?")[0]).not.toMatch(/\d/);
      expect(node.tutorBrief.split("?")[0]).not.toMatch(numberWords);
      const pattern = answerPattern(Number(node.presentation.answer), answerWords[index]);
      expect(node.tutorBrief).not.toMatch(pattern);
      expect(lesson.tutor.sessionGuidance).not.toMatch(pattern);
      expect(lesson.tutor.nodeInstruction).not.toMatch(pattern);
    }
    expect(lesson.tutor.sessionGuidance).toContain("twenty, twenty-one, twenty-two");
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
  expect((await live(request("live", { lessonId: "dino-car-crunch", sdp: "v=0" }))).status).toBe(503);
  for (const nodeId of ids)
    expect(
      (
        await classify(
          request("classify", {
            lessonId: "dino-car-crunch",
            nodeId,
            transcript: "Child: hello",
            transcriptRevision: 1,
          }),
        )
      ).status,
    ).toBe(503);
});

// These replays feed classifier outcomes directly: they test reducer authority and stale-result rejection,
// not the classifier's judgement of spoken two-digit numbers (a later issue).
function replay(
  nodeId: string,
  answerOutcome: "correct" | "incorrect" | "unclear" | "none",
  answerCommitment: "committed" | "unresolved" | "no_answer",
  transcript: string,
) {
  const harness = createReducerHarness("dino-car-crunch", {
    lesson: { ...lesson, initialNodeId: nodeId },
    quietDrainMs: 1_000,
  });
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
    ["warm-up", "correct", "committed", "Child: seven", true],
    ["twenty-three", "correct", "committed", "Child: twenty-three", true],
    ["forty-two", "correct", "committed", "Child: forty-two", true],
    ["fifty-six", "correct", "committed", "Child: fifty-six", true],
    ["thirty-five", "correct", "committed", "Child: thirty-five", true],
    ["twenty-nine", "correct", "committed", "Child: twenty-nine", true],
    ["fifty-six", "incorrect", "committed", "Child: eleven", false],
    ["forty-two", "incorrect", "committed", "Child: four", false],
    ["fifty-six", "correct", "committed", "Child: fifty-five—no, fifty-six", true],
    ["twenty-nine", "correct", "committed", "Tutor: twenty… twenty-one… twenty-eight… Child: twenty-nine", true],
    ["fifty-six", "none", "no_answer", "Tutor: fifty-six. Child: fifty-six", false],
    ["thirty-five", "unclear", "unresolved", "Child: thirty… five?", false],
    ["twenty-three", "none", "no_answer", "Child: yes", false],
  ] as const)("handles %s: %s / %s (%s)", (node, outcome, commitment, transcript, accepted) => {
    const { harness } = replay(node, outcome, commitment, transcript);
    expect(harness.state.phase === "rendering").toBe(accepted);
    if (!accepted) expect(harness.state.answerAccepted).toBe(false);
    else {
      const edge = lesson.nodes[node].onSuccess;
      expect(harness.state.pendingRender?.identity.nodeId).toBe(edge.kind === "node" ? edge.nodeId : null);
      if (edge.kind === "complete") {
        expect(harness.state.lessonComplete).toBe(true);
        const identity = harness.state.pendingRender!.identity;
        const result = harness.send({ type: "render.confirmed", runtimeId: harness.state.runtimeId, identity });
        expect(harness.state.phase).toBe("complete");
        expect(result.effects).toContainEqual({ type: "lesson.completed", renderToken: identity.token });
      }
    }
  });

  it("rejects a stale result after the next node renders", () => {
    const { harness, source } = replay("twenty-three", "correct", "committed", "Child: twenty-three");
    const identity = harness.state.pendingRender!.identity;
    harness.send({ type: "render.confirmed", runtimeId: harness.state.runtimeId, identity });
    expect(harness.state.nodeId).toBe("forty-two");
    harness.send({
      type: "proposal.received",
      source,
      proposal: classifierProposal(source, {
        answerOutcome: "correct",
        answerCommitment: "committed",
        tutorState: "asking",
      }),
      transcriptSnapshot: "Child: twenty-three",
    });
    expect(harness.state).toMatchObject({ nodeId: "forty-two", answerAccepted: false, phase: "active" });
  });
});
