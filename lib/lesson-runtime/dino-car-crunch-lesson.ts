import { validateLessonDefinition, type LessonDefinition } from "./lesson-definition";

export const DINO_CAR_CRUNCH_NODE_IDS = [
  "warm-up",
  "twenty-three",
  "forty-two",
  "fifty-six",
  "thirty-five",
  "twenty-nine",
] as const;

export const DINO_CAR_CRUNCH_LESSON: LessonDefinition = validateLessonDefinition({
  id: "dino-car-crunch",
  initialNodeId: "warm-up",
  answerAcceptance: "learner_evidence",
  // The chomp (~1.5 s) and the crunch's mic-safe window (450 ms + EFFECT_TAIL_MS) must finish before the next
  // scene, or the chomp is cut short and the next arrival sound is refused. The chomp starts once the answer is
  // accepted and the tutor is quiet, so hold both from the tutor going quiet (transitionQuietMs) and from the
  // accepted success appearing (successHoldMs): live, the classifier often accepts after the tutor has finished.
  transitionQuietMs: 2_200,
  successHoldMs: 2_200,
  addressLearnerByName: true,
  recovery: {
    supportClarificationInstruction:
      "One-time clarification for the still-rendered current scene: if the child is still waiting and has not spoken again, briefly ask whether they have finished or would like help. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. A settled correct answer or reaffirmation without renewed help or uncertainty needs a fresh explicit confirmation with its number and object, then pause. Generic yes or finished alone is insufficient. For renewed help, unresolved alternatives or uncertainty, help, wait or clarify without giving the answer. Never change scenes. This request grants no completion authority.",
    answerRecoveryInstruction:
      "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, briefly ask them to repeat it. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat an answer, method or hint, or imply success. Wait for a fresh answer; if it establishes settled correct current-scene success, explicitly confirm its number and object, then pause. For unfinished or uncertain answers, wait or clarify without giving the answer. Never change scenes. This request grants no completion authority.",
  },
  nodes: {
    "warm-up": {
      id: "warm-up",
      presentation: { sceneId: "warm-up", answerKind: "count", answer: 7, object: "car", firstCars: 3, moreCars: 4 },
      learningObjective: "Combine two small groups of cars by counting on.",
      tutorBrief:
        "Rex the dinosaur is hungry, and some cars arrive followed by more cars. How many cars does Rex get to eat altogether? Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "node", nodeId: "twenty-three" },
    },
    "twenty-three": {
      id: "twenty-three",
      presentation: {
        sceneId: "twenty-three",
        answerKind: "count",
        answer: 23,
        object: "car",
        trucks: 2,
        looseCars: 3,
      },
      learningObjective: "Add ones to a tens number using trucks of ten cars.",
      tutorBrief:
        "Rex the dinosaur is hungry, and big car-carrier trucks arrive with loose cars. How many cars does Rex get to eat altogether? Each big car-carrier truck is carrying ten cars. Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "node", nodeId: "forty-two" },
    },
    "forty-two": {
      id: "forty-two",
      presentation: { sceneId: "forty-two", answerKind: "count", answer: 42, object: "car", trucks: 4, looseCars: 2 },
      learningObjective: "Add ones to a tens number using trucks of ten cars.",
      tutorBrief:
        "Rex the dinosaur is hungry, and big car-carrier trucks arrive with loose cars. How many cars are there altogether? Each big car-carrier truck is carrying ten cars. Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "node", nodeId: "fifty-six" },
    },
    "fifty-six": {
      id: "fifty-six",
      presentation: { sceneId: "fifty-six", answerKind: "count", answer: 56, object: "car", trucks: 5, looseCars: 6 },
      learningObjective: "Add ones to a tens number using trucks of ten cars.",
      tutorBrief:
        "Rex the dinosaur is hungry, and big car-carrier trucks arrive with loose cars. How many cars does Rex get to eat altogether? Each big car-carrier truck is carrying ten cars. Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "node", nodeId: "thirty-five" },
    },
    "thirty-five": {
      id: "thirty-five",
      presentation: { sceneId: "thirty-five", answerKind: "count", answer: 35, object: "car", trucks: 3, looseCars: 5 },
      learningObjective: "Add ones to a tens number using trucks of ten cars.",
      tutorBrief:
        "Rex the dinosaur is hungry, and big car-carrier trucks arrive with loose cars. How many cars are there altogether? Each big car-carrier truck is carrying ten cars. Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "node", nodeId: "twenty-nine" },
    },
    "twenty-nine": {
      id: "twenty-nine",
      presentation: { sceneId: "twenty-nine", answerKind: "count", answer: 29, object: "car", trucks: 2, looseCars: 9 },
      learningObjective: "Add ones to a tens number using trucks of ten cars.",
      tutorBrief:
        "Rex the dinosaur is hungry, and big car-carrier trucks arrive with loose cars. How many cars does Rex get to eat altogether? Each big car-carrier truck is carrying ten cars. Success story idea: Rex can't wait to chomp them. Never claim Rex has eaten before the application shows it.",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona:
      "You are Sprout, a playful, warm companion for a preschool child with a parent present. Speak English in one or two short, unhurried sentences per turn, with at most one question. Leave time for thinking and self-correction. Never ask for personal information.",
    sessionGuidance:
      "Ask one question per turn. Never disclose the tested answer before the child gives it. If speech is unclear or inaudible, ask the child to repeat without suggesting an answer. Let the child finish and self-correct. For a wrong answer, gently invite another try. When the child is stuck or asks for help on a truck scene, say the tens from the trucks, then count on through the loose cars together (for example, twenty, twenty-one, twenty-two), stopping before the last number so the child says the total. On the warm-up, count on from the first group in the same way, stopping before the last number. Never state the total as a hint. Give one hint at a time, then wait. Confirm a settled correct answer explicitly using the child's number and object, then pause. Generic yes or finished is never an answer. Never claim to see pointing or touching. Only the application changes scenes or makes Rex chomp; never say Rex ate before the application shows it.",
    startInstruction:
      "The parent pressed Start lesson. Speak first now in English, introduce the displayed scene and ask its question, then pause and listen. Let the child supply the answer.",
    nodeInstruction:
      "Stay with the current scene and follow its brief and session guidance. Introduce it and ask naturally, then listen. If the child is stuck or asks for help, say the tens from the trucks and count on through the loose cars together, stopping before the last number for the child to say; for the warm-up count on from the first group instead. Never state the total as a hint. Give one hint at a time, then wait. Confirm settled success with the child's number and object, then pause. Only the application changes scenes or makes Rex chomp; never say Rex ate before the application shows it.",
  },
  classifier: {
    objectiveInstructions:
      "Judge the learner's latest identifiable answer candidate for the CURRENT node independently of tutor feedback and separately from answerCommitment. Use the current scene facts answerKind and answer: count requires the number of cars. Follow learner revisions in order. Never choose an unresolved alternative because it matches the expected answer. When the tutor counts on and stops before the total, the child saying the final number is a learner-owned answer. If the tutor states the total and the child echoes it, that echo is not a learner-owned answer. The number of trucks alone, such as five, or trucks and loose cars summed as units, such as eleven for five trucks and six cars, is incorrect. Generic yes or finished and outdated earlier-node answers do not establish a learner-owned current answer.",
    objectiveCriteria: {
      completed:
        "The latest identifiable learner-owned candidate matches the current node's answer. A completed count or self-correction may supply it, including the child saying the final number after the tutor stops counting before it. Judge commitment separately; tutor-supplied answers and echoes alone are not success.",
      incorrect:
        "The latest identifiable learner-owned candidate is wrong for the current node, including the number of trucks alone or trucks and loose cars summed as units. Judge commitment separately.",
      unclear_or_incomplete:
        "No single intelligible answer candidate is identifiable, alternatives remain unresolved, or a count is unfinished. Do not choose by the expected answer or tutor agreement.",
      unresolved_help:
        "The learner requests or still needs help establishing an answer candidate rather than merely an explanation of an identifiable answer. Tutor help alone does not establish difficulty or learner evidence.",
      no_attempt:
        "No learner-owned current task-answer candidate exists: only tutor-supplied content or an echo, generic yes or finished, an outdated answer, greetings or unrelated speech. Missing text does not imply silence or thinking.",
    },
    tutorInstructions:
      "Describe only the latest relevant tutor response in the ordered transcript, using earlier messages as context. Select its primary conversational function, not earlier behaviour or audio activity.",
    tutorCriteria: {
      confirmed_completion:
        "The latest tutor response explicitly confirms the child's settled correct current answer. Generic praise, supplying an answer without settled learner evidence, or agreeing with tentative or superseded evidence is insufficient.",
      clarifying: "Primarily asks the child to repeat, finish or disambiguate without supplying an answer or hint.",
      helping: "Primarily gives a hint or method for counting, including scaffolding phrased as a question.",
      asking: "Primarily invites an answer to the current question without clarifying or scaffolding.",
      other:
        "No tutor message, generic encouragement or thanks without confirmation, unrelated speech, or another function.",
    },
  },
});
