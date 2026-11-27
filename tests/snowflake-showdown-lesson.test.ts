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
import { latestChildColour } from "../lib/lesson-runtime/spoken-colour";
import { applySpokenColourCheck } from "../lib/lesson-runtime/spoken-colour-check";
import {
  SNOWFLAKE_SHOWDOWN_CHILD_ALIASES,
  SNOWFLAKE_SHOWDOWN_LESSON_PREFIX,
  SNOWFLAKE_SHOWDOWN_NODE_IDS,
  parseSnowflakeShowdownLessonId,
  snowflakeShowdownLesson,
  snowflakeShowdownLessonId,
} from "../lib/lesson-runtime/snowflake-showdown-lesson";
import { MITTEN_COLOURS, snowflakeShowdownPlan } from "../lib/lesson-runtime/snowflake-showdown-plan";

const COLOUR_WORDS = /\b(?:pink|purple|gold|golden|yellow|blue|red|green|orange|silver|white|black|brown)\b/i;
const INTRO = "Pink is yours and blue is the snowman's. When they flip, tell me who has more snowflakes!";
const LEFT_OVER = "Look, some are left over. Who has more?";

/** Everything Sprout may be told to say. */
function spokenCopy(seed = 0) {
  const lesson = snowflakeShowdownLesson(seed);
  return [
    ...Object.values(lesson.tutor),
    ...Object.values(lesson.recovery),
    ...(lesson.silenceNudges ?? []).map(nudge => nudge.instruction),
    ...Object.values(lesson.nodes).flatMap(node => [node.learningObjective, node.tutorBrief]),
  ];
}

/** The lines the copy tells Sprout to say, in single quotes; apostrophes inside words are not quotes. */
function quotedLines(text: string): string[] {
  return [...text.matchAll(/(?<!\w)'(.+?)'(?!\w)/g)].map(match => match[1]);
}

describe("Snowflake Showdown lesson", () => {
  it("round-trips, validates and resolves all seeded definitions and their plan", () => {
    for (let seed = 0; seed < 100; seed++) {
      const id = snowflakeShowdownLessonId(seed);
      const lesson = snowflakeShowdownLesson(seed);
      expect(id).toBe(`counting-snowflake-showdown-${seed}`);
      expect(parseSnowflakeShowdownLessonId(id)).toBe(seed);
      expect(resolveLessonDefinition(id)).toBe(lesson);
      expect(snowflakeShowdownLesson(seed)).toBe(lesson);
      expect(validateLessonDefinition(lesson)).toBe(lesson);
      expect(lessonNodeOrder(lesson)).toEqual([...SNOWFLAKE_SHOWDOWN_NODE_IDS]);
      expect(lesson.nodes["showdown-10"].onSuccess).toEqual({ kind: "complete" });
      expect(acceptsLearnerAnswerIndependently(lesson)).toBe(true);
      for (const [index, round] of snowflakeShowdownPlan(seed).rounds.entries()) {
        const presentation = lesson.nodes[SNOWFLAKE_SHOWDOWN_NODE_IDS[index]].presentation;
        expect(presentation).toEqual({
          sceneId: "snowflake-showdown",
          answerKind: "colour",
          answer: round.more,
          colours: "blue,pink",
          count_blue: round.counts.blue,
          count_pink: round.counts.pink,
          gap: round.gap,
          round: round.round,
          tier: round.tier,
          object: "snowflake",
          objects: "snowflakes",
        });
        expect(presentation.colours).toBe(MITTEN_COLOURS.join(","));
        expect(presentation).not.toHaveProperty("seed");
      }
    }
  });

  it.each(["-0", "00", "07", "100", " 1", "+1", "1.0", "", "1 ", "1e0", "-1"])(
    "rejects noncanonical suffix %j",
    suffix => {
      const id = SNOWFLAKE_SHOWDOWN_LESSON_PREFIX + suffix;
      expect(parseSnowflakeShowdownLessonId(id)).toBeNull();
      expect(resolveLessonDefinition(id)).toBeNull();
      expect(acceptsLearnerAnswerIndependently({ ...snowflakeShowdownLesson(0), id })).toBe(false);
    },
  );

  it("rejects invalid seeds and non-string IDs", () => {
    expect(parseSnowflakeShowdownLessonId(1)).toBeNull();
    expect(parseSnowflakeShowdownLessonId("counting-snowflake-showdown")).toBeNull();
    for (const seed of [-1, 100, 1.5, NaN, Infinity]) expect(() => snowflakeShowdownLesson(seed)).toThrow(RangeError);
  });

  it("sets the learner-evidence, spoken-colour and timing options, with child-only side words", () => {
    const lesson = snowflakeShowdownLesson(0);
    expect(lesson).toMatchObject({
      trackDifficulties: true,
      answerAcceptance: "learner_evidence",
      addressLearnerByName: true,
      transitionQuietMs: 1000,
      successHoldMs: 2500,
    });
    expect(lesson.spokenColourCheck).toEqual({
      childAliases: { me: "pink", mine: "pink", my: "pink", you: "blue", yours: "blue", snowman: "blue" },
    });
    expect(lesson.spokenColourCheck?.childAliases).toBe(SNOWFLAKE_SHOWDOWN_CHILD_ALIASES);
    expect(lesson.spokenColourCheck).not.toHaveProperty("aliases");
    expect(lesson).not.toHaveProperty("silenceNudges");
    expect(lesson).not.toHaveProperty("spokenNumberCheck");
    expect(lesson).not.toHaveProperty("countAlong");
    expect(lesson).not.toHaveProperty("replyNudge");
  });

  it("explains once, never asks again, echoes and helps without naming a side first", () => {
    const lesson = snowflakeShowdownLesson(0);
    const copy = Object.values(lesson.tutor).join(" ");
    expect(lesson.tutor.startInstruction).toContain(`At the first round only, say '${INTRO}' Then listen.`);
    expect(lesson.tutor.nodeInstruction).toContain("At later round starts say nothing at all");
    expect(lesson.tutor.nodeInstruction).toContain("Never ask again");
    expect(copy).toContain("Explain the game once at the first round only.");
    expect(copy).toContain("never ask again");
    expect(copy).toContain("never name, hint at or describe which mitten has more");
    expect(copy).toContain("say only '[her colour] has more!' and pause with no question");
    expect(copy).toContain(`say '${LEFT_OVER}' and wait. Name no colour there`);
    expect(copy).toContain("say both counts and the answer as ONE turn");
    expect(copy).toContain("'Pink has two. Blue has four. Blue has more!'");
    expect(copy).toContain("If she says a number, ask 'Which mitten has more?'");
    expect(copy).toContain("ask her to say it again without suggesting a side");
    expect(copy).toContain("Never say the snowman wins or that she lost");
    expect(copy).toContain("Never say what's next or invent a new round. Only the application changes the scene.");
    expect(lesson.tutor.persona).toContain("at most two short, unhurried sentences per turn");
    expect(lesson.recovery.answerRecoveryInstruction).toContain("without suggesting a side");
    expect(lesson.recovery.answerRecoveryInstruction).toContain("'Which mitten has more?'");
    expect(lesson.recovery.incorrectAnswerInstruction).toContain(`say only '${LEFT_OVER}' and name no colour`);
    expect(lesson.recovery.incorrectAnswerInstruction).toContain("say both counts and the answer as one turn");
    expect(lesson.recovery.incorrectAnswerInstruction).toContain("This request grants no completion authority.");
  });

  it("never names the answer in an instruction that runs before her call", () => {
    const first = snowflakeShowdownLesson(0);
    // The copy is the same for every seed, so no round's answer or count is written into it.
    for (let seed = 1; seed < 100; seed++) {
      const lesson = snowflakeShowdownLesson(seed);
      expect(lesson.tutor).toEqual(first.tutor);
      expect(lesson.recovery).toEqual(first.recovery);
      for (const id of SNOWFLAKE_SHOWDOWN_NODE_IDS) {
        expect(lesson.nodes[id].tutorBrief).toBe(first.nodes[id].tutorBrief);
        expect(lesson.nodes[id].learningObjective).toBe(first.nodes[id].learningObjective);
      }
    }
    // Copy that runs before any call names no colour, except the intro, which names both mittens.
    const beforeCall = [
      first.tutor.nodeInstruction,
      first.recovery.supportClarificationInstruction,
      first.recovery.answerRecoveryInstruction,
      ...Object.values(first.nodes).flatMap(node => [node.learningObjective, node.tutorBrief]),
    ];
    for (const text of beforeCall) expect(text).not.toMatch(COLOUR_WORDS);
    expect(first.tutor.startInstruction.replace(INTRO, "")).not.toMatch(COLOUR_WORDS);
    // The first-miss line names no colour, so her next correct call is still hers.
    expect(LEFT_OVER).not.toMatch(COLOUR_WORDS);
    // Every line Sprout is given, said before her call, leaves that call her own, whichever side has more.
    const lines = spokenCopy().flatMap(quotedLines);
    expect(lines).toEqual(expect.arrayContaining([INTRO, LEFT_OVER, "Pink has two. Blue has four. Blue has more!"]));
    for (const line of lines)
      for (const answer of MITTEN_COLOURS)
        expect(
          latestChildColour(`Tutor: ${line}\nChild: ${answer}!`, {
            answer,
            colours: [...MITTEN_COLOURS],
            childAliases: SNOWFLAKE_SHOWDOWN_CHILD_ALIASES,
          }),
        ).toMatchObject({ status: "colour", value: answer, owner: "child" });
  });

  it("tells the classifier the side words, tutor colours, numbers and pointing rules", () => {
    const { classifier } = snowflakeShowdownLesson(0);
    expect(classifier.objectiveInstructions).toContain("The answer is the colour of the mitten with more snowflakes.");
    expect(classifier.objectiveInstructions).toContain(
      "When the CHILD says them, 'me', 'mine' and 'my' mean pink, and 'you', 'yours' and 'snowman' mean blue",
    );
    expect(classifier.objectiveInstructions).toContain(
      "A colour the tutor named alone before her call never counts as hers",
    );
    expect(classifier.objectiveInstructions).toContain("Follow child revisions in order");
    expect(classifier.objectiveCriteria.no_attempt).toContain("a number");
    expect(classifier.objectiveCriteria.no_attempt).toContain("pointing words such as 'that one'");
    expect(classifier.objectiveCriteria.no_attempt).toContain("a mitten named without a side");
    expect(classifier.objectiveCriteria.incorrect).toContain("names a different side");
  });
});

describe("spoken colour check on a real Snowflake Showdown node", () => {
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
  const noAttempt: ConversationStateOutputs = {
    ...outputs,
    objectiveState: {
      choice: "no_attempt",
      confidence: 1,
      probabilities: { completed: 0, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 1 },
    },
    tutorState: {
      choice: "other",
      confidence: 1,
      probabilities: { confirmed_completion: 0, clarifying: 0, helping: 0, asking: 0, other: 1 },
    },
    answerCommitment: {
      choice: "no_answer",
      confidence: 1,
      probabilities: { committed: 0, unresolved: 0, withdrawn: 0, no_answer: 1 },
    },
  };
  /** The first seeded node whose answer is `colour`. */
  function nodeWithAnswer(colour: string) {
    for (let seed = 0; seed < 100; seed++) {
      const lesson = snowflakeShowdownLesson(seed);
      const node = Object.values(lesson.nodes).find(node => node.presentation.answer === colour);
      if (node) return { lesson, nodeId: node.id, presentation: node.presentation };
    }
    throw new Error(`No Snowflake Showdown node answers ${colour}`);
  }
  function check(colour: string, transcript: string, provider = outputs) {
    const { lesson, nodeId } = nodeWithAnswer(colour);
    const snapshot = { lesson, nodeId, transcriptRevision: 3, transcript };
    return applySpokenColourCheck(mapConversationObservation(snapshot, provider), snapshot);
  }
  const other = (colour: string) => MITTEN_COLOURS.find(candidate => candidate !== colour)!;

  it.each([
    ["Pink!", "pink", "Pink"],
    ["Mine!", "pink", "Mine"],
    ["You!", "blue", "You"],
    ["The snowman's", "blue", "snowman"],
  ])("reads %j as %s, right when it has more and wrong when it does not", (said, colour, source) => {
    expect(check(colour, `Child: ${said}`)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenColour: { action: "agree", reader: { status: "colour", value: colour, owner: "child", source } },
    });
    expect(check(other(colour), `Child: ${said}`)).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome: "incorrect" },
      spokenColour: { action: "veto", reader: { value: colour, owner: "child" }, picked: colour },
    });
  });

  it.each(MITTEN_COLOURS)("accepts her %s call after the intro that lists both mittens", colour => {
    expect(check(colour, `Tutor: ${INTRO}\nChild: ${colour}!`)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      spokenColour: { action: "agree", reader: { value: colour, owner: "child" } },
    });
  });

  it("never reads the tutor's 'you' as blue", () => {
    const transcript = "Tutor: Can you tell me who has more? You can do it!\nChild: blue";
    expect(check("blue", transcript)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      spokenColour: { action: "agree", reader: { value: "blue", owner: "child" } },
    });
    // By contrast, the tutor naming blue alone first does make her repeat an echo.
    expect(check("blue", "Tutor: Blue has more.\nChild: blue")).toMatchObject({
      outcome: "hold_scene",
      spokenColour: { action: "veto", reader: { value: "blue", owner: "echo" } },
    });
  });

  it.each(MITTEN_COLOURS)("accepts her %s call after the colour-free left-over line", colour => {
    const transcript = `Child: ${other(colour)}\nTutor: ${LEFT_OVER}\nChild: ${colour}`;
    expect(check(colour, transcript)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      spokenColour: { action: "agree", reader: { value: colour, owner: "child" } },
    });
  });

  it("counts her repeat after the one-turn second-miss count", () => {
    const transcript = `Child: pink\nTutor: ${LEFT_OVER}\nChild: pink\nTutor: Pink has two. Blue has four. Blue has more!\nChild: blue!`;
    expect(check("blue", transcript)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      spokenColour: { action: "agree", reader: { value: "blue", owner: "child" } },
    });
  });

  it("holds a number as no answer", () => {
    expect(check("pink", "Child: five!", noAttempt)).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome: "none", answerCommitment: "no_answer" },
      spokenColour: { action: "none", reader: { status: "number_only", source: "five" } },
    });
    // A classifier that wrongly calls the number correct is vetoed.
    expect(check("pink", "Child: five!")).toMatchObject({
      outcome: "hold_scene",
      spokenColour: { action: "veto", reader: { status: "number_only" } },
    });
  });

  it.each(MITTEN_COLOURS)("logs both mittens' counts with a %s answer", colour => {
    const { presentation } = nodeWithAnswer(colour);
    const result = check(colour, `Child: ${colour}`);
    expect(result.spokenColour?.choiceCounts).toEqual({ blue: presentation.count_blue, pink: presentation.count_pink });
    expect(result.spokenColour).not.toHaveProperty("target");
    expect(result.spokenColour).not.toHaveProperty("nearMiss");
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
  const lessonId = snowflakeShowdownLessonId(42);
  const invalidId = `${SNOWFLAKE_SHOWDOWN_LESSON_PREFIX}07`;
  expect((await live(request("live", { lessonId, sdp: "v=0" }))).status).toBe(503);
  expect((await live(request("live", { lessonId: invalidId, sdp: "v=0" }))).status).toBe(400);
  for (const nodeId of SNOWFLAKE_SHOWDOWN_NODE_IDS) {
    const body = { lessonId, nodeId, transcript: "Child: hello", transcriptRevision: 1 };
    expect((await classify(request("classify", body))).status).toBe(503);
    expect((await classify(request("classify", { ...body, lessonId: invalidId }))).status).toBe(400);
  }
  expect(
    (
      await classify(
        request("classify", { lessonId, nodeId: "stocking-1", transcript: "Child: hi", transcriptRevision: 1 }),
      )
    ).status,
  ).toBe(400);
  const body = { lessonId, runtimeId: "3f0c7a58-6c6b-4c08-a863-4c37fbf85129", report: {} };
  expect((await sessions(request("sessions", body))).status).toBe(204);
  expect((await sessions(request("sessions", { ...body, lessonId: invalidId }))).status).toBe(400);
});
it("assessment rejects counting lessons under its conversation-first contract", async () => {
  const visits = [{ nodeId: "showdown-1", visitId: 1, transcript: "Child: pink" }];
  expect((await assess(request("assess", { lessonId: snowflakeShowdownLessonId(42), visits }))).status).toBe(400);
  expect((await assess(request("assess", { lessonId: `${SNOWFLAKE_SHOWDOWN_LESSON_PREFIX}07`, visits }))).status).toBe(
    400,
  );
});
