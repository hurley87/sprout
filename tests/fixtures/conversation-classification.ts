import type { NormalizedConversationProbabilities } from "../../lib/experiments/issue-57/legacy/classification-decision";

export const conversationProbabilities = (
  overrides: Partial<NormalizedConversationProbabilities> = {},
): NormalizedConversationProbabilities => ({
  answerCorrect: 0.98,
  answerIncorrect: 0.01,
  answerUnclear: 0.01,
  answerNone: 0.01,
  needsHelp: 0.01,
  tutorAcknowledging: 0.97,
  tutorAsking: 0.01,
  tutorClarifying: 0.01,
  tutorHelping: 0.01,
  ...overrides,
});

export const conversationProviderBody = (values = conversationProbabilities()) => ({
  answers: Object.fromEntries(Object.entries(values).map(([key, noul]) => [key, { type: "noul", noul }])),
});
