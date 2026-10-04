import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import acknowledgmentReview from "../docs/issue-57-self-correction-review-set.json";
import review from "../docs/issue-57-support-temporal-review-set.json";
import {
  CONVERSATION_QUESTIONS,
  classifyConversationStateWithDiagnostics,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { isCountingNodeId } from "../lib/lesson-runtime/counting-lesson";
import { conversationProbabilities, conversationProviderBody } from "./fixtures/conversation-classification";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("preserves the support change and other questions across the later acknowledgment revision", () => {
  const {
    needsHelp: baselineSupport,
    tutorAcknowledging: baselineAcknowledgment,
    ...baselineOthers
  } = review.contracts.baselineQuestions;
  const {
    needsHelp: candidateSupport,
    tutorAcknowledging: candidateAcknowledgment,
    ...candidateOthers
  } = CONVERSATION_QUESTIONS;
  expect(candidateOthers).toEqual(baselineOthers);
  expect(candidateAcknowledgment).not.toEqual(baselineAcknowledgment);
  expect(candidateSupport.criteria).toEqual(baselineSupport.criteria);
  expect(candidateSupport.type).toBe(baselineSupport.type);
  expect(candidateSupport.instructions).not.toBe(baselineSupport.instructions);
});

it("preserves historical source provenance through the later acknowledgment revision", () => {
  const source = readFileSync("lib/lesson-runtime/jev-conversation-state-classifier.ts");
  expect(review.contracts.candidateClassifierSha256).toBe(acknowledgmentReview.contracts.baselineClassifierSha256);
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    acknowledgmentReview.contracts.candidateClassifierSha256,
  );
});

it.each(review.cases)("delivers literal $id evidence and the full question contract offline", async entry => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(conversationProviderBody()),
  );
  vi.stubGlobal("fetch", fetch);
  if (!isCountingNodeId(entry.input.nodeId)) throw new Error("Invalid reviewed node");
  await classifyConversationStateWithDiagnostics(
    { ...entry.input, nodeId: entry.input.nodeId },
    new AbortController().signal,
  );
  expect(fetch).toHaveBeenCalledOnce();
  const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
  expect(wire.model).toBe(review.contracts.model);
  expect(wire.state).toEqual(entry.expectedState);
  expect(wire.questions).toEqual(CONVERSATION_QUESTIONS);
  // Mock success scores test delivery only, never the semantic expectation in entry.review.
});

it("keeps reported support ambiguity despite high correct/acknowledgment scores, without retrying", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  // Three reported probabilities; remaining fields are synthetic controls, not export diagnostics.
  const values = conversationProbabilities({ answerCorrect: 0.96, tutorAcknowledging: 0.98, needsHelp: 0.12 });
  const fetch = vi.fn(async () => Response.json(conversationProviderBody(values)));
  vi.stubGlobal("fetch", fetch);
  const entry = review.cases[0];
  if (!isCountingNodeId(entry.input.nodeId)) throw new Error("Invalid reviewed node");
  expect(
    await classifyConversationStateWithDiagnostics(
      { ...entry.input, nodeId: entry.input.nodeId },
      new AbortController().signal,
    ),
  ).toMatchObject({ status: "abstained", reason: "support_ambiguous", probabilities: values });
  expect(fetch).toHaveBeenCalledOnce();
});

it("delivers temporal settlement guidance without allowing praise to settle unresolved child evidence", () => {
  const support = CONVERSATION_QUESTIONS.needsHelp;
  expect(support.instructions).toContain(
    "Distinguish opening hesitation from uncertainty that remains attached to the final total",
  );
  expect(support.instructions).toContain("including within one grouped child block");
  expect(support.instructions).toContain(
    "A tentative final question, continuing uncertainty, unresolved alternatives, unfinished counting or renewed help remains unresolved",
  );
  expect(support.instructions).toContain("a later tutor confirmation does not turn these into settlement");
  expect(support.instructions).toContain(
    "Tutor acknowledgment alone cannot resolve difficulty or establish a child answer",
  );
  expect(support.criteria.false).toContain("not independent mastery");
  expect(support.criteria.true).toContain(
    "A renewed help request remains current even after an earlier correct answer",
  );
});
