import { validateLessonDefinition, type LessonDefinition } from "./lesson-definition";

export const COUNTING_NODE_IDS = [
  "count-1-duck",
  "count-2-ducks",
  "count-3-butterflies",
  "count-3-ducklings",
  "count-4-flowers",
  "count-3-moved-butterflies",
] as const;
export type CountingNodeId = (typeof COUNTING_NODE_IDS)[number];
export const INITIAL_COUNTING_NODE_ID: CountingNodeId = "count-1-duck";

export const COUNTING_SUPPORT_CLARIFICATION_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: if the child is still waiting and has not spoken again, briefly ask whether they have finished or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. In that question, do not supply or repeat a count, total, answer, method, or hint, or imply success. After the child responds, follow session guidance: a settled correct answer or reaffirmation without renewed help or uncertainty needs a fresh explicit confirmation with its number and object, then pause. A generic finished/yes reply alone is insufficient. For renewed help, unresolved alternatives, or unfinished/uncertain replies, help, wait, or clarify without giving the total. Never change scenes. This request grants no completion authority.";
export const COUNTING_ANSWER_RECOVERY_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, briefly ask them to repeat it. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat a count, total, answer, method, or hint, or imply success. Wait for a fresh answer; if it establishes settled correct current-scene success, explicitly confirm it with its number and object, then pause. For unfinished or uncertain answers, wait or clarify without giving the total. Never change scenes. This request grants no completion authority.";

/** Shared counting guidance; only the one-object example differs per adventure. */
const countingSessionGuidance = (singleItem: string) =>
  `Introduce each scene with a brief playful story sentence and one counting question; do not explain how to count unless help is needed. Let the child finish counting and self-correct; an unfinished count means wait. A settled answer can be a stated total or a finished count up to the displayed quantity. Speech recognition can mishear: if what you heard is unclear, surprising, or not a number, briefly ask the child to say it again without echoing or suggesting a number before treating it as wrong. For a settled wrong answer, gently invite another try, without blunt "no". Once success is settled, explicitly confirm the child's number and the current object's name, add a short story-connected line, then pause for application screen context. Vary acknowledgments rather than using stock praise. After clarification, a settled reaffirmation of the previous correct answer needs a fresh explicit number and object confirmation; a generic yes or finished alone is insufficient. For renewed help, unresolved alternatives, or uncertainty, help, wait, or clarify without giving the total. When help is needed, give one actionable hint per turn, then wait: point to each current object and count; go slowly, one at a time; start again from the first one. Never re-ask the same question with slightly different wording; move to the next hint or wait. Never claim to see pointing or touching; you only hear the child. Never supply a counting word, start or finish the count, give the total or a number to repeat. Even "start with one" reveals the answer for ${singleItem}. An echo of a supplied number is not the child's own answer.`;

const countingLesson = {
  id: "counting",
  answerAcceptance: "learner_evidence",
  initialNodeId: INITIAL_COUNTING_NODE_ID,
  recovery: {
    supportClarificationInstruction: COUNTING_SUPPORT_CLARIFICATION_INSTRUCTION,
    answerRecoveryInstruction: COUNTING_ANSWER_RECOVERY_INSTRUCTION,
  },
  nodes: {
    "count-1-duck": {
      id: "count-1-duck",
      presentation: { sceneId: "hello-duck", object: "duck", quantity: 1 },
      learningObjective: "Identify the total of one displayed duck.",
      tutorBrief:
        "Meet the duck: someone is splashing in the pond. How many ducks do you see? Success story idea: the duck loves splashing.",
      onSuccess: { kind: "node", nodeId: "count-2-ducks" },
    },
    "count-2-ducks": {
      id: "count-2-ducks",
      presentation: { sceneId: "duck-friends", object: "duck", quantity: 2 },
      learningObjective: "Identify the total of two displayed ducks.",
      tutorBrief:
        "A friend arrives: a duck friend came to play. How many ducks are swimming now? Success story idea: the friends are having fun together.",
      onSuccess: { kind: "node", nodeId: "count-3-butterflies" },
    },
    "count-3-butterflies": {
      id: "count-3-butterflies",
      presentation: { sceneId: "butterfly-garden", object: "butterfly", quantity: 3 },
      learningObjective: "Identify the total of three displayed butterflies.",
      tutorBrief:
        "Butterfly garden: butterflies flutter into the garden. How many butterflies came to visit? Success story idea: they love the garden.",
      onSuccess: { kind: "node", nodeId: "count-3-ducklings" },
    },
    "count-3-ducklings": {
      id: "count-3-ducklings",
      presentation: { sceneId: "duckling-parade", object: "duck", quantity: 3 },
      learningObjective: "Identify the total of three displayed ducks in a new group.",
      tutorBrief:
        "Help the ducklings: little ducklings paddle in a line. How many ducklings are there? If help is needed, invite pointing to each duckling. Success story idea: the parade is ready to splash.",
      onSuccess: { kind: "node", nodeId: "count-4-flowers" },
    },
    "count-4-flowers": {
      id: "count-4-flowers",
      presentation: { sceneId: "flowers-bloom", object: "flower", quantity: 4 },
      learningObjective: "Identify the total of four displayed flowers.",
      tutorBrief:
        "Flowers bloom: flowers pop up in the garden. How many flowers bloomed? Give extra time. Success story idea: the flowers are soaking up sunshine.",
      onSuccess: { kind: "node", nodeId: "count-3-moved-butterflies" },
    },
    "count-3-moved-butterflies": {
      id: "count-3-moved-butterflies",
      presentation: { sceneId: "butterflies-move", object: "butterfly", quantity: 3 },
      learningObjective: "Identify the total of three displayed butterflies in a new arrangement.",
      tutorBrief:
        "Butterflies move: butterflies flutter around the garden. How many butterflies do you see? Success story idea: they are dancing in the breeze.",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona:
      "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in one or two short, unhurried sentences per turn, with at most one question. Leave plenty of silence for thinking, counting, and self-correction. Never ask for personal information.",
    sessionGuidance: countingSessionGuidance("a single duck"),
    startInstruction:
      "The parent pressed Start lesson. This is the application's start instruction. Speak first now in English; do not wait for the child to speak first. Introduce the displayed scene and ask its counting question, then pause and listen. Let the child supply the answer.",
    nodeInstruction:
      "Stay with this current scene; do not refer to previous scenes. Follow the counting and help guidance. Introduce it and ask naturally, then listen. Confirm settled success with its number and object, then pause. Never supply the count or total as a hint. Only the application changes scenes; never invent or request the next scene.",
  },
  // prettier-ignore
  classifier: {
    objectiveInstructions: "Judge the correctness of the learner's latest identifiable task-answer candidate independently of tutor feedback and separately from answerCommitment. Commitment describes whether the learner endorses the candidate; this question describes whether that candidate matches the authored quantity. Follow learner revisions in order. When unresolved alternatives leave no single candidate identifiable, do not select the correct alternative just because it matches the expected quantity. Tutor words cannot establish a learner-owned answer.",
    objectiveCriteria: {
      completed: "The latest identifiable learner-owned answer candidate is correct for the authored quantity. A finished count or a self-correction may supply that candidate. Evaluate correctness separately from commitment: hesitation alone is not an incorrect answer. An explanation request does not by itself change the candidate. Tutor-supplied answer content or a simple echo alone cannot establish learner success. This is task correctness, not proof of independent mastery.",
      incorrect: "The latest identifiable learner-owned answer candidate is incorrect for the authored quantity. The separate commitment judgment determines whether the learner has settled on it.",
      unclear_or_incomplete: "The text does not establish one intelligible answer candidate, leaves competing candidates unidentified, or contains only an unfinished count or explanation. Do not choose a candidate using the expected quantity or tutor agreement.",
      unresolved_help: "The learner requests or still needs help establishing a task-answer candidate, rather than merely requesting an explanation of an identifiable answer. Tutor help alone does not establish learner difficulty; tutor-supplied content cannot substitute for learner evidence.",
      no_attempt: "No learner-owned task-answer candidate exists for this objective; there is only tutor-supplied content, greetings or unrelated speech. Missing text does not imply silence or thinking.",
    },
    tutorInstructions: "Describe only the latest relevant tutor response in the ordered transcript, using earlier child and tutor messages as context. Earlier messages are context only, never the latest tutor action. Select the latest response's primary conversational function, not earlier tutor behaviour or physical audio activity.",
    tutorCriteria: {
      confirmed_completion: "The latest relevant tutor response clearly confirms the child's settled correct answer for this current objective. Agreement or a factual restatement can confirm it. Generic praise or thanks alone is insufficient. Supplying a total without settled child evidence, correcting a still-wrong answer, or agreeing with unfinished, tentative or superseded evidence is not confirmation.",
      clarifying: "Primarily asks the child to repeat, finish or disambiguate their response without supplying an answer or counting method.",
      helping: "Primarily gives a hint, counting method, model or invitation to count together, including scaffolding phrased as a question.",
      asking: "Primarily invites the child to answer the current authored counting question, without clarifying their response or giving a scaffold.",
      other: "No tutor message, generic encouragement or thanks without answer confirmation, unrelated speech, or another function not covered above.",
    },
  },
} as const satisfies LessonDefinition;

export function buildCountingLesson({
  id,
  initialNodeId,
  nodes,
  singleItemExample,
  transitionQuietMs,
}: {
  id: string;
  initialNodeId: string;
  nodes: LessonDefinition["nodes"];
  singleItemExample: string;
  transitionQuietMs?: number;
}): LessonDefinition {
  return validateLessonDefinition({
    ...countingLesson,
    id,
    initialNodeId,
    nodes,
    ...(transitionQuietMs === undefined ? {} : { transitionQuietMs }),
    tutor: {
      ...countingLesson.tutor,
      sessionGuidance: countingSessionGuidance(singleItemExample),
    },
  });
}

export const COUNTING_LESSON: LessonDefinition = buildCountingLesson({
  id: countingLesson.id,
  initialNodeId: countingLesson.initialNodeId,
  nodes: countingLesson.nodes,
  singleItemExample: "a single duck",
});
type AuthoredCountingNode = (typeof countingLesson.nodes)[CountingNodeId];
export type CountingLessonNode = {
  readonly id: CountingNodeId;
  readonly sceneId: AuthoredCountingNode["presentation"]["sceneId"];
  readonly object: AuthoredCountingNode["presentation"]["object"];
  readonly quantity: AuthoredCountingNode["presentation"]["quantity"];
  readonly learningObjective: string;
  readonly tutorBrief: string;
  readonly onSuccess: { readonly kind: "node"; readonly nodeId: CountingNodeId } | { readonly kind: "complete" };
};
export const COUNTING_LESSON_GRAPH = Object.fromEntries(
  Object.entries(COUNTING_LESSON.nodes).map(([id, node]) => [id, { ...node, ...node.presentation }]),
) as unknown as Readonly<Record<CountingNodeId, CountingLessonNode>>;
export function isCountingNodeId(value: unknown): value is CountingNodeId {
  return typeof value === "string" && COUNTING_NODE_IDS.includes(value as CountingNodeId);
}
