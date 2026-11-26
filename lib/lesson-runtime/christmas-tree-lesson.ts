import {
  CHRISTMAS_TREE_KINDS,
  christmasTreeArrangement,
  isChristmasTreeSeed,
  type ChristmasTreeKind,
} from "./christmas-tree-arrangement";
import { validateLessonDefinition, type LessonDefinition, type LessonNodeDefinition } from "./lesson-definition";

export const CHRISTMAS_TREE_LESSON_PREFIX = "counting-scene-christmas-tree-";
export const CHRISTMAS_TREE_NODE_IDS = ["round-1", "round-2", "round-3"] as const;

export const CHRISTMAS_TREE_NAMES = {
  bauble: { singular: "bauble", plural: "baubles" },
  "candy-cane": { singular: "candy cane", plural: "candy canes" },
  gingerbread: { singular: "gingerbread man", plural: "gingerbread men" },
  present: { singular: "present", plural: "presents" },
} as const satisfies Readonly<Record<ChristmasTreeKind, { singular: string; plural: string }>>;

export function christmasTreeLessonId(seed: number): string {
  return `${CHRISTMAS_TREE_LESSON_PREFIX}${seed}`;
}

export function parseChristmasTreeLessonId(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith(CHRISTMAS_TREE_LESSON_PREFIX)) return null;
  const seed = Number(value.slice(CHRISTMAS_TREE_LESSON_PREFIX.length));
  return isChristmasTreeSeed(seed) && christmasTreeLessonId(seed) === value ? seed : null;
}

const lessonsBySeed = new Map<number, LessonDefinition>();

export function christmasTreeLesson(seed: number): LessonDefinition {
  const cached = lessonsBySeed.get(seed);
  if (cached) return cached;

  const { asked, counts } = christmasTreeArrangement(seed);
  const nodes: Record<string, LessonNodeDefinition> = {};
  for (const [index, id] of CHRISTMAS_TREE_NODE_IDS.entries()) {
    const kind = asked[index];
    const count = counts[kind];
    const { singular, plural } = CHRISTMAS_TREE_NAMES[kind];
    const otherKinds = CHRISTMAS_TREE_KINDS.filter(other => other !== kind).map(
      other => CHRISTMAS_TREE_NAMES[other].plural,
    );
    const next = CHRISTMAS_TREE_NODE_IDS[index + 1];
    nodes[id] = {
      id,
      presentation: {
        sceneId: "christmas-tree",
        answerKind: "count",
        answer: count,
        quantity: count,
        object: singular,
        objects: plural,
        kind,
        round: index + 1,
        notCounted: `Things in the picture that are not part of this count include ${otherKinds.join(", ")}, the star on top and the string of lights.`,
      },
      learningObjective: `Count the ${plural} in the picture while ignoring the other things.`,
      tutorBrief: `Say "${plural}!" with excitement, then listen. Follow the retry and count-together guidance for this kind.`,
      onSuccess: next ? { kind: "node", nodeId: next } : { kind: "complete" },
    };
  }

  const lesson = validateLessonDefinition({
    id: christmasTreeLessonId(seed),
    initialNodeId: CHRISTMAS_TREE_NODE_IDS[0],
    answerAcceptance: "learner_evidence",
    spokenNumberCheck: true,
    addressLearnerByName: true,
    transitionQuietMs: 1_500,
    successHoldMs: 3_000,
    trackDifficulties: true,
    recovery: {
      supportClarificationInstruction:
        "One-time clarification for the still-rendered round: if the child is still waiting and has not spoken again, briefly ask whether they have finished counting this kind or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. A settled correct answer or reaffirmation without renewed help or uncertainty needs a fresh explicit confirmation with the child's number and the kind, then pause. Generic yes or finished alone is insufficient. For renewed help, unresolved alternatives or uncertainty, help, wait or clarify without giving the answer. Only the application changes rounds. This request grants no completion authority.",
      answerRecoveryInstruction:
        "One-time clarification for the still-rendered round: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, briefly ask them to repeat their count for this kind. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. Wait for a fresh answer. If it establishes settled correct success for this round, explicitly confirm the child's number and the kind, then pause. For unfinished or uncertain answers, wait or clarify without giving the answer. Only the application changes rounds. This request grants no completion authority.",
    },
    nodes,
    tutor: {
      persona:
        "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in one or two short, unhurried sentences per turn, with at most one question. A kind's name can be a cue on its own. Leave time for thinking and self-correction. Never ask for personal information.",
      sessionGuidance:
        "At each round's cue, say just the plural name of the displayed kind with excitement, then listen. Count only the named kind. The star, string of lights, fireplace, rug and window are never counted. Treat the scene facts as private cues. Keep all totals private until the child gives a settled correct count. If the child is clearly counting aloud, wait silently for them to finish or self-correct. The final number of a finished count is their answer. If speech is unclear, ask them to repeat without suggesting a number. After the first wrong answer in this round, repeat the plural name and invite another look. Never say whether the count was too high or too low. After the second wrong answer in this round, say 'Let's count together' and slowly count the current kind with the child in order, stopping before the last number. If the kind has a single item, invite the child to count without saying any numbers. Wait for the child to say the final number. Tutor-supplied totals and echoes never establish success. If the child is quiet for about six seconds without starting to answer, repeat only the plural name, then listen. On a settled correct answer, explicitly confirm with the child's number and the plural name. You may then count the items aloud once, at a steady pace, and pause without a question. Never claim to see pointing or touching. Only the application changes the scene. Never say what's next or invent a new round.",
      startInstruction:
        "The parent pressed Start lesson. Speak first now in English. Explain the game once by saying \"Look at the Christmas tree! I'll name something, and you tell me how many you can find.\" Give the child a moment to look, then say just the current kind's plural name with excitement and listen. Let the child supply the answer.",
      nodeInstruction:
        "Stay with this rendered round. At the start of the lesson, give the opening before the first kind cue. On later round entries, say just the kind's plural name with excitement and listen. Follow the retry, silence and count-together guidance for this kind, and keep the total private until the child has supplied it. Confirm a settled correct answer, then pause. Only the application changes rounds.",
    },
    classifier: {
      objectiveInstructions:
        "Judge the learner's latest identifiable answer candidate for the CURRENT round independently of tutor feedback and separately from answerCommitment. Use the current scene facts answerKind, answer and kind. The answer is the count of the named kind only. An attempt explicitly counting a different kind, a mixture of kinds or a decoration outside the task is incorrect for this round. The last number of the child's finished count is their answer, including when the tutor counts with the child and stops before the child supplies the final number. Follow child revisions in order. Never pick an unresolved alternative because it matches the expected quantity. A tutor-supplied total, an echo of it, generic yes or finished, and outdated earlier-round answers do not establish a learner-owned current answer.",
      objectiveCriteria: {
        completed:
          "The latest identifiable learner-owned candidate matches the current kind's count. A finished count, a self-correction or the child supplying the final number after the tutor stops before it may establish that candidate. Judge commitment separately.",
        incorrect:
          "The latest identifiable learner-owned candidate gives the wrong count or explicitly counts the wrong things for this round. Judge commitment separately.",
        unclear_or_incomplete:
          "No single intelligible answer candidate is identifiable, alternatives remain unresolved, or a count is unfinished. Do not choose by the expected quantity or tutor agreement.",
        unresolved_help:
          "The learner requests or still needs help establishing an answer candidate rather than merely an explanation of an identifiable answer. Tutor help alone does not establish difficulty or learner evidence.",
        no_attempt:
          "No learner-owned current answer candidate exists. A tutor-supplied total, an echo, generic yes or finished, an earlier round's answer, greetings or unrelated speech do not count. Missing text does not imply silence or thinking.",
      },
      tutorInstructions:
        "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function, regardless of earlier behaviour or audio activity.",
      tutorCriteria: {
        confirmed_completion:
          "The latest tutor response explicitly confirms the child's settled correct count of the current kind. Generic praise, a total without settled learner evidence, or agreement with tentative or superseded evidence is insufficient.",
        clarifying: "Primarily asks the child to repeat, finish or disambiguate without supplying an answer or hint.",
        helping:
          "Primarily provides a counting hint or counts along with the child as a scaffold before the child answers.",
        asking: "Primarily cues the current kind or invites another look without clarifying or scaffolding.",
        other:
          "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
      },
    },
  });

  lessonsBySeed.set(seed, lesson);
  return lesson;
}
