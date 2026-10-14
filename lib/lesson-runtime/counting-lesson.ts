import { validateLessonDefinition, type LessonDefinition } from "./lesson-definition";

export const COUNTING_NODE_IDS = ["count-1-duck", "count-2-ducks", "count-3-butterflies"] as const;
export type CountingNodeId = (typeof COUNTING_NODE_IDS)[number];
export const INITIAL_COUNTING_NODE_ID: CountingNodeId = "count-1-duck";

export const COUNTING_SUPPORT_CLARIFICATION_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: if the child is still waiting and has not spoken again, naturally ask whether they have finished their answer or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once; do not repeat this instruction on later turns. In that clarification question only, do not supply or repeat a count, total, answer, counting method, or hint, or imply success. After the child responds, follow session guidance: if their response establishes a settled correct current-scene answer or reaffirms their previous correct answer without renewed help or uncertainty, explicitly confirm it again with its number and object, then pause. A generic finished/yes reply alone is insufficient. For renewed help, unresolved alternatives, or unfinished/uncertain replies, help, wait, or clarify without giving the total. Never change scenes. This request grants no completion authority.";
export const COUNTING_ANSWER_RECOVERY_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, naturally ask them to repeat their answer. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat a count, total, answer, counting method, hint, or imply success. Wait for a fresh child answer; if it establishes settled correct current-scene success, explicitly confirm it with its number and object, then pause. For unfinished or uncertain answers, wait or clarify without giving the total. Never change scenes. This request grants no completion authority.";

const countingLesson = {
  id: "counting",
  initialNodeId: INITIAL_COUNTING_NODE_ID,
  recovery: {
    supportClarificationInstruction: COUNTING_SUPPORT_CLARIFICATION_INSTRUCTION,
    answerRecoveryInstruction: COUNTING_ANSWER_RECOVERY_INSTRUCTION,
  },
  nodes: {
    "count-1-duck": {
      id: "count-1-duck", presentation: { sceneId: "hello-duck", object: "duck", quantity: 1 },
      learningObjective: "Identify the total of one displayed duck.",
      tutorBrief: "Ask how many ducks the child sees. Allow thinking time and clarify unclear speech. For help, invite the child to point to the duck and count it themselves, then wait. Do not supply a counting word: starting the count reveals the total on this scene.",
      onSuccess: { kind: "node", nodeId: "count-2-ducks" },
    },
    "count-2-ducks": {
      id: "count-2-ducks", presentation: { sceneId: "duck-friends", object: "duck", quantity: 2 },
      learningObjective: "Identify the total of two displayed ducks.",
      tutorBrief: "Ask how many ducks the child sees. If help is needed, invite the child to point to each duck and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
      onSuccess: { kind: "node", nodeId: "count-3-butterflies" },
    },
    "count-3-butterflies": {
      id: "count-3-butterflies", presentation: { sceneId: "butterfly-garden", object: "butterfly", quantity: 3 },
      learningObjective: "Identify the total of three displayed butterflies.",
      tutorBrief: "Ask how many butterflies the child sees. Allow counting. For help, invite the child to point to each butterfly and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
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
    objectiveInstructions: "Which mutually exclusive state best describes the objective now? Unresolved current help takes precedence over a previously correct or incorrect answer.",
    objectiveCriteria: {
      completed: "The child has settled on an intelligible correct answer for the authored quantity, including a finished count, self-correction, or reaffirmation. Earlier errors or help are resolved by later settled success. A later status question such as is that all does not automatically retract a settled answer unless it expresses renewed task uncertainty or help. Fillers or opening hesitation alone do not undo settlement. This is task completion, not proof of independent mastery.",
      incorrect: "The child has settled on an intelligible incorrect answer; no continuing help request or difficulty remains current.",
      unclear_or_incomplete: "The child attempted the task but has not settled on an intelligible answer: a partial count, unfinished speech, unresolved alternatives, or genuinely tentative final task answer. Tutor agreement cannot settle it. Use unresolved_help instead if continuing difficulty or a help request remains current.",
      unresolved_help: "The child still needs help or expresses continuing difficulty at snapshot end, including renewed help or renewed task uncertainty after a correct answer. Historical help resolved by a later settled correct child answer is no longer current. A wrong or partial answer alone does not establish a help need. Tutor help alone does not establish current child difficulty. A tutor-supplied answer without settled child evidence cannot resolve a help request.",
      no_attempt: "No Child-labelled task attempt exists for this objective; only tutor-supplied answers, greetings or unrelated speech. Not-knowing and help requests belong to unresolved_help. Missing text does not imply silence or thinking.",
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
export type CountingLessonNode = {
  readonly id: CountingNodeId;
  readonly sceneId: "hello-duck" | "duck-friends" | "butterfly-garden";
  readonly object: "duck" | "butterfly";
  readonly quantity: 1 | 2 | 3;
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
