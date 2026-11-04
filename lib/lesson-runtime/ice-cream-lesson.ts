import { validateLessonDefinition, type LessonDefinition } from "./lesson-definition";

export const ICE_CREAM_NODE_IDS = [
  "count-cones",
  "name-pink",
  "count-pink",
  "order-first",
  "order-second",
  "count-scoops",
] as const;

export const ICE_CREAM_LESSON: LessonDefinition = validateLessonDefinition({
  id: "ice-cream-shop",
  initialNodeId: "count-cones",
  answerAcceptance: "learner_evidence",
  transitionQuietMs: 1_000,
  addressLearnerByName: true,
  recovery: {
    supportClarificationInstruction:
      "One-time clarification for the still-rendered current scene: if the child is still waiting and has not spoken again, briefly ask whether they have finished or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. A settled correct answer or reaffirmation without renewed help or uncertainty needs a fresh explicit confirmation with its number and object, or colour, then pause. Generic yes or finished alone is insufficient. For renewed help, unresolved alternatives or uncertainty, help, wait or clarify without giving the answer. Never change scenes. This request grants no completion authority.",
    answerRecoveryInstruction:
      "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, briefly ask them to repeat it. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. Wait for a fresh answer; if it establishes settled correct current-scene success, explicitly confirm its number and object, or colour, then pause. For unfinished or uncertain answers, wait or clarify without giving the answer. Never change scenes. This request grants no completion authority.",
  },
  nodes: {
    "count-cones": {
      id: "count-cones",
      presentation: { sceneId: "open-shop", answerKind: "count", answer: 2, object: "cone", quantity: 2 },
      learningObjective: "Identify the number of empty cones.",
      tutorBrief: "The shop is opening and empty cones are on the counter. How many cones do you see?",
      onSuccess: { kind: "node", nodeId: "name-pink" },
    },
    "name-pink": {
      id: "name-pink",
      presentation: { sceneId: "pink-scoop", answerKind: "colour", answer: "pink", choices: "pink or yellow" },
      learningObjective: "Name the colour of the displayed scoop.",
      tutorBrief:
        "A big strawberry-motif scoop is shown on its own. Is this scoop pink or yellow? Strawberry alone is not a colour answer; gently ask what colour it is.",
      onSuccess: { kind: "node", nodeId: "count-pink" },
    },
    "count-pink": {
      id: "count-pink",
      presentation: {
        sceneId: "pink-scoops",
        answerKind: "count",
        answer: 2,
        object: "pink scoop",
        quantity: 2,
        distractor: "one yellow scoop",
      },
      learningObjective: "Count the pink scoops without counting the yellow distractor.",
      tutorBrief:
        "Loose pink scoops and a yellow scoop are on display. How many pink scoops do you see? If the child counts the yellow scoop, gently remind them to count only the pink ones.",
      onSuccess: { kind: "node", nodeId: "order-first" },
    },
    "order-first": {
      id: "order-first",
      presentation: {
        sceneId: "build-first",
        answerKind: "order_step",
        answer: "pink",
        step: 1,
        steps: 2,
        order: "pink first, then yellow",
      },
      learningObjective: "Recall the first colour in the order.",
      tutorBrief:
        "An empty cone and pink and yellow tubs are shown. Say: Let's make one with pink first, then yellow. Which colour goes on first?",
      onSuccess: { kind: "node", nodeId: "order-second" },
    },
    "order-second": {
      id: "order-second",
      presentation: {
        sceneId: "build-second",
        answerKind: "order_step",
        answer: "yellow",
        step: 2,
        steps: 2,
        order: "pink first, then yellow",
      },
      learningObjective: "Recall the next colour in the order.",
      tutorBrief:
        "The cone has a pink scoop, with pink and yellow tubs to the side. Which colour goes on next? Restate the order only if help is needed; pink again is not the next step.",
      onSuccess: { kind: "node", nodeId: "count-scoops" },
    },
    "count-scoops": {
      id: "count-scoops",
      presentation: { sceneId: "tall-cone", answerKind: "count", answer: 3, object: "scoop", quantity: 3 },
      learningObjective: "Count the scoops on the completed cone.",
      tutorBrief:
        "A tall ice cream has pink, yellow and chocolate scoops stacked on a cone. How many scoops are on this ice cream?",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona:
      "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in one or two short, unhurried sentences per turn, with at most one question. Leave time for thinking and self-correction. Never ask for personal information.",
    sessionGuidance:
      "Ask one question per turn. Never disclose the tested answer before the child gives it: the number for count nodes or the answer colour for colour and order nodes, except the authored order statement at build-first and the forced-choice question at pink-scoop. If speech is unclear or inaudible, ask the child to repeat without suggesting an answer. Let the child finish and self-correct. For a wrong answer, gently invite another try. Give at most one actionable hint at a time, then wait. Confirm a settled correct answer explicitly using the child's number and object, or colour, then pause. Generic yes or finished is never an answer. Never claim to see pointing or touching. Only the application changes scenes or places scoops; never say a scoop was added or invent orders or flavours.",
    startInstruction:
      "The parent pressed Start lesson. Speak first now in English, introduce the displayed scene and ask its question, then pause and listen. Let the child supply the answer.",
    nodeInstruction:
      "Stay with the current scene and follow its brief and session guidance. Introduce it and ask naturally, then listen. Confirm settled success with the child's number and object, or colour, then pause. Never reveal the answer as a hint except the authored order statement at build-first or the order hint at build-second after help is needed. Only the application changes scenes or places scoops.",
  },
  classifier: {
    objectiveInstructions:
      "Judge the learner's latest identifiable answer candidate for the CURRENT node independently of tutor feedback and separately from answerCommitment. Use the current scene facts answerKind and answer: count requires the number; colour requires the colour word naming the shown scoop; order_step requires the colour for this step only, and the other step's colour is incorrect. The authored order statement gives the sequence to remember, not an answer to the subsequent step question: a learner independently selecting a colour for that question is valid. Follow learner revisions in order. Never choose an unresolved alternative because it matches the expected answer. Tutor-supplied answers to the current question, simple echoes of those suggestions, generic yes or finished, flavour names without a colour, and outdated earlier-node answers do not establish a learner-owned current answer.",
    objectiveCriteria: {
      completed:
        "The latest identifiable learner-owned candidate matches the current node's answer. A completed count or self-correction may supply it. Judge commitment separately; tutor-supplied answers and echoes alone are not success.",
      incorrect:
        "The latest identifiable learner-owned candidate is wrong for the current node, including the colour for the other order step. Judge commitment separately.",
      unclear_or_incomplete:
        "No single intelligible answer candidate is identifiable, alternatives remain unresolved, or a count is unfinished. Do not choose by the expected answer or tutor agreement.",
      unresolved_help:
        "The learner requests or still needs help establishing an answer candidate rather than merely an explanation of an identifiable answer. Tutor help alone does not establish difficulty or learner evidence.",
      no_attempt:
        "No learner-owned current task-answer candidate exists: only tutor-supplied content or an echo, a flavour without a colour, generic yes or finished, an outdated answer, greetings or unrelated speech. Missing text does not imply silence or thinking.",
    },
    tutorInstructions:
      "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function, not earlier behaviour or audio activity.",
    tutorCriteria: {
      confirmed_completion:
        "The latest tutor response explicitly confirms the child's settled correct current answer. Generic praise, supplying an answer without settled learner evidence, or agreeing with tentative or superseded evidence is insufficient.",
      clarifying: "Primarily asks the child to repeat, finish or disambiguate without supplying an answer or hint.",
      helping:
        "Primarily gives a hint or method for counting, colour or order, including scaffolding phrased as a question.",
      asking: "Primarily invites an answer to the current question without clarifying or scaffolding.",
      other:
        "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
    },
  },
});
