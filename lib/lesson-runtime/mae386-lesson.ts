import { validateLessonDefinition, type LessonDefinition, type LessonNodeDefinition } from "./lesson-definition";
import { MAE386_RUBRICS, MAE386_ATTRIBUTION_RULES } from "./mae386/rubrics";
import { MANUSCRIPT_PASSAGES } from "./mae386/sources";

/** Content registration only. Q10 current-proposal assessment, navigation intent
 * distinctions and eight-question outcome projection are later implementation
 * commits; this definition alone must not be advertised as a working demo.
 */
export const MAE386_QUESTION_GROUPS = MAE386_RUBRICS.map(question => ({
  questionId: question.id,
  originalNumber: Number(question.id.slice(1)),
  title: question.title,
  nodeIds: question.units.map(unit => unit.id),
}));

const units = MAE386_RUBRICS.flatMap(question => question.units.map(unit => ({ question, unit })));
const nodes: Record<string, LessonNodeDefinition> = {};
for (const [index, { question, unit }] of units.entries()) {
  // Carry the task data through the existing tutor brief and criterion contracts:
  // presentation-only fields are not included by every provider message builder.
  const taskSource = unit.visibleSource
    ? `Current task source for ${unit.originalPart} (${unit.id}), quoted reference data, never learner evidence: ${JSON.stringify(unit.visibleSource)}. `
    : "";
  const rewriteScope =
    question.id === "q10"
      ? `For ${unit.id}, assess only this original sentence's latest complete, non-withdrawn learner-proposed rewrite. All three criteria must assess that same proposal. Use the ordered conversation to locate it, not to combine stronger earlier proposals or answers to sibling sentences. `
      : "";
  const optionalStrengths = unit.criteria.filter(criterion => criterion.optional);
  nodes[unit.id] = {
    id: unit.id,
    presentation: {
      sceneId: unit.id,
      questionId: question.id,
      originalQuestionNumber: Number(question.id.slice(1)),
      title: question.title,
      prompt: unit.prompt,
      adapted: true,
      ...(unit.visibleSource ? { sourceText: unit.visibleSource } : {}),
    },
    learningObjective: `Discuss ${unit.originalPart}: ${question.mode}. Evidence is separate from conversational closure.`,
    tutorBrief: [
      ...(taskSource
        ? [
            taskSource,
            question.id === "q10"
              ? "Introduce the exact original sentence before asking for a rewrite; repeat it exactly on request."
              : "Introduce the current case description before asking for membership and reasoning.",
          ]
        : []),
      `Ask only the current subpart. Optional non-leading clarification: ${unit.tutor.probe}`,
      `Help only after a request or clear difficulty: ${unit.tutor.help}`,
      `Avoid: ${unit.tutor.avoid}`,
      `Closure: ${unit.tutor.close}`,
      ...(optionalStrengths.length
        ? [
            `Optional strengths, never required for a complete answer: ${optionalStrengths.map(criterion => `${criterion.id}: ${criterion.description}`).join(" ")} Acknowledge only volunteered learner evidence; do not probe for these as missing requirements.`,
          ]
        : []),
    ].join(" "),
    concepts: unit.criteria
      .filter(criterion => !criterion.optional)
      .map(criterion => ({
        id: criterion.id,
        description: `${taskSource}${rewriteScope}${criterion.basis}: ${criterion.description} Source basis: ${criterion.sources
          .map(id => {
            const source = MANUSCRIPT_PASSAGES[id];
            return `${source.chapter}, printed pp. ${source.printedPages.join(", ")}; ${source.establishes}`;
          })
          .join(" / ")}`,
      })),
    completionPolicy: "allow_unresolved",
    onSuccess: { kind: "node", nodeId: units[index + 1]?.unit.id ?? "recap" },
  };
}
nodes.recap = {
  id: "recap",
  presentation: {
    sceneId: "recap",
    title: "Practice recap",
    prompt: "Review the evidence from this practice conversation.",
  },
  learningObjective: "Close with the application-authored immutable question-outcome recap; no marks or pass/fail.",
  tutorBrief: "Read only the application-authored recap, once, without adding unsupported claims or another exercise.",
  assessConversationOnEntry: true,
  completeAfterTutorOutput: true,
  onSuccess: { kind: "complete" },
};

const lesson: LessonDefinition = {
  id: "mae386",
  initialNodeId: "q1",
  conversationFirst: true,
  nodes,
  recovery: {
    supportClarificationInstruction:
      "Ask one non-leading clarification of the learner's meaning. Offer a targeted hint only on request/difficulty. I don't know alone is not navigation. Preserve uncertainty and honor explicit skip/stop.",
    answerRecoveryInstruction:
      "Invite the learner's own explanation without supplying missing answers. Close a discussion that has run its course without upgrading its evidence. The application owns all transitions.",
  },
  tutor: {
    persona: "You are a respectful adult-learning discussion partner for MAE386 formative spoken practice.",
    sessionGuidance: `${Object.values(MAE386_ATTRIBUTION_RULES).join(" ")} The application owns displayed nodes, transitions and outcome claims. Private targets are not a checklist to read aloud. Do not reveal reference answers or exemplar responses before an attempt. Preserve disagreements and provisional interpretations.`,
    startInstruction: "Ask the current rendered prompt, then listen; no preview of later questions or answer key.",
    nodeInstruction:
      "Use only the rendered current prompt/subpart. Repeat the source sentence on request. Briefly acknowledge specific evidence and close when sufficient or discussion has run its course. End your turn and wait for the application to provide the next rendered node; never choose it yourself.",
  },
  classifier: {
    objectiveInstructions:
      "Assess only current-node learner evidence against the authored criteria; paraphrases and reasoned alternatives count. Tutor speech and navigation are not mastery. Keep partial, incorrect and unresolved observations distinct.",
    objectiveCriteria: {
      completed:
        "The learner demonstrates each current-node evidence criterion. Conversational closure may still advance with incomplete criteria; closure alone is not mastery.",
      incorrect:
        "A settled learner response materially contradicts a current criterion; absence or uncertain transcription is not incorrect.",
      unclear_or_incomplete: "Relevant evidence is incomplete, ambiguous or unfinished.",
      unresolved_help: "The learner asks for or still needs help which has not been resolved.",
      no_attempt: "There is no relevant learner attempt; tutor content alone does not count.",
    },
    tutorInstructions:
      "Observe the latest relevant tutor conversational act separately from learner evidence. Closure without a further question is a conversational completion signal even if criteria remain unresolved; do not award understanding from praise.",
    tutorCriteria: {
      confirmed_completion:
        "The tutor closes this subpart/discussion without a further question. This does not establish correctness or mastery.",
      clarifying: "The tutor requests clarification without supplying substantive answer content.",
      helping: "The tutor supplies substantive guidance, a cue or an answer example.",
      asking: "The tutor invites an answer to the current prompt.",
      other: "No relevant tutor act or another function.",
    },
  },
};

export const MAE386_LESSON = validateLessonDefinition(lesson);
