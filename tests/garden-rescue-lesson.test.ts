import { afterEach, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../lib/lesson-runtime/garden-rescue-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });

afterEach(() => vi.unstubAllEnvs());

it("authors one fixed quest order ending in the fresh challenge", () => {
  expect(validateLessonDefinition(GARDEN_RESCUE_LESSON)).toEqual(GARDEN_RESCUE_LESSON);
  expect(lessonNodeOrder(GARDEN_RESCUE_LESSON)).toEqual(GARDEN_RESCUE_NODE_IDS);
  expect(
    GARDEN_RESCUE_NODE_IDS.map(id => {
      const { object, quantity, sceneId } = GARDEN_RESCUE_LESSON.nodes[id].presentation;
      return [sceneId, object, quantity];
    }),
  ).toEqual([
    ["rescue-ducklings", "duckling", 3],
    ["wake-butterflies", "butterfly", 3],
    ["grow-flowers", "sprout", 4],
    ["fresh-challenge", "butterfly", 4],
  ]);
  expect(GARDEN_RESCUE_LESSON.nodes["fresh-challenge"].onSuccess).toEqual({ kind: "complete" });
});

it("stays within quantities 1–5 and never asks the same object and count twice in a row", () => {
  const nodes = GARDEN_RESCUE_NODE_IDS.map(id => GARDEN_RESCUE_LESSON.nodes[id].presentation);
  for (const node of nodes) expect(node.quantity).toBeGreaterThanOrEqual(1);
  for (const node of nodes) expect(node.quantity).toBeLessThanOrEqual(5);
  for (let index = 1; index < nodes.length; index++)
    expect([nodes[index].object, nodes[index].quantity]).not.toEqual([
      nodes[index - 1].object,
      nodes[index - 1].quantity,
    ]);
});

it("reuses the counting tutor, recovery and classifier contract", () => {
  expect(GARDEN_RESCUE_LESSON.answerAcceptance).toBe("learner_evidence");
  // Without this, a correct answer waits on tutor confirmation instead of the learner-evidence path.
  expect(acceptsLearnerAnswerIndependently(GARDEN_RESCUE_LESSON)).toBe(true);
  expect(GARDEN_RESCUE_LESSON.transitionQuietMs).toBe(COUNTING_LESSON.transitionQuietMs);
  expect(GARDEN_RESCUE_LESSON.recovery).toEqual(COUNTING_LESSON.recovery);
  expect(GARDEN_RESCUE_LESSON.classifier).toEqual(COUNTING_LESSON.classifier);
  expect(GARDEN_RESCUE_LESSON.tutor.persona).toBe(COUNTING_LESSON.tutor.persona);
  expect(GARDEN_RESCUE_LESSON.tutor.sessionGuidance).toContain("a single duckling");
  expect(GARDEN_RESCUE_LESSON.addressLearnerByName).toBe(true);
});

it("is on the server allowlist without changing the existing counting lesson", () => {
  expect(resolveLessonDefinition("garden-rescue")).toBe(GARDEN_RESCUE_LESSON);
  expect(resolveLessonDefinition("counting")).toBe(COUNTING_LESSON);
  for (const unknown of ["garden-rescue-butterflies-first", "Garden-Rescue", "games/garden", null])
    expect(resolveLessonDefinition(unknown)).toBeNull();
});

it("accepts garden rescue live sessions and classifier nodes, rejecting mismatches", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect((await live(request("live", { lessonId: "garden-rescue", sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: "garden-rescue-x", sdp: "v=0" }))).status).toBe(400);
  const input = { lessonId: "garden-rescue", nodeId: "", transcript: "Child: three", transcriptRevision: 1 };
  for (const nodeId of GARDEN_RESCUE_NODE_IDS)
    expect((await classify(request("classify", { ...input, nodeId }))).status).toBe(503);
  for (const fields of [
    { nodeId: "count-1-duck" },
    { nodeId: "unknown" },
    { lessonId: "counting", nodeId: "grow-flowers" },
  ])
    expect((await classify(request("classify", { ...input, ...fields }))).status).toBe(400);
});
