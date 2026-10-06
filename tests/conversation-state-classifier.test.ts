import { afterEach, expect, it, vi } from "vitest";
import {
  classifyConversationStateWithDiagnostics,
  conversationObserverState,
  CLASSIFIER_VERSION,
  type ObjectiveState,
  type ObservedTutorState,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { CONVERSATION_STATE_QUESTIONS } from "../lib/experiments/issue-57/counting-classifier-contract";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { JEV_MODEL } from "../lib/jev";
const distribution = (options: Record<string, string>, choice: string, p = 0.96) => ({
  type: "choice",
  choice,
  confidence: p,
  probabilities: Object.fromEntries(
    Object.keys(options).map(k => [k, k === choice ? p : (1 - p) / (Object.keys(options).length - 1)]),
  ),
});
function body(objective: ObjectiveState = "completed", tutor: ObservedTutorState = "confirmed_completion", p = 0.96) {
  return {
    model: JEV_MODEL,
    answers: {
      objectiveState: distribution(CONVERSATION_STATE_QUESTIONS.objectiveState.criteria, objective, p),
      tutorState: distribution(CONVERSATION_STATE_QUESTIONS.tutorState.criteria, tutor, p),
    },
  };
}
const input = {
  lesson: COUNTING_LESSON,
  nodeId: "count-2-ducks" as const,
  transcriptRevision: 4,
  transcript: "Child: Two\nTutor: Yes, two ducks.",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
// Supplied judgments verify transport and deterministic mapping, not live semantic accuracy.
it.each([
  ["normal", "Child: Two\nTutor: Yes, two ducks.", "completed", "confirmed_completion", true],
  ["self-correction", "Child: Three. Uh, I mean two\nTutor: Yes, two ducks", "completed", "confirmed_completion", true],
  ["fragmented confirmation", "Child: Two\nTutor: Yes\nTutor: two ducks", "completed", "confirmed_completion", true],
  ["wrong", "Child: Three\nTutor: Try again", "incorrect", "clarifying", false],
  ["incomplete", "Child: I think...\nTutor: Take your time", "unclear_or_incomplete", "other", false],
  ["help", "Child: Help me\nTutor: Point to each duck", "unresolved_help", "helping", false],
  ["tutor supplies answer", "Tutor: Two ducks", "no_attempt", "other", false],
  ["generic praise", "Child: Two\nTutor: Nice effort", "completed", "other", false],
] as const)(
  "maps supplied %s judgments using full context only",
  async (_name, transcript, objective, tutor, complete) => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(body(objective, tutor)));
    vi.stubGlobal("fetch", fetch);
    const snapshot = { ...input, transcript };
    const result = await classifyConversationStateWithDiagnostics(snapshot, new AbortController().signal);
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(request).toEqual({
      model: JEV_MODEL,
      state: conversationObserverState(snapshot),
      questions: CONVERSATION_STATE_QUESTIONS,
    });
    expect(Object.keys(request.state)).toEqual([
      "nodeId",
      "scene",
      "learningObjective",
      "transcript",
      "transcriptRevision",
    ]);
    expect(result.status).toBe("accepted");
    expect(result.proposal !== null).toBe(complete);
    if (complete)
      expect(result.proposal).toMatchObject({
        nodeId: input.nodeId,
        transcriptRevision: 4,
        answerOutcome: "correct",
        tutorState: "acknowledging",
      });
    expect(CLASSIFIER_VERSION).toBe("conversation-state-v2");
  },
);
it.each([
  ["invalid", { model: JEV_MODEL, answers: {} }, "provider_unreadable"],
  ["low confidence", body("completed", "confirmed_completion", 0.6), "objectiveState_no_winner"],
  ["competing distribution", body("completed", "confirmed_completion", 0.5), "objectiveState_no_winner"],
  ["wrong model", { ...body(), model: "untrusted" }, "provider_model_mismatch"],
] as const)("fails closed for %s", async (_name, raw, reason) => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn(async () => Response.json(raw));
  vi.stubGlobal("fetch", fetch);
  expect(await classifyConversationStateWithDiagnostics(input, new AbortController().signal)).toMatchObject({
    status: "abstained",
    proposal: null,
    reason,
  });
  expect(fetch).toHaveBeenCalledOnce();
});
it("cancels before a request and after delayed provider completion", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  let finish!: (value: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const abort = new AbortController();
  abort.abort();
  expect(await classifyConversationStateWithDiagnostics(input, abort.signal)).toMatchObject({
    reason: "cancelled",
    proposal: null,
  });
  expect(fetch).not.toHaveBeenCalled();
  const active = new AbortController();
  const pending = classifyConversationStateWithDiagnostics(input, active.signal);
  active.abort();
  finish(Response.json(body()));
  expect(await pending).toMatchObject({ reason: "cancelled", proposal: null });
  expect(fetch).toHaveBeenCalledOnce();
});
