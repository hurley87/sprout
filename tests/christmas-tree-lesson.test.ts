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
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import {
  currentNodeContext,
  lessonNodeOrder,
  validateLessonDefinition,
  type LessonDefinition,
} from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { applySpokenNumberCheck } from "../lib/lesson-runtime/spoken-number-check";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

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
      trackDifficulties: true,
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

  it.each([false, null, "true", 1])("rejects an invalid trackDifficulties value of %j", trackDifficulties => {
    expect(() =>
      validateLessonDefinition({ ...christmasTreeLesson(0), trackDifficulties } as unknown as LessonDefinition),
    ).toThrow(/trackDifficulties must be true or omitted/);
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

describe("Christmas tree difficulty tracking", () => {
  const lesson = christmasTreeLesson(0);
  const newHarness = (definition = lesson) =>
    createReducerHarness("difficulty-tracking", { lesson: definition, quietDrainMs: 1_500 });

  function attempt(
    h: ReturnType<typeof newHarness>,
    revision: number,
    answerOutcome: "correct" | "incorrect" | "none",
    text: string,
  ) {
    const source = prepareLearnerClassification(h, revision);
    const result = h.send({
      type: "proposal.received",
      source,
      transcriptSnapshot: `Child: ${text}`,
      proposal: classifierProposal(source, {
        answerOutcome,
        answerCommitment: answerOutcome === "none" ? "no_answer" : "committed",
        tutorState: "unknown",
        supportState: answerOutcome === "none" ? "needs_help" : "none",
      }),
    });
    return { source, result };
  }

  it("records repeated committed misses for the current visit and still advances after success", () => {
    const h = newHarness();
    expect(h.state.difficulties).toEqual([]);

    const misses = Array.from({ length: 6 }, (_, index) => attempt(h, index + 1, "incorrect", "Six"));
    expect(h.state.difficulties).toEqual(misses.map(({ source }) => ({ source, kind: "incorrect" })));
    for (const { source, result } of misses) {
      expect(source.visitId).toBe(h.state.visitId);
      expect(result.effects).not.toContainEqual(expect.objectContaining({ type: "support.limit.reached" }));
    }
    expect(h.state).toMatchObject({ phase: "active", nodeId: "round-1", answerAccepted: false });
    expect(h.state).not.toHaveProperty("supportLimitReached");
    expect(h.state).not.toHaveProperty("visitOutcomes");

    const answer = lesson.nodes["round-1"].presentation.answer;
    attempt(h, 7, "correct", String(answer));
    expect(h.state.answerAccepted).toBe(true);
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, lesson.successHoldMs);
    const identity = h.state.pendingRender?.identity;
    expect(identity?.nodeId).toBe("round-2");
    h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: identity! });
    expect(h.state).toMatchObject({ phase: "active", nodeId: "round-2", visitId: 2 });
    expect(h.state).not.toHaveProperty("visitOutcomes");
  });

  it("tracks explicit help requests", () => {
    const h = newHarness();
    attempt(h, 1, "none", "I'm not sure");
    const { source } = attempt(h, 2, "none", "Can you help?");
    expect(h.state.difficulties).toEqual([{ source, kind: "help_request" }]);
  });

  it("keeps difficulties absent for lessons without either option", () => {
    const h = newHarness(COUNTING_LESSON);
    expect(h.state).not.toHaveProperty("difficulties");
    attempt(h, 1, "incorrect", "Six");
    expect(h.state).not.toHaveProperty("difficulties");
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
