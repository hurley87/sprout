import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as live } from "../app/api/live/route";
import { POST as classify } from "../app/api/classify/route";
import { POST as assess } from "../app/api/assess/route";
import { POST as sessions } from "../app/api/sessions/route";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { applySpokenColourCheck } from "../lib/lesson-runtime/spoken-colour-check";
import {
  WHICH_STOCKING_LESSON_PREFIX,
  WHICH_STOCKING_NODE_IDS,
  parseWhichStockingLessonId,
  stockingColourAliases,
  whichStockingLesson,
  whichStockingLessonId,
} from "../lib/lesson-runtime/which-stocking-lesson";
import { THIRD_STOCKING_COLOUR, whichStockingPlan } from "../lib/lesson-runtime/which-stocking-plan";

const COLOUR_WORDS = /\b(?:pink|purple|gold|golden|yellow|blue|red|green|orange|silver|white|black|brown)\b/i;

/** Everything Sprout may be told to say, including the copy that runs before she has answered. */
function spokenCopy(seed = 0) {
  const lesson = whichStockingLesson(seed);
  return [
    ...Object.values(lesson.tutor),
    ...Object.values(lesson.recovery),
    ...(lesson.silenceNudges ?? []).map(nudge => nudge.instruction),
    ...Object.values(lesson.nodes).flatMap(node => [node.learningObjective, node.tutorBrief]),
  ];
}

describe("Which Stocking lesson", () => {
  it("round-trips, validates and resolves all seeded definitions and their plan", () => {
    for (let seed = 0; seed < 100; seed++) {
      const id = whichStockingLessonId(seed);
      const lesson = whichStockingLesson(seed);
      expect(id).toBe(`counting-which-stocking-${seed}`);
      expect(parseWhichStockingLessonId(id)).toBe(seed);
      expect(resolveLessonDefinition(id)).toBe(lesson);
      expect(whichStockingLesson(seed)).toBe(lesson);
      expect(validateLessonDefinition(lesson)).toBe(lesson);
      expect(lessonNodeOrder(lesson)).toEqual([...WHICH_STOCKING_NODE_IDS]);
      expect(lesson.nodes["stocking-8"].onSuccess).toEqual({ kind: "complete" });
      expect(acceptsLearnerAnswerIndependently(lesson)).toBe(true);
      for (const [index, round] of whichStockingPlan(seed).rounds.entries()) {
        const presentation = lesson.nodes[WHICH_STOCKING_NODE_IDS[index]].presentation;
        expect(presentation).toEqual({
          sceneId: "which-stocking",
          answerKind: "colour",
          answer: round.answer,
          target: round.target,
          colours: round.stockings.map(stocking => stocking.colour).join(","),
          ...Object.fromEntries(round.stockings.map(stocking => [`count_${stocking.colour}`, stocking.count])),
          round: round.round,
          tier: round.tier,
          object: "candy cane",
          objects: "candy canes",
        });
        expect(presentation.colours).toBe(round.stockings.map(stocking => stocking.colour).join(","));
        for (const stocking of round.stockings) expect(presentation[`count_${stocking.colour}`]).toBe(stocking.count);
        expect(presentation[`count_${round.answer}`]).toBe(round.target);
        expect(presentation).not.toHaveProperty("seed");
      }
    }
  });

  it.each(["-0", "00", "07", "100", " 1", "+1", "1.0", "", "1 ", "1e0", "-1"])(
    "rejects noncanonical suffix %j",
    suffix => {
      const id = WHICH_STOCKING_LESSON_PREFIX + suffix;
      expect(parseWhichStockingLessonId(id)).toBeNull();
      expect(resolveLessonDefinition(id)).toBeNull();
      expect(acceptsLearnerAnswerIndependently({ ...whichStockingLesson(0), id })).toBe(false);
    },
  );

  it("rejects invalid seeds and non-string IDs", () => {
    expect(parseWhichStockingLessonId(1)).toBeNull();
    expect(parseWhichStockingLessonId("counting-which-stocking")).toBeNull();
    for (const seed of [-1, 100, 1.5, NaN, Infinity]) expect(() => whichStockingLesson(seed)).toThrow(RangeError);
  });

  it("sets the learner-evidence, spoken-colour and timing options", () => {
    const lesson = whichStockingLesson(0);
    expect(lesson).toMatchObject({
      trackDifficulties: true,
      answerAcceptance: "learner_evidence",
      addressLearnerByName: true,
      transitionQuietMs: 1500,
      successHoldMs: 5000,
    });
    expect(lesson).not.toHaveProperty("spokenNumberCheck");
    expect(lesson).not.toHaveProperty("countAlong");
    expect(lesson).not.toHaveProperty("replyNudge");
  });

  it("ties the gold aliases to the third stocking colour", () => {
    expect(stockingColourAliases("gold")).toEqual({ yellow: "gold", golden: "gold" });
    expect(stockingColourAliases("blue")).toBeUndefined();
    const aliases = stockingColourAliases(THIRD_STOCKING_COLOUR);
    const lesson = whichStockingLesson(0);
    expect(lesson.spokenColourCheck).toEqual(aliases ? { aliases } : {});
    if (aliases) expect(lesson.classifier.objectiveInstructions).toContain("'yellow' or 'golden' count as gold.");
    // Validation still rejects aliases for a colour that is never on screen.
    expect(() => validateLessonDefinition({ ...lesson, spokenColourCheck: { aliases: { navy: "blue" } } })).toThrow(
      /Spoken-colour check/,
    );
  });

  it("nudges once after about six seconds of silence to repeat only the number", () => {
    const [nudge, ...rest] = whichStockingLesson(0).silenceNudges ?? [];
    expect(rest).toEqual([]);
    expect(nudge.afterQuietMs).toBe(6000);
    expect(nudge.instruction).toContain("say only this round's target number again");
    expect(nudge.instruction).toContain("Say no colour, give no hint and ask no question.");
    expect(nudge.instruction).toContain("This request grants no completion authority.");
  });

  it("keeps the tutor to the number and never names or hints at a stocking colour", () => {
    const lesson = whichStockingLesson(0);
    const copy = Object.values(lesson.tutor).join(" ");
    expect(lesson.tutor.startInstruction).toContain(
      "say 'I'll say a number. You find the stocking with that many candy canes, and tell me its colour.'",
    );
    expect(copy).toContain("first round only");
    expect(copy).toContain("say only this round's target number");
    expect(copy).toContain("never say, list or hint at any stocking's colour before she names one");
    expect(copy).toContain("Never offer a choice of colours, list the colours or describe where a stocking hangs");
    expect(copy).toContain("'That one has two. We want three.'");
    expect(copy).toContain("never another stocking's colour");
    expect(copy).toContain("'Let's count them all.'");
    expect(copy).toContain("without naming any colour, then wait for her to say the colour");
    expect(copy).toContain("'Which colour has three?'");
    expect(copy).toContain("'What colour is it?'");
    expect(copy).toContain("Never claim to see pointing");
    expect(copy).toContain("ask her to say it again without suggesting a colour");
    expect(copy).toContain("Only the application changes the scene.");
    expect(lesson.recovery.answerRecoveryInstruction).toContain("without suggesting a colour");
    for (const text of spokenCopy()) expect(text).not.toMatch(COLOUR_WORDS);
  });

  it("tells the classifier tutor colours, the number back and pointing are not her answer", () => {
    const { classifier } = whichStockingLesson(0);
    expect(classifier.objectiveInstructions).toContain(
      "The answer is the colour of the stocking holding the target number of candy canes.",
    );
    expect(classifier.objectiveInstructions).toContain("Colours the tutor said never count as the child's");
    expect(classifier.objectiveInstructions).toContain("Follow child revisions in order");
    expect(classifier.objectiveCriteria.no_attempt).toContain("the number said back");
    expect(classifier.objectiveCriteria.no_attempt).toContain("pointing words such as 'that one'");
    expect(classifier.objectiveCriteria.no_attempt).toContain("a stocking named without a colour");
    expect(classifier.objectiveCriteria.incorrect).toContain("names a different colour");
  });
});

describe("spoken colour check on a real Which Stocking node", () => {
  const outputs: ConversationStateOutputs = {
    objectiveState: {
      choice: "completed",
      confidence: 1,
      probabilities: { completed: 1, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
    },
    tutorState: {
      choice: "confirmed_completion",
      confidence: 0.73,
      probabilities: { confirmed_completion: 0.73, clarifying: 0.1, helping: 0.1, asking: 0.04, other: 0.03 },
    },
    answerCommitment: {
      choice: "committed",
      confidence: 1,
      probabilities: { committed: 1, unresolved: 0, withdrawn: 0, no_answer: 0 },
    },
  };
  /** The first seeded node whose answer is `colour`. */
  function nodeWithAnswer(colour: string) {
    for (let seed = 0; seed < 100; seed++) {
      const lesson = whichStockingLesson(seed);
      const node = Object.values(lesson.nodes).find(node => node.presentation.answer === colour);
      if (node) return { lesson, nodeId: node.id, presentation: node.presentation };
    }
    throw new Error(`No Which Stocking node answers ${colour}`);
  }
  function check(colour: string, transcript: string) {
    const { lesson, nodeId } = nodeWithAnswer(colour);
    const snapshot = { lesson, nodeId, transcriptRevision: 3, transcript };
    return applySpokenColourCheck(mapConversationObservation(snapshot, outputs), snapshot);
  }

  it("accepts 'the purple one' when the answer is purple", () => {
    const { presentation } = nodeWithAnswer("purple");
    expect(check("purple", "Tutor: Three!\nChild: the purple one!")).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenColour: {
        action: "agree",
        reader: { status: "colour", value: "purple", owner: "child" },
        picked: "purple",
        pickedCount: presentation.target,
        target: presentation.target,
        nearMiss: false,
      },
    });
  });

  it.runIf(THIRD_STOCKING_COLOUR === "gold")("accepts yellow and golden for gold", () => {
    for (const word of ["yellow", "golden"])
      expect(check("gold", `Child: ${word}`)).toMatchObject({
        outcome: "allow_semantic_completion_evidence",
        spokenColour: { action: "agree", reader: { value: "gold", owner: "child", source: word } },
      });
  });

  it("holds the number said back as no colour", () => {
    expect(check("purple", "Tutor: Three!\nChild: three")).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome: "unclear", answerCommitment: "unresolved" },
      spokenColour: { action: "veto", reader: { status: "number_only" } },
    });
  });

  it("holds 'that one' as pointing, not an answer", () => {
    expect(check("purple", "Child: that one")).toMatchObject({
      outcome: "hold_scene",
      spokenColour: { action: "veto", reader: { status: "deictic" } },
    });
  });

  it("does not advance on an echo after the tutor names the colour", () => {
    expect(check("purple", "Tutor: It's the purple one.\nChild: purple")).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome: "none", answerCommitment: "no_answer" },
      spokenColour: { action: "veto", reader: { value: "purple", owner: "echo" } },
    });
  });

  it("marks a wrong on-screen colour incorrect with its count for the wrong-pick feedback", () => {
    const { presentation } = nodeWithAnswer("purple");
    expect(check("purple", "Child: pink")).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome: "incorrect" },
      spokenColour: { action: "veto", picked: "pink", pickedCount: presentation.count_pink },
    });
  });
});

const request = (route: string, body: object) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());
it("allowlists valid lesson IDs for live, classify and sessions and rejects noncanonical IDs", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("SPROUT_SAVE_SESSIONS", "");
  const lessonId = whichStockingLessonId(42);
  const invalidId = `${WHICH_STOCKING_LESSON_PREFIX}07`;
  expect((await live(request("live", { lessonId, sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: invalidId, sdp: "v=0" }))).status).toBe(400);
  for (const nodeId of WHICH_STOCKING_NODE_IDS) {
    const body = { lessonId, nodeId, transcript: "Child: hello", transcriptRevision: 1 };
    expect((await classify(request("classify", body))).status).toBe(503);
    expect((await classify(request("classify", { ...body, lessonId: invalidId }))).status).toBe(400);
  }
  expect(
    (
      await classify(
        request("classify", { lessonId, nodeId: "chimney-1", transcript: "Child: hi", transcriptRevision: 1 }),
      )
    ).status,
  ).toBe(400);
  const body = { lessonId, runtimeId: "3f0c7a58-6c6b-4c08-a863-4c37fbf85129", report: {} };
  expect((await sessions(request("sessions", body))).status).toBe(204);
  expect((await sessions(request("sessions", { ...body, lessonId: invalidId }))).status).toBe(400);
});
it("assessment rejects counting lessons under its conversation-first contract", async () => {
  const visits = [{ nodeId: "stocking-1", visitId: 1, transcript: "Child: pink" }];
  expect((await assess(request("assess", { lessonId: whichStockingLessonId(42), visits }))).status).toBe(400);
  expect((await assess(request("assess", { lessonId: `${WHICH_STOCKING_LESSON_PREFIX}07`, visits }))).status).toBe(400);
});
