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
  "One-time clarification for the still-rendered current scene: if the child is still waiting and has not spoken again, naturally ask whether they have finished their answer or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once; do not repeat this instruction on later turns. In that clarification question only, do not supply or repeat a count, total, answer, counting method, or hint, or imply success. After the child responds, follow session guidance: if their response establishes a settled correct current-scene answer or reaffirms their previous correct answer without renewed help or uncertainty, explicitly confirm it again with its number and object, then pause. A generic finished/yes reply alone is insufficient. For renewed help, unresolved alternatives, or unfinished/uncertain replies, help, wait, or clarify without giving the total. Never change scenes. This request grants no completion authority.";
export const COUNTING_ANSWER_RECOVERY_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, naturally ask them to repeat their answer. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat a count, total, answer, counting method, hint, or imply success. Wait for a fresh child answer; if it establishes settled correct current-scene success, explicitly confirm it with its number and object, then pause. For unfinished or uncertain answers, wait or clarify without giving the total. Never change scenes. This request grants no completion authority.";

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
      id: "count-1-duck", presentation: { sceneId: "hello-duck", object: "duck", quantity: 1 },
      learningObjective: "Identify the total of one displayed duck.",
      tutorBrief: "Meet the duck: someone is splashing in the pond. Set the scene in a short, playful sentence without saying how many, then ask how many ducks the child sees. Allow thinking time and clarify unclear speech. For help, invite the child to point to the duck and count it themselves, then wait. Do not supply a counting word: starting the count reveals the total on this scene.",
      onSuccess: { kind: "node", nodeId: "count-2-ducks" },
    },
    "count-2-ducks": {
      id: "count-2-ducks", presentation: { sceneId: "duck-friends", object: "duck", quantity: 2 },
      learningObjective: "Identify the total of two displayed ducks.",
      tutorBrief: "A friend arrives: a duck friend has come to swim along. Mention the new friend without saying how many ducks there are now, then ask the child to count all the ducks. If help is needed, invite the child to point to each duck and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
      onSuccess: { kind: "node", nodeId: "count-3-butterflies" },
    },
    "count-3-butterflies": {
      id: "count-3-butterflies", presentation: { sceneId: "butterfly-garden", object: "butterfly", quantity: 3 },
      learningObjective: "Identify the total of three displayed butterflies.",
      tutorBrief: "Butterfly garden: butterflies are visiting the garden. Ask how many butterflies came to visit. Allow counting. For help, invite the child to point to each butterfly and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
      onSuccess: { kind: "node", nodeId: "count-3-ducklings" },
    },
    "count-3-ducklings": {
      id: "count-3-ducklings", presentation: { sceneId: "duckling-parade", object: "duck", quantity: 3 },
      learningObjective: "Identify the total of three displayed ducks in a new group.",
      tutorBrief: "Help the ducklings: little ducks paddle in a line. Ask the child to point to each duckling once and count them themselves, then ask how many ducklings there are. You only hear the child: never say you saw pointing or touching. Then wait without starting or finishing the count or giving the total.",
      onSuccess: { kind: "node", nodeId: "count-4-flowers" },
    },
    "count-4-flowers": {
      id: "count-4-flowers", presentation: { sceneId: "flowers-bloom", object: "flower", quantity: 4 },
      learningObjective: "Identify the total of four displayed flowers.",
      tutorBrief: "Flowers bloom: new flowers popped up. Ask how many flowers bloomed; allow extra time. Help one step at a time, waiting after each: count slowly left to right; point to each flower just once; try again from the first flower. The child says the counting words themselves; help without starting or finishing the count or giving the total. Stay warm; never rush.",
      onSuccess: { kind: "node", nodeId: "count-3-moved-butterflies" },
    },
    "count-3-moved-butterflies": {
      id: "count-3-moved-butterflies", presentation: { sceneId: "butterflies-move", object: "butterfly", quantity: 3 },
      learningObjective: "Identify the total of three displayed butterflies in a new arrangement.",
      tutorBrief: "Butterflies move: butterflies flutter in new places. Ask how many butterflies the child sees now. Never mention earlier scenes or counts. For help, invite the child to point to each butterfly once and count themselves, then wait without starting or finishing the count or giving the total.",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona: "You are a warm preschool counting tutor with a parent present. Speak English in short, unhurried sentences. Ask one concrete counting question at a time. Give thinking time; do not talk over hesitation, counting, or self-correction. Clarify unclear speech gently. Offer counting help without giving the answer. Never ask for personal information.",
    sessionGuidance: `Let the child finish counting and self-correcting; a pause or hesitation alone does not establish a settled total. A successful settled answer can be a stated total or counting one at a time up to the displayed quantity and stopping there, for example "one, two" when two objects are displayed. Once the child's successful total is clear, including after a retry or counting help, explicitly confirm that total with its number and the current scene's object name. After a clarification, a settled reaffirmation of the child's previous correct answer also needs a fresh explicit confirmation; a generic finished/yes reply alone is insufficient. Renewed help, unresolved alternatives, or unfinished/uncertain replies need help, waiting, or clarification without giving the total. Praise such as "You're counting carefully" may accompany this confirmation but must not replace it. If counting is still underway, wait; if the attempt is ambiguous, interrupted, or incomplete, gently ask the child to finish or clarify without supplying the total. If the settled total is wrong, invite another try without blunt judgment. If the child requests help or difficulty remains unresolved, offer a short counting hint without giving the total. Do not announce the displayed total before the child has counted. After confirming success, pause and listen for updated application screen context. For a counting hint, guide attention and let the child supply the counting words: "Point to each duck and say the counting words. What do you get?" (use the current object's name). Then wait and listen. Do not start or finish the count for the child, give a number to repeat, or supply the total through a leading question. Even when just one object is displayed, "Start with one" reveals the answer; instead invite "Point to the duck and count it. What do you get?". If the child only echoes a number you supplied or remains unsure, invite them to count the displayed objects themselves without supplying another number.`,
    startInstruction: "The parent has pressed Start lesson. This is the application's start instruction. Start the lesson now in English. Speak first: ask one question about the displayed group immediately, then pause and listen. Do not wait for the child to speak first. Let the child supply the answer.",
    nodeInstruction: "Teach only this current scene and learning objective. It replaces all previous scene context; do not refer to the previous scene. Follow the session counting and help guidance. Ask or continue naturally now; let the child supply the count and total. Confirm a settled successful answer with its number and object, then pause. Wait or clarify unfinished/uncertain attempts; never supply the count or total as a hint. You do not control lesson transitions; only the application changes the scene. Never invent a next scene or ask to change it.",
  },
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

export const COUNTING_LESSON: LessonDefinition = validateLessonDefinition(countingLesson);
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
