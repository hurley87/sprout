import type {
  AnswerOutcome,
  ConversationStateClassifierInput,
  ConversationStateProposal,
  TutorState,
} from "./conversation-state-classifier";

export const CONVERSATION_PROBABILITY_KEYS = [
  "answerCorrect",
  "answerIncorrect",
  "answerUnclear",
  "answerNone",
  "needsHelp",
  "tutorAcknowledging",
  "tutorAsking",
  "tutorClarifying",
  "tutorHelping",
] as const;
type QuestionId = (typeof CONVERSATION_PROBABILITY_KEYS)[number];
export type NormalizedConversationProbabilities = Record<QuestionId, number>;

/** Existing experimental bands, unchanged. These describe mapping, never transition authority. */
export const CONVERSATION_CLASSIFICATION_THRESHOLDS = {
  HIGH: 0.9,
  LOW: 0.1,
  COMPETITOR_CEILING: 0.2,
  MIN_MARGIN: 0.7,
} as const;
const { HIGH, LOW, COMPETITOR_CEILING, MIN_MARGIN } = CONVERSATION_CLASSIFICATION_THRESHOLDS;

export const CLASSIFICATION_ABSTENTION_REASONS = [
  "answer_no_winner",
  "answer_competitor_too_high",
  "answer_margin_too_small",
  "support_ambiguous",
  "tutor_no_winner",
  "tutor_competitor_too_high",
  "tutor_margin_too_small",
  "acknowledgment_without_correct_answer",
  "invalid_input",
  "cancelled",
  "provider_unconfigured",
  "provider_rejected",
  "provider_unreadable",
  "provider_unreachable",
] as const;
export type ClassificationAbstentionReason = (typeof CLASSIFICATION_ABSTENTION_REASONS)[number];
type MappingReason = Exclude<
  ClassificationAbstentionReason,
  | "invalid_input"
  | "cancelled"
  | "provider_unconfigured"
  | "provider_rejected"
  | "provider_unreadable"
  | "provider_unreachable"
>;
const COMPETITOR_RULES = ["COMPETITOR_CEILING", "MIN_MARGIN"] as const;
export type ClassificationMappingDetail = {
  category: "answer" | "tutor" | "support";
  candidate?: QuestionId;
  candidateProbability?: number;
  winner?: QuestionId;
  winnerProbability?: number;
  competitor?: QuestionId;
  competitorProbability?: number;
  margin?: number;
  violatedRules?: (typeof COMPETITOR_RULES)[number][];
};
export type ConversationClassificationDecision =
  | { status: "accepted"; proposal: ConversationStateProposal; probabilities: NormalizedConversationProbabilities }
  | {
      status: "abstained";
      reason: MappingReason;
      probabilities: NormalizedConversationProbabilities;
      detail?: ClassificationMappingDetail;
    }
  | { status: "abstained"; reason: Exclude<ClassificationAbstentionReason, MappingReason>; probabilities: null };

export type ConversationClassificationDiagnostic = {
  decision: "accepted" | "abstained";
  reason?: ClassificationAbstentionReason;
  probabilities: NormalizedConversationProbabilities | null;
  thresholds: typeof CONVERSATION_CLASSIFICATION_THRESHOLDS;
  detail?: ClassificationMappingDetail;
};

const answerCategories = {
  answerCorrect: "correct",
  answerIncorrect: "incorrect",
  answerUnclear: "unclear",
  answerNone: "none",
} as const satisfies Partial<Record<QuestionId, AnswerOutcome>>;
const tutorCategories = {
  tutorAcknowledging: "acknowledging",
  tutorAsking: "asking",
  tutorClarifying: "clarifying",
  tutorHelping: "helping",
} as const satisfies Partial<Record<QuestionId, TutorState>>;
type Selection<State extends string> =
  { value: State } | { reason: MappingReason; detail: ClassificationMappingDetail };

function selectCategory<State extends string>(
  probabilities: NormalizedConversationProbabilities,
  categories: Partial<Record<QuestionId, State>>,
  category: "answer" | "tutor",
): Selection<State> {
  const ids = Object.keys(categories) as QuestionId[];
  // Keep the same first qualifying winner and category order as the original mapper.
  const winner = ids.find(id => probabilities[id] >= HIGH);
  if (!winner) {
    const candidate = ids.reduce((best, id) => (probabilities[id] > probabilities[best] ? id : best));
    return {
      reason: `${category}_no_winner`,
      detail: { category, candidate, candidateProbability: probabilities[candidate] },
    };
  }
  const competitor = ids.find(
    id =>
      id !== winner &&
      (probabilities[id] > COMPETITOR_CEILING || probabilities[winner] - probabilities[id] < MIN_MARGIN),
  );
  if (competitor) {
    const margin = probabilities[winner] - probabilities[competitor];
    const violatedRules: ClassificationMappingDetail["violatedRules"] = [];
    if (probabilities[competitor] > COMPETITOR_CEILING) violatedRules.push("COMPETITOR_CEILING");
    if (margin < MIN_MARGIN) violatedRules.push("MIN_MARGIN");
    // At these bands a deficient margin also exceeds the competitor ceiling.
    // Report margin first when both fail; retain both checks without changing the verdict.
    return {
      reason: margin < MIN_MARGIN ? `${category}_margin_too_small` : `${category}_competitor_too_high`,
      detail: {
        category,
        winner,
        winnerProbability: probabilities[winner],
        competitor,
        competitorProbability: probabilities[competitor],
        margin,
        violatedRules,
      },
    };
  }
  return { value: categories[winner]! };
}

/** Explain the existing mapping. Inputs are the nine probabilities already validated by lib/jev.ts. */
export function mapConversationClassification(
  input: ConversationStateClassifierInput,
  values: NormalizedConversationProbabilities,
): ConversationClassificationDecision {
  // Explicit projection protects diagnostics even if a caller supplies extra fields.
  const probabilities = Object.fromEntries(
    CONVERSATION_PROBABILITY_KEYS.map(key => [key, values[key]]),
  ) as NormalizedConversationProbabilities;
  const answer = selectCategory(probabilities, answerCategories, "answer");
  if ("reason" in answer) return { status: "abstained", probabilities, ...answer };
  const tutor: Selection<TutorState> = Object.keys(tutorCategories).every(id => probabilities[id as QuestionId] <= LOW)
    ? { value: "unknown" }
    : selectCategory(probabilities, tutorCategories, "tutor");
  if ("reason" in tutor) return { status: "abstained", probabilities, ...tutor };
  const supportState = probabilities.needsHelp >= HIGH ? "needs_help" : probabilities.needsHelp <= LOW ? "none" : null;
  if (supportState === null)
    return {
      status: "abstained",
      reason: "support_ambiguous",
      probabilities,
      detail: { category: "support", candidate: "needsHelp", candidateProbability: probabilities.needsHelp },
    };
  if (tutor.value === "acknowledging" && answer.value !== "correct")
    return {
      status: "abstained",
      reason: "acknowledgment_without_correct_answer",
      probabilities,
      detail: { category: "tutor", winner: "tutorAcknowledging", winnerProbability: probabilities.tutorAcknowledging },
    };
  return {
    status: "accepted",
    probabilities,
    proposal: {
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: answer.value,
      supportState,
      tutorState: tutor.value,
    },
  };
}

/** Classifier response projection, never a raw provider body or a learner-evidence payload. */
export function classificationDiagnostic(
  decision: ConversationClassificationDecision,
): ConversationClassificationDiagnostic {
  return {
    decision: decision.status,
    probabilities: decision.probabilities,
    thresholds: { ...CONVERSATION_CLASSIFICATION_THRESHOLDS },
    ...(decision.status === "abstained" ? { reason: decision.reason } : {}),
    ...("detail" in decision && decision.detail ? { detail: decision.detail } : {}),
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const probability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Browser logs only this closed projection. Missing/invalid diagnostics never alter proposal handling. */
export function parseClassificationDiagnostic(value: unknown): ConversationClassificationDiagnostic | null {
  if (!record(value) || !["accepted", "abstained"].includes(value.decision as string) || !record(value.thresholds))
    return null;
  if (
    Object.entries(CONVERSATION_CLASSIFICATION_THRESHOLDS).some(
      ([key, expected]) => value.thresholds && (value.thresholds as Record<string, unknown>)[key] !== expected,
    )
  )
    return null;
  if (
    value.decision === "abstained" &&
    !CLASSIFICATION_ABSTENTION_REASONS.includes(value.reason as ClassificationAbstentionReason)
  )
    return null;
  let probabilities: NormalizedConversationProbabilities | null = null;
  if (record(value.probabilities)) {
    const entries = CONVERSATION_PROBABILITY_KEYS.map(
      key => [key, (value.probabilities as Record<string, unknown>)[key]] as const,
    );
    if (entries.some(([, amount]) => !probability(amount))) return null;
    probabilities = Object.fromEntries(entries) as NormalizedConversationProbabilities;
  } else if (value.probabilities !== null) return null;
  if (value.decision === "accepted" && !probabilities) return null;
  let detail: ClassificationMappingDetail | undefined;
  if (value.detail !== undefined) {
    if (!record(value.detail) || !["answer", "tutor", "support"].includes(value.detail.category as string)) return null;
    const raw = value.detail;
    detail = { category: raw.category as ClassificationMappingDetail["category"] };
    for (const key of ["candidate", "winner", "competitor"] as const) {
      if (raw[key] === undefined) continue;
      if (!CONVERSATION_PROBABILITY_KEYS.includes(raw[key] as QuestionId)) return null;
      detail[key] = raw[key] as QuestionId;
    }
    for (const key of ["candidateProbability", "winnerProbability", "competitorProbability"] as const) {
      if (raw[key] === undefined) continue;
      if (!probability(raw[key])) return null;
      detail[key] = raw[key];
    }
    if (raw.margin !== undefined) {
      if (typeof raw.margin !== "number" || !Number.isFinite(raw.margin) || raw.margin < -1 || raw.margin > 1)
        return null;
      detail.margin = raw.margin;
    }
    if (raw.violatedRules !== undefined) {
      if (!Array.isArray(raw.violatedRules) || raw.violatedRules.some(rule => !COMPETITOR_RULES.includes(rule)))
        return null;
      detail.violatedRules = [...raw.violatedRules];
    }
  }
  return {
    decision: value.decision as ConversationClassificationDiagnostic["decision"],
    probabilities,
    thresholds: { ...CONVERSATION_CLASSIFICATION_THRESHOLDS },
    ...(value.decision === "abstained" ? { reason: value.reason as ClassificationAbstentionReason } : {}),
    ...(detail ? { detail } : {}),
  };
}
