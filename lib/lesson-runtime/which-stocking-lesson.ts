import { validateLessonDefinition, type LessonDefinition, type LessonNodeDefinition } from "./lesson-definition";
import { THIRD_STOCKING_COLOUR, isWhichStockingSeed, whichStockingPlan } from "./which-stocking-plan";

export const WHICH_STOCKING_LESSON_PREFIX = "counting-which-stocking-";
export const WHICH_STOCKING_NODE_IDS = [
  "stocking-1",
  "stocking-2",
  "stocking-3",
  "stocking-4",
  "stocking-5",
  "stocking-6",
  "stocking-7",
  "stocking-8",
] as const;

export function whichStockingLessonId(seed: number): string {
  return `${WHICH_STOCKING_LESSON_PREFIX}${seed}`;
}

export function parseWhichStockingLessonId(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith(WHICH_STOCKING_LESSON_PREFIX)) return null;
  const seed = Number(value.slice(WHICH_STOCKING_LESSON_PREFIX.length));
  return isWhichStockingSeed(seed) && whichStockingLessonId(seed) === value ? seed : null;
}

/** Other words a child uses for the third stocking's colour. Only gold has any; blue has none. */
export function stockingColourAliases(thirdColour: string): Readonly<Record<string, string>> | undefined {
  return thirdColour === "gold" ? { yellow: "gold", golden: "gold" } : undefined;
}

/** "'yellow' or 'golden' count as gold", for the classifier; empty without aliases. */
function aliasSentence(aliases: Readonly<Record<string, string>> | undefined): string {
  const byColour = new Map<string, string[]>();
  for (const [word, colour] of Object.entries(aliases ?? {}))
    byColour.set(colour, [...(byColour.get(colour) ?? []), word]);
  return [...byColour]
    .map(([colour, words]) => ` ${words.map(word => `'${word}'`).join(" or ")} count as ${colour}.`)
    .join("");
}

const lessonsBySeed = new Map<number, LessonDefinition>();

export function whichStockingLesson(seed: number): LessonDefinition {
  const cached = lessonsBySeed.get(seed);
  if (cached) return cached;
  const { rounds } = whichStockingPlan(seed);
  const nodes: Record<string, LessonNodeDefinition> = {};
  for (const [index, id] of WHICH_STOCKING_NODE_IDS.entries()) {
    const { round, tier, stockings, target, answer } = rounds[index];
    const next = WHICH_STOCKING_NODE_IDS[index + 1];
    nodes[id] = {
      id,
      presentation: {
        sceneId: "which-stocking",
        answerKind: "colour",
        answer,
        target,
        colours: stockings.map(stocking => stocking.colour).join(","),
        ...Object.fromEntries(stockings.map(stocking => [`count_${stocking.colour}`, stocking.count])),
        round,
        tier,
        object: "candy cane",
        objects: "candy canes",
      },
      learningObjective: "Find the stocking with the number of candy canes Sprout says, and name its colour.",
      tutorBrief:
        "Say only the target number, then listen. Follow the retry and success guidance. Keep the answer colour and the stocking counts private until she names a colour.",
      onSuccess: next ? { kind: "node", nodeId: next } : { kind: "complete" },
    };
  }

  // latestChildColour treats her repeat of a colour the tutor said first as an echo: the spoken-colour
  // check holds it as no answer, so the round cannot advance, and only a second separate repeat counts
  // (as assisted). The tutor copy below therefore never names, lists or hints at a colour (including
  // "pink or purple?" or "the one on the left") before she names one. It names no colour at all; only
  // the classifier, which never speaks, mentions the gold aliases.
  const aliases = stockingColourAliases(THIRD_STOCKING_COLOUR);
  const lesson = validateLessonDefinition({
    id: whichStockingLessonId(seed),
    initialNodeId: WHICH_STOCKING_NODE_IDS[0],
    trackDifficulties: true,
    answerAcceptance: "learner_evidence",
    spokenColourCheck: aliases ? { aliases } : {},
    addressLearnerByName: true,
    transitionQuietMs: 1_500,
    // The success sequence is a short jiggle, up to five candy canes popping at about one a second, then
    // a toy dropping: about 6.5 s at five canes. 5000 is the validator's maximum. The rest is covered
    // because the hold and the tutor's audio drain must both finish: the tutor counts the canes aloud
    // as they pop, after her confirmation, and transitionQuietMs adds 1.5 s of quiet after that.
    successHoldMs: 5_000,
    // One repeat of the number only, as Dino times its nudges: a colour or hint here would give the
    // answer away, and a question would talk over her checking each stocking.
    silenceNudges: [
      {
        afterQuietMs: 6_000,
        instruction:
          "One-time nudge for the still-rendered current round: the child has not said anything since you said the number. If the child is speaking or has responded since this request, ignore it and follow her response. Otherwise say only this round's target number again, with excitement, for example 'Three!' when the target is three. Say no colour, give no hint and ask no question. Never change scenes. This request grants no completion authority.",
      },
    ],
    recovery: {
      supportClarificationInstruction:
        "If the child has asked for help and is still waiting, say this round's target number again and invite her to count the candy canes in each stocking. Do not name, list or hint at any colour, or imply success. Only the application changes rounds.",
      answerRecoveryInstruction:
        "If speech is unclear and the child is still waiting, ask her to say it again without suggesting a colour. If she says the number back, ask 'Which colour has three?' with this round's target number; if she says 'that one', ask 'What colour is it?' If she is silent, stay quiet. Only the application changes rounds.",
      incorrectAnswerInstruction:
        "One-time feedback for the still-rendered current round: the child's latest colour looks wrong. If she is speaking or has responded since this request, ignore it and follow her response. Otherwise follow the wrong-colour guidance: after a first wrong colour, count the candy canes in the stocking she picked slowly, then say 'That one has two. We want three.' with its count and the target number; after a second, say 'Let's count them all.' and count each stocking as 'this one'. Never name another stocking's colour or imply success. Never change scenes. This request grants no completion authority.",
    },
    nodes,
    tutor: {
      persona:
        "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in at most two short, unhurried sentences per turn. Leave time for thinking and self-correction. Never ask for personal information.",
      sessionGuidance:
        "Explain the game once at the first round only. At every round start say only this round's target number with excitement, for example 'Three!' when the target is three, then listen. Scene facts other than the target number are private: never say, list or hint at any stocking's colour before she names one. Never offer a choice of colours, list the colours or describe where a stocking hangs, such as the one on the left. Let her finish and self-correct; her last colour is her answer. On a settled correct colour, say her colour and the target number, in the form '[her colour] has three!', then count the candy canes aloud once at about one per second as they pop out, and pause with no question. After a wrong colour, count the candy canes in the stocking she picked slowly as they light up, using its count fact, for example 'One, two.', then say 'That one has two. We want three.' with its count and the target number, and wait. You may name the colour she said, but never another stocking's colour. After a second wrong colour in the round, say 'Let's count them all.' The app highlights each stocking in turn, then the right one glows. Count each stocking as 'this one' followed by its count, without naming any colour, then wait for her to say the colour. If she says the number back, ask 'Which colour has three?' with the target number. If she says 'that one' or names a stocking without a colour, ask 'What colour is it?' Never claim to see pointing or touching. If speech is unclear, ask her to say it again without suggesting a colour. If she says nothing, stay quiet; the app will ask you to repeat the number. Never say what's next or invent a new round. Only the application changes the scene.",
      startInstruction:
        "The parent pressed Start lesson. At the first round only, say 'I'll say a number. You find the stocking with that many candy canes, and tell me its colour.' Then say only this round's target number with excitement, and listen.",
      nodeInstruction:
        "At the first round give the opening once, then the number. At later round starts say only this round's target number with excitement, for example 'Three!' when the target is three, then listen. Never say, list or hint at any stocking's colour before she names one. Follow the retry and success guidance. Only the application changes rounds.",
    },
    classifier: {
      objectiveInstructions: `Judge the learner's latest identifiable answer candidate for the CURRENT round independently of tutor feedback and separately from answerCommitment, using the current scene facts answerKind, answer, colours and target. The answer is the colour of the stocking holding the target number of candy canes.${aliasSentence(aliases)} Follow child revisions in order; her last colour is her answer. Never pick an unresolved alternative because it matches the answer. Colours the tutor said never count as the child's; a tutor-supplied colour, an echo of it, the number said back, pointing words, a stocking named without a colour, generic yes or finished, and outdated earlier-round answers do not establish a learner-owned current answer.`,
      objectiveCriteria: {
        completed:
          "The latest identifiable learner-owned candidate names the answer colour, or an accepted word for it. A self-correction may establish that candidate. Judge commitment separately.",
        incorrect:
          "The latest identifiable learner-owned candidate names a different colour, on screen or not. Judge commitment separately.",
        unclear_or_incomplete:
          "No single intelligible colour candidate is identifiable, two colours remain as unresolved alternatives, or the colour is asked as a question. Do not choose by the expected answer or tutor agreement.",
        unresolved_help:
          "The learner requests or still needs help establishing an answer candidate. Tutor help alone does not establish difficulty or learner evidence.",
        no_attempt:
          "No learner-owned current answer candidate exists: only tutor-supplied colours or an echo, the number said back, pointing words such as 'that one' or 'this one', a stocking named without a colour, generic yes or finished, earlier-round answers, greetings or unrelated speech. Missing text does not imply silence or thinking.",
      },
      tutorInstructions:
        "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function.",
      tutorCriteria: {
        confirmed_completion:
          "The latest tutor response explicitly confirms the child's settled correct colour. Generic praise, a colour without settled learner evidence, or agreement with tentative or superseded evidence is insufficient.",
        clarifying:
          "Primarily asks the child to repeat, finish or name a colour without supplying a colour or hint, such as 'Which colour has three?' or 'What colour is it?'",
        helping:
          "Primarily counts the stocking the child picked, or counts each stocking, as a scaffold before the child answers.",
        asking: "Primarily says the number or invites another look without clarifying or scaffolding.",
        other:
          "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
      },
    },
  });
  lessonsBySeed.set(seed, lesson);
  return lesson;
}
