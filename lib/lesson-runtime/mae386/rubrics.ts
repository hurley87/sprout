import { CONCEPT_RUBRICS } from "./concept-rubrics";
import { REWRITE_RUBRIC } from "./rewrite-rubric";
import { CASE_RUBRIC } from "./case-rubric";
import { ARGUMENT_RUBRICS } from "./argument-rubrics";
import type { QuestionRubric } from "./rubric-types";

/** All exemplars are authored synthetic learner responses, not manuscript quotes.
 * Expected labels are human-review contracts, not recorded Jev results.
 */
export const MAE386_RUBRICS: readonly QuestionRubric[] = [
  ...CONCEPT_RUBRICS,
  REWRITE_RUBRIC,
  CASE_RUBRIC,
  ...ARGUMENT_RUBRICS,
];

export const MAE386_ATTRIBUTION_RULES = {
  independent:
    "Use the student's own relevant turn(s). Neutral requests to explain, clarify or repeat the printed source are not answer-giving. Later praise cannot retroactively supply or prompt earlier evidence.",
  assisted:
    "A substantive tutor cue/explanation precedes the selected learner evidence and contributes to it. Require the learner's own explanation/application beyond a simple echo; attribute only affected criteria, not every criterion in the question.",
  partial:
    "Relevant but incomplete evidence. Keep criterion-level coverage; never fill missing propositions from tutor words or exemplar similarity.",
  incorrect:
    "An explicit learner claim conflicts with the criterion. Missing evidence, unavailable classification and ambiguous ASR are not incorrect. Current observer concept labels do not independently encode incorrect; implementing outcome projection must retain validated objective/attempt evidence.",
  unresolved:
    "Preserve uncertainty about meaning, attribution, ASR, source interpretation or unavailable assessment. Do not award mastery or manufacture an error. Reasoned Q5 historical uncertainty can coexist with complete application-of-test evidence.",
  skipped:
    "An explicit navigation action leaves unresolved/unattempted criteria or subparts behind. Preserve any prior evidence and the skip event separately; a skip does not erase demonstrated or partial work.",
  unattempted:
    "No substantive learner attempt exists for the question/subpart; distinguish never reached from reached then explicitly skipped using authored visit/navigation history.",
  selfCorrection:
    "Retain ordered learner turns and source revisions. Correction before substantive tutor answer-giving may remain independent. After a relevant hint, record assisted correction. Q10 uses the latest complete non-withdrawn proposal, not cumulative best evidence; other concepts keep cumulative evidence.",
  provenance:
    "Examples use one-based turn positions; runtime evidence must additionally keep actual runtime/node/visit/turn identity, transcript revision and exact selected learner text/span. Tutor turns are context only. Never use praise, source quotations, answer-key text or assent as student-authored explanation.",
  closure:
    "Coverage and closure are separate. A useful probe/help exchange may end with partial or incorrect evidence. Explicit next/skip follows authored navigation; I don't know alone is not navigation. Stop immediately releases media. No numeric marks or pass/fail.",
} as const;
