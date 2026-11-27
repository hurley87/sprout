import { downTheChimneyPlan, isDownTheChimneySeed } from "./down-the-chimney-plan";
import { validateLessonDefinition, type LessonDefinition, type LessonNodeDefinition } from "./lesson-definition";

export const DOWN_THE_CHIMNEY_LESSON_PREFIX = "counting-down-the-chimney-";
export const DOWN_THE_CHIMNEY_NODE_IDS = [
  "chimney-1",
  "chimney-2",
  "chimney-3",
  "chimney-4",
  "chimney-5",
  "chimney-6",
  "chimney-7",
  "chimney-8",
] as const;

export function downTheChimneyLessonId(seed: number): string {
  return `${DOWN_THE_CHIMNEY_LESSON_PREFIX}${seed}`;
}

export function parseDownTheChimneyLessonId(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith(DOWN_THE_CHIMNEY_LESSON_PREFIX)) return null;
  const seed = Number(value.slice(DOWN_THE_CHIMNEY_LESSON_PREFIX.length));
  return isDownTheChimneySeed(seed) && downTheChimneyLessonId(seed) === value ? seed : null;
}

const lessonsBySeed = new Map<number, LessonDefinition>();

export function downTheChimneyLesson(seed: number): LessonDefinition {
  const cached = lessonsBySeed.get(seed);
  if (cached) return cached;
  const { rounds } = downTheChimneyPlan(seed);
  const nodes: Record<string, LessonNodeDefinition> = {};
  for (const [index, id] of DOWN_THE_CHIMNEY_NODE_IDS.entries()) {
    const { count, round, step } = rounds[index];
    const next = DOWN_THE_CHIMNEY_NODE_IDS[index + 1];
    nodes[id] = {
      id,
      presentation: {
        sceneId: "down-the-chimney",
        answerKind: "count",
        answer: count,
        quantity: count,
        object: "present",
        objects: "presents",
        round,
        step,
      },
      learningObjective: "Count the presents as they drop down the chimney.",
      tutorBrief:
        "Follow the opening, silence, retry and reveal guidance. Keep the count private until the child gives a settled correct answer.",
      onSuccess: next ? { kind: "node", nodeId: next } : { kind: "complete" },
    };
  }

  // A tutor-disclosed total before the child's first attempt makes the first repeat an echo;
  // latestChildNumber only marks a second separate repeat as assisted. Stop before the total.
  // No silence or reply nudges: the app replays the drops and a nudge would talk over it.
  const lesson = validateLessonDefinition({
    id: downTheChimneyLessonId(seed),
    initialNodeId: DOWN_THE_CHIMNEY_NODE_IDS[0],
    countAlong: true,
    trackDifficulties: true,
    answerAcceptance: "learner_evidence",
    spokenNumberCheck: true,
    addressLearnerByName: true,
    transitionQuietMs: 1_500,
    // Allow up to five presents to slide out and bounce; ongoing tutor audio also delays transition.
    successHoldMs: 5_000,
    recovery: {
      supportClarificationInstruction:
        "If the child has asked for help and is still waiting, follow the retry guidance for this round. Do not suggest a number or imply success. Stay silent during drops. Only the application changes rounds.",
      answerRecoveryInstruction:
        "If speech is unclear and the child is still waiting, ask her to say it again without suggesting a number. If she is silent, stay quiet for the app's replay. Stay silent during drops. Only the application changes rounds.",
    },
    nodes,
    tutor: {
      persona:
        "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in at most two short, unhurried sentences per turn. Leave time for thinking and self-correction. Never ask for personal information.",
      sessionGuidance:
        "Explain the game once at the first round only. At later rounds' start say nothing: no cue and no question. During the drops stay completely silent: don't count, comment or ask, except when counting together on the second wrong answer replay as described below. Scene facts are private: never say the number of presents or confirm a number she hasn't said. If she counts aloud as presents fall, wait; the final number of her finished count is her answer. After a first wrong answer in a round, say only 'Let's watch again!' The app replays more slowly. After a second wrong answer, say 'Let's count together!' The app replays very slowly, about two seconds per present. Count softly along, one number per present at a slow steady pace, and stop before the last number so she says it herself. For one present, invite her to say how many without saying any number. Never say too high or too low. If speech is unclear, ask her to say it again without suggesting a number. If she says nothing, stay quiet; the app shows Santa peering down the chimney and replays. On a settled correct answer, confirm with her number and 'presents', then count the presents in the fireplace aloud once at a steady pace and pause with no question. Never say what's next or invent a new round. Only the application changes the scene.",
      startInstruction:
        "The parent pressed Start lesson. At the first round only, say 'Santa is dropping presents down the chimney! Count them, and tell me how many.' Then listen. Stay silent during the drops.",
      nodeInstruction:
        "At the first round give the opening once. At later round starts say nothing: no cue and no question. Stay silent during drops except for the instructed count-together replay after a second wrong answer. Follow the retry and reveal guidance. Only the application changes rounds.",
    },
    classifier: {
      objectiveInstructions:
        "Judge the learner's latest identifiable answer candidate for the CURRENT round independently of tutor feedback and separately from answerCommitment, using the current scene facts answerKind and answer. The final number of the child's finished count-along sequence is her answer. Follow child revisions in order. Never pick an unresolved alternative because it matches the expected quantity. Numbers the tutor said never count as the child's; a tutor-supplied total, an echo of it, generic yes or finished, and outdated earlier-round answers do not establish a learner-owned current answer.",
      objectiveCriteria: {
        completed:
          "The latest identifiable learner-owned candidate matches the current count. A finished count-along, self-correction or the child supplying the final number after the tutor stops before it may establish that candidate. Judge commitment separately.",
        incorrect:
          "The latest identifiable learner-owned candidate gives the wrong count for this round. Judge commitment separately.",
        unclear_or_incomplete:
          "No single intelligible answer candidate is identifiable, alternatives remain unresolved, or a count is unfinished. Do not choose by the expected quantity or tutor agreement.",
        unresolved_help:
          "The learner requests or still needs help establishing an answer candidate. Tutor help alone does not establish difficulty or learner evidence.",
        no_attempt:
          "No learner-owned current answer candidate exists. Tutor numbers, an echo, generic yes or finished, earlier-round answers, greetings and unrelated speech do not count. Missing text does not imply silence or thinking.",
      },
      tutorInstructions:
        "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function.",
      tutorCriteria: {
        confirmed_completion:
          "The latest tutor response explicitly confirms the child's settled correct count. Generic praise, a total without settled learner evidence, or agreement with tentative or superseded evidence is insufficient.",
        clarifying: "Primarily asks the child to repeat, finish or disambiguate without supplying an answer or hint.",
        helping:
          "Primarily provides a counting hint or counts along with the child as a scaffold before the child answers.",
        asking: "Primarily invites another look without clarifying or scaffolding.",
        other:
          "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
      },
    },
  });
  lessonsBySeed.set(seed, lesson);
  return lesson;
}
