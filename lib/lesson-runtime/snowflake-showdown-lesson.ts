import { validateLessonDefinition, type LessonDefinition, type LessonNodeDefinition } from "./lesson-definition";
import { MITTEN_COLOURS, isSnowflakeShowdownSeed, snowflakeShowdownPlan } from "./snowflake-showdown-plan";

export const SNOWFLAKE_SHOWDOWN_LESSON_PREFIX = "counting-snowflake-showdown-";
export const SNOWFLAKE_SHOWDOWN_NODE_IDS = [
  "showdown-1",
  "showdown-2",
  "showdown-3",
  "showdown-4",
  "showdown-5",
  "showdown-6",
  "showdown-7",
  "showdown-8",
  "showdown-9",
  "showdown-10",
] as const;

export function snowflakeShowdownLessonId(seed: number): string {
  return `${SNOWFLAKE_SHOWDOWN_LESSON_PREFIX}${seed}`;
}

export function parseSnowflakeShowdownLessonId(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith(SNOWFLAKE_SHOWDOWN_LESSON_PREFIX)) return null;
  const seed = Number(value.slice(SNOWFLAKE_SHOWDOWN_LESSON_PREFIX.length));
  return isSnowflakeShowdownSeed(seed) && snowflakeShowdownLessonId(seed) === value ? seed : null;
}

/**
 * Her words for a side. These are child-only because perspective words flip by speaker: her "mine" is
 * pink, but the tutor's "yours" (in "Pink is yours") also means pink, and the tutor's "you" in "Can you
 * tell me?" means her, not the snowman. Read in tutor turns, they would make ordinary tutor speech look
 * like it named a colour, and could disclose blue before her call.
 */
export const SNOWFLAKE_SHOWDOWN_CHILD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  me: "pink",
  mine: "pink",
  my: "pink",
  you: "blue",
  yours: "blue",
  snowman: "blue",
});

const lessonsBySeed = new Map<number, LessonDefinition>();

export function snowflakeShowdownLesson(seed: number): LessonDefinition {
  const cached = lessonsBySeed.get(seed);
  if (cached) return cached;
  const { rounds } = snowflakeShowdownPlan(seed);
  const nodes: Record<string, LessonNodeDefinition> = {};
  for (const [index, id] of SNOWFLAKE_SHOWDOWN_NODE_IDS.entries()) {
    const { round, tier, counts, more, gap } = rounds[index];
    const next = SNOWFLAKE_SHOWDOWN_NODE_IDS[index + 1];
    nodes[id] = {
      id,
      presentation: {
        sceneId: "snowflake-showdown",
        answerKind: "colour",
        answer: more,
        colours: MITTEN_COLOURS.join(","),
        ...Object.fromEntries(MITTEN_COLOURS.map(colour => [`count_${colour}`, counts[colour]])),
        gap,
        round,
        tier,
        object: "snowflake",
        objects: "snowflakes",
      },
      learningObjective: "Compare the snowflakes on two mittens and say which colour has more.",
      tutorBrief:
        "Say nothing at the round start; listen for her call. Follow the retry and success guidance. Keep the answer colour and the snowflake counts private until she has called a side.",
      onSuccess: next ? { kind: "node", nodeId: next } : { kind: "complete" },
    };
  }

  // latestChildColour treats her repeat of a colour the tutor said first as an echo: the spoken-colour
  // check holds it as no answer, so the round cannot advance, and only a second separate repeat counts
  // (as assisted). A tutor turn discloses only when it names the answer colour and no other on-screen
  // colour, so the copy below follows three rules:
  // - The first-round intro, "Pink is yours and blue is the snowman's", names both mittens, so it is a
  //   list of the choices, not a disclosure, and her first call after it is her own.
  // - The wrong-call line, "Look, some are left over. Who has more?", names no colour. The glowing
  //   left-over snowflakes on screen show the side. Saying "Look, blue has some left over" would name
  //   the answer colour alone, and her next correct call would be an echo that cannot finish the round.
  // - The second-miss line names both mittens' counts and the answer in ONE turn, so it is not a
  //   disclosure either and her repeat after it counts. Split into turns, its last turn would name the
  //   answer alone, so the copy says to say it as one turn.
  // No line before her call names a single colour.
  const lesson = validateLessonDefinition({
    id: snowflakeShowdownLessonId(seed),
    initialNodeId: SNOWFLAKE_SHOWDOWN_NODE_IDS[0],
    trackDifficulties: true,
    answerAcceptance: "learner_evidence",
    spokenColourCheck: { childAliases: SNOWFLAKE_SHOWDOWN_CHILD_ALIASES },
    addressLearnerByName: true,
    // The only speech before a move is the one-sentence echo, "Pink has more!". Live replies pause
    // 300-800 ms between sentences (counting-lesson.ts), so 1 s still outlasts any pause inside a reply
    // while keeping the rounds quick.
    transitionQuietMs: 1_000,
    // The brief wants the next pair to flip "a moment after her star lands". The success beat is the
    // mitten dance (~0.6 s) and the star flying to her row (~1 s), with the snowman's clap or shrug
    // alongside, then a short beat: 2.5 s. The stage must fit its success animation inside this.
    // The transition also waits for transitionQuietMs after the echo, so a long echo is not cut off.
    successHoldMs: 2_500,
    // No silenceNudges: on silence the stage wiggles the mittens, and Sprout never asks again.
    recovery: {
      supportClarificationInstruction:
        "If the child has asked for help and is still waiting, invite her to look at both mittens, for example 'Look at both mittens. Who has more?' Do not name or hint at any colour or side, or imply success. Only the application changes rounds.",
      answerRecoveryInstruction:
        "If speech is unclear and the child is still waiting, ask her to say it again without suggesting a side. If she says a number or 'that one', ask 'Which mitten has more?' If she is silent, stay quiet. Only the application changes rounds.",
      incorrectAnswerInstruction:
        "One-time feedback for the still-rendered current round: the child's latest call looks wrong. If she is speaking or has responded since this request, ignore it and follow her response. Otherwise follow the wrong-call guidance: after a first wrong call in this round, say only 'Look, some are left over. Who has more?' and name no colour; after a second, say both counts and the answer as one turn, in the form 'Pink has two. Blue has four. Blue has more!' with this round's counts. Never say the snowman wins or that she lost, and never imply success. Never change scenes. This request grants no completion authority.",
    },
    nodes,
    tutor: {
      persona:
        "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in at most two short, unhurried sentences per turn; the one counting line the guidance gives after a second miss is a single turn. Leave time for thinking and self-correction. Never ask for personal information.",
      sessionGuidance:
        "Explain the game once at the first round only. After that never ask again: at later round starts say nothing and listen while she looks. Scene facts are private: never name, hint at or describe which mitten has more, or how many snowflakes either has, before she calls it. Let her finish and self-correct; her last colour or side word is her call. When she says them, 'me', 'mine' and 'my' mean pink, and 'you', 'yours' and 'snowman' mean blue. On a settled correct call, say only '[her colour] has more!' and pause with no question. After a first wrong call in the round, say 'Look, some are left over. Who has more?' and wait. Name no colour there; the glowing left-over snowflakes show the side. After a second wrong call in the round, say both counts and the answer as ONE turn, pink first, in the form 'Pink has two. Blue has four. Blue has more!' using this round's counts, then wait for her call. If she says a number, ask 'Which mitten has more?' If speech is unclear, ask her to say it again without suggesting a side. If she says nothing, stay quiet; the mittens wiggle on screen. Never say the snowman wins or that she lost; the star is hers either way. Never claim to see pointing or touching. Never say what's next or invent a new round. Only the application changes the scene.",
      startInstruction:
        "The parent pressed Start lesson. At the first round only, say 'Pink is yours and blue is the snowman's. When they flip, tell me who has more snowflakes!' Then listen.",
      nodeInstruction:
        "At the first round give the opening once, then listen. At later round starts say nothing at all and listen while she looks. Never ask again, and never name, hint at or describe which mitten has more before she calls it. Follow the retry and success guidance. Only the application changes rounds.",
    },
    classifier: {
      objectiveInstructions:
        "Judge the learner's latest identifiable answer candidate for the CURRENT round independently of tutor feedback and separately from answerCommitment, using the current scene facts answerKind, answer, colours, count_blue and count_pink. The answer is the colour of the mitten with more snowflakes. When the CHILD says them, 'me', 'mine' and 'my' mean pink, and 'you', 'yours' and 'snowman' mean blue; the tutor's perspective words never name a colour. Follow child revisions in order; her last side is her answer. Never pick an unresolved alternative because it matches the answer. A colour the tutor named alone before her call never counts as hers; a tutor turn naming both mittens supplies neither. A tutor-supplied colour, an echo of it, a number, pointing words or a mitten named without a side, generic yes or finished, and outdated earlier-round answers do not establish a learner-owned current answer.",
      objectiveCriteria: {
        completed:
          "The latest identifiable learner-owned candidate names the answer colour, or a child side word for it. A self-correction may establish that candidate. Judge commitment separately.",
        incorrect:
          "The latest identifiable learner-owned candidate names a different side: the other mitten's colour or side word, or a colour not on screen. Judge commitment separately.",
        unclear_or_incomplete:
          "No single intelligible side candidate is identifiable, both sides remain as unresolved alternatives, or the side is asked as a question. Do not choose by the expected answer or tutor agreement.",
        unresolved_help:
          "The learner requests or still needs help establishing an answer candidate. Tutor help alone does not establish difficulty or learner evidence.",
        no_attempt:
          "No learner-owned current answer candidate exists: only a colour the tutor named alone or an echo of it, a number, pointing words such as 'that one' or a mitten named without a side, generic yes or finished, earlier-round answers, greetings or unrelated speech. Missing text does not imply silence or thinking.",
      },
      tutorInstructions:
        "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function.",
      tutorCriteria: {
        confirmed_completion:
          "The latest tutor response explicitly confirms the child's settled correct call, such as '[her colour] has more!' Generic praise, a colour without settled learner evidence, or agreement with tentative or superseded evidence is insufficient.",
        clarifying:
          "Primarily asks the child to repeat or to say which mitten has more without supplying a colour or hint, such as 'Which mitten has more?'",
        helping:
          "Primarily points to the left-over snowflakes, or counts both mittens and names the one with more, as a scaffold after a wrong call.",
        asking: "Primarily explains the game or invites her call without clarifying or scaffolding.",
        other:
          "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
      },
    },
  });
  lessonsBySeed.set(seed, lesson);
  return lesson;
}
