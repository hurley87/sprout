import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as classify } from "../app/api/classify/route";
import { POST as live } from "../app/api/live/route";
import {
  CHRISTMAS_TREE_KINDS,
  CHRISTMAS_TREE_SEED_MAX,
  CHRISTMAS_TREE_SEED_MIN,
  christmasTreeArrangement,
} from "../lib/lesson-runtime/christmas-tree-arrangement";
import {
  CHRISTMAS_TREE_LESSON_PREFIX,
  CHRISTMAS_TREE_NAMES,
  CHRISTMAS_TREE_NODE_IDS,
  christmasTreeLesson,
  christmasTreeLessonId,
  parseChristmasTreeLessonId,
} from "../lib/lesson-runtime/christmas-tree-lesson";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { currentNodeContext, lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { applySpokenNumberCheck } from "../lib/lesson-runtime/spoken-number-check";

const seeds = Array.from(
  { length: CHRISTMAS_TREE_SEED_MAX - CHRISTMAS_TREE_SEED_MIN + 1 },
  (_, index) => CHRISTMAS_TREE_SEED_MIN + index,
);
const answerWord = /\b(?:one|two|three|four|five)\b/i;

describe("Christmas tree lesson definitions", () => {
  it("uses the authored singular and plural names", () => {
    expect(CHRISTMAS_TREE_NAMES).toEqual({
      bauble: { singular: "bauble", plural: "baubles" },
      "candy-cane": { singular: "candy cane", plural: "candy canes" },
      gingerbread: { singular: "gingerbread man", plural: "gingerbread men" },
      present: { singular: "present", plural: "presents" },
    });
  });

  it.each(seeds)("validates and resolves the memoised lesson for seed %i", seed => {
    const lesson = christmasTreeLesson(seed);
    const lessonId = christmasTreeLessonId(seed);
    expect(lessonId).toBe(`counting-scene-christmas-tree-${seed}`);
    expect(parseChristmasTreeLessonId(lessonId)).toBe(seed);
    expect(lesson).toMatchObject({
      id: lessonId,
      answerAcceptance: "learner_evidence",
      spokenNumberCheck: true,
      addressLearnerByName: true,
      transitionQuietMs: 1_500,
      successHoldMs: 3_000,
    });
    expect(validateLessonDefinition(lesson)).toBe(lesson);
    expect(lessonNodeOrder(lesson)).toEqual(CHRISTMAS_TREE_NODE_IDS);
    expect(Object.keys(lesson.nodes)).toEqual(CHRISTMAS_TREE_NODE_IDS);
    expect(christmasTreeLesson(seed)).toBe(lesson);
    expect(resolveLessonDefinition(lessonId)).toBe(lesson);
    expect(acceptsLearnerAnswerIndependently(lesson)).toBe(true);

    const { asked, counts } = christmasTreeArrangement(seed);
    for (const [index, id] of CHRISTMAS_TREE_NODE_IDS.entries()) {
      const kind = asked[index];
      const count = counts[kind];
      const node = lesson.nodes[id];
      const { notCounted, ...presentation } = node.presentation;
      // The only numeric facts permitted are the count and round, even if one happens to equal the seed.
      expect(presentation).toEqual({
        sceneId: "christmas-tree",
        answerKind: "count",
        answer: count,
        quantity: count,
        object: CHRISTMAS_TREE_NAMES[kind].singular,
        objects: CHRISTMAS_TREE_NAMES[kind].plural,
        kind,
        round: index + 1,
      });
      const { scene } = currentNodeContext(lesson, id);
      expect(scene).toMatchObject({ id: "christmas-tree", answer: count, kind });
      expect(notCounted).toContain("the star on top and the string of lights");
      for (const otherKind of CHRISTMAS_TREE_KINDS.filter(other => other !== kind)) {
        expect(notCounted).toContain(CHRISTMAS_TREE_NAMES[otherKind].plural);
      }
      expect(notCounted).not.toContain(CHRISTMAS_TREE_NAMES[kind].plural);
      for (const copy of [node.tutorBrief, node.learningObjective, notCounted]) {
        expect(copy).not.toMatch(/\d/);
        expect(copy).not.toMatch(answerWord);
      }
    }
    expect(lesson.nodes["round-3"].onSuccess).toEqual({ kind: "complete" });
  });

  it.each(
    ["", "100", "07", "1.5", "-1", "-0", "+7", " 3", "3 ", "3\n", "0x7", "7e0"]
      .map(suffix => `${CHRISTMAS_TREE_LESSON_PREFIX}${suffix}`)
      .concat("counting-scene-christmas-tree"),
  )("rejects the noncanonical lesson ID %j", value => {
    expect(parseChristmasTreeLessonId(value)).toBeNull();
    expect(resolveLessonDefinition(value)).toBeNull();
    expect(acceptsLearnerAnswerIndependently({ ...christmasTreeLesson(0), id: value })).toBe(false);
  });

  it("rejects a numeric lesson ID and invalid seeds", () => {
    expect(parseChristmasTreeLessonId(3)).toBeNull();
    expect(resolveLessonDefinition(3)).toBeNull();
    for (const seed of [-1, 100, 1.5, NaN, Infinity]) {
      expect(() => christmasTreeLesson(seed)).toThrow(RangeError);
    }
  });

  it("still resolves the static lessons", () => {
    for (const id of [
      "calculus",
      "math-scribe",
      "math-scribe-reciprocal",
      "math-scribe-difference-quotient",
      "counting",
      "counting-halloween",
      "counting-concert",
      "ice-cream-shop",
      "dino-car-crunch",
      "garden-rescue",
      "catching-unicorns",
      "mae386",
    ]) {
      expect(resolveLessonDefinition(id)?.id).toBe(id);
    }
    expect(resolveLessonDefinition("unknown-lesson")).toBeNull();
  });
});

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });

afterEach(() => vi.unstubAllEnvs());

it("allows a seeded lesson and its rounds in both API routes, and rejects an invalid ID", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const lessonId = christmasTreeLessonId(42);
  const invalidId = `${CHRISTMAS_TREE_LESSON_PREFIX}07`;
  expect((await live(request("live", { lessonId, sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: invalidId, sdp: "v=0" }))).status).toBe(400);

  for (const nodeId of CHRISTMAS_TREE_NODE_IDS) {
    const body = { lessonId, nodeId, transcript: "Child: hello", transcriptRevision: 1 };
    expect((await classify(request("classify", body))).status).toBe(503);
    expect((await classify(request("classify", { ...body, lessonId: invalidId }))).status).toBe(400);
  }
});

describe("Christmas tree spoken-number policy", () => {
  const lesson = christmasTreeLesson(0);
  const nodeId = "round-3";
  const outputs: ConversationStateOutputs = {
    objectiveState: {
      choice: "completed",
      confidence: 1,
      probabilities: { completed: 1, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
    },
    tutorState: {
      choice: "asking",
      confidence: 1,
      probabilities: { confirmed_completion: 0, clarifying: 0, helping: 0, asking: 1, other: 0 },
    },
    answerCommitment: {
      choice: "committed",
      confidence: 1,
      probabilities: { committed: 1, unresolved: 0, withdrawn: 0, no_answer: 0 },
    },
  };
  const check = (transcript: string, scores = outputs) => {
    const input = { lesson, nodeId, transcriptRevision: 1, transcript };
    return applySpokenNumberCheck(mapConversationObservation(input, scores), input);
  };

  it.each([
    ["independently", "Tutor: Candy canes!\nChild: one, two, three"],
    ["with a counting scaffold", "Tutor: Let's count together. One, two.\nChild: three"],
  ])("uses the final number from a child who counts %s", (_label, transcript) => {
    expect(check(transcript)).toMatchObject({
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenNumber: { action: "agree", reader: { owner: "child", value: 3 } },
    });
  });

  it("keeps the shared assisted path when the child repeats a total the tutor disclosed", () => {
    const transcript = "Tutor: It's three.\nChild: three\nTutor: Can you say that again?\nChild: three";
    expect(check(transcript)).toMatchObject({
      proposal: { answerOutcome: "correct" },
      spokenNumber: { action: "assisted", reader: { owner: "assisted", value: 3 } },
    });
  });
});
