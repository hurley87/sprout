import type { CurrentNodeSteeringContext } from "../lesson-runtime-reducer";
import { MAE386_RUBRICS } from "./rubrics";

// Topic anchors guide the tutor, not grading. Full criteria/provenance stay in
// the rubric and classifier; never read these anchors as an answer checklist.
const focus: Readonly<Record<string, string>> = {
  q1: "Reification makes visible abstract representations manipulable. External records extend limited memory, preserving intermediate steps for extended reasoning. Accept paraphrases.",
  q6: "Quick/automatic versus deliberate, effortful thinking, with the learner's own plausible example of each. Neither process guarantees error or correctness.",
  q8: "Speech sounds versus pictures/concepts; combining sounds decodes unfamiliar written words already known in speech. No universal mature-reader speed claim.",
  q10: "Only the latest complete non-withdrawn learner rewrite of this original matters: preserved meaning, actual redundancy reduction, grammatical spoken sentence. Never borrow credit from earlier proposals, original echoes or tutor wording.",
  q5: "Discovery/development must require exographics; current technology use alone is insufficient. Accept justified historical uncertainty. Case-specific judgments are provisional, not canonical book verdicts.",
  q12: "Apply all four: widespread literacy/arithmetic; specialists advancing ideas; norms/rules coordinating strangers; education/training transmitting knowledge. Accept qualified yes/no and dependence on wider society. Never invent CAF facts.",
  q14: "Two distinct reasoned arguments for the assigned position that current achievement does not demonstrate full potential. Personal agreement is not required; avoid innate-deficiency claims.",
  q15: "One developed argument for science's usefulness despite incomplete ultimate explanation suffices. Evidence, testing and limits are optional strengths, not another required argument.",
};

/** Spoken tutoring needs current task context, not the classifier's full rubric,
 * repeated source citations or reference answers. Keep those in the lesson/export. */
export function mae386TeachingInstruction(context: CurrentNodeSteeringContext) {
  const question = MAE386_RUBRICS.find(question => question.units.some(unit => unit.id === context.nodeId));
  const unit = question?.units.find(unit => unit.id === context.nodeId);
  if (!unit || !question) throw new Error("Unknown MAE386 spoken task");
  return [
    `Application screen confirmation: ${context.nodeId} is now rendered.`,
    `Prompt: ${context.scene.prompt}`,
    ...(unit.visibleSource ? [`Quoted source, never learner evidence: ${JSON.stringify(unit.visibleSource)}`] : []),
    `Private focus (never read aloud): ${focus[question.id]}`,
    `Optional probe: ${unit.tutor.probe}`,
    `Help only on request/difficulty: ${unit.tutor.help}`,
    `Avoid: ${unit.tutor.avoid}`,
    `Close: ${unit.tutor.close}`,
    ...(unit.criteria.some(criterion => criterion.optional)
      ? ["Optional strengths are never required for a complete answer; do not probe for them as missing requirements."]
      : []),
    "Ask the displayed prompt aloud now, introducing any quoted source exactly; then listen. Keep assessment targets private. Closure is not mastery. Honor skip/stop; only the application changes the question.",
  ].join("\n");
}
