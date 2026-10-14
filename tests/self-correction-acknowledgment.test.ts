import { afterEach, expect, it, vi } from "vitest";
import review from "../docs/issue-57-self-correction-review-set.json";
import { JEV_MODEL } from "../lib/jev";
import {
  classificationDiagnostic,
  mapConversationClassification,
  needsConversationClarification,
} from "../lib/experiments/issue-57/legacy/classification-decision";
import {
  classifyConversationStateWithDiagnostics,
  CONVERSATION_QUESTIONS,
} from "../lib/experiments/issue-57/legacy/jev-conversation-state-classifier";
import { supportEvidence } from "../lib/lesson-runtime/support-evidence";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "./helpers/counting-runtime";
import { conversationProbabilities, conversationProviderBody } from "./fixtures/conversation-classification";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Supplied scores exercise wire projection/mapping and authority, not Jev calibration.
it.each(review.cases)("preserves evidence and completion boundaries for $id (mock provider)", async example => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const fetch = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(async () =>
    Response.json({ model: JEV_MODEL, ...conversationProviderBody(example.probabilities) }),
  );
  vi.stubGlobal("fetch", fetch);
  const input = { nodeId: "count-1-duck" as const, transcriptRevision: 13, transcript: example.transcript };
  const decision = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
  expect(fetch).toHaveBeenCalledOnce();
  const wire = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string);
  expect(wire.state).toMatchObject({
    transcript: example.transcript,
    tutorObservation: { latestMessage: example.latestMessage, precedingChildAttempt: example.precedingChildAttempt },
    supportEvidence: supportEvidence(example.transcript),
  });
  expect(wire.questions).toEqual(CONVERSATION_QUESTIONS);
  expect(needsConversationClarification(classificationDiagnostic(decision))).toBe(example.clarify);
  if (example.kind === "recorded") expect(decision).toMatchObject({ status: "abstained", reason: "tutor_no_winner" });

  let state = createLessonRuntime("self-correction");
  const send = (event: LessonRuntimeEvent) => {
    const result = reduceLessonRuntime(state, event);
    state = result.state;
    return result.effects;
  };
  send({ type: "child.turn.started", source: runtimeSource(state), atMs: 1 });
  send({ type: "transcript.updated", source: runtimeSource(state), speaker: "child", revision: 12, atMs: 2 });
  send({ type: "child.turn.ended", source: runtimeSource(state), atMs: 3 });
  send({ type: "transcript.updated", source: runtimeSource(state), speaker: "tutor", revision: 13, atMs: 4 });
  send({ type: "output.activity", source: runtimeSource(state), state: "active", atMs: 5 });
  if (decision.status === "accepted") {
    send({ type: "proposal.received", source: classificationSource(state)!, proposal: decision.proposal, atMs: 6 });
  }
  expect(state.phase).toBe("active");
  send({ type: "output.activity", source: runtimeSource(state), state: "quiet", atMs: 7 });
  const effects = send({ type: "clock.tick", source: runtimeSource(state), atMs: 300 });
  if (example.id === "settled-correction") {
    expect(effects).toMatchObject([{ type: "render.requested" }]);
    expect(state.phase).toBe("rendering");
    expect(
      send({
        type: "render.confirmed",
        runtimeId: state.runtimeId,
        identity: state.pendingRender!.identity,
        atMs: 301,
      }),
    ).toMatchObject([{ type: "steering.ready", context: { nodeId: "count-2-ducks" } }]);
  } else {
    expect(effects).toEqual([]);
    expect(state).toMatchObject({
      nodeId: "count-1-duck",
      phase: "active",
      pendingRender: null,
      lessonComplete: false,
    });
  }
});

it("states a relational confirmation contract without requiring praise or a particular phrase", () => {
  const question = CONVERSATION_QUESTIONS.tutorAcknowledging;
  expect(question.instructions).toContain("final answer the child settled on");
  expect(question.criteria.true).toContain("factual restatement");
  expect(question.criteria.true).toContain("superseded number");
  expect(question.criteria.false).toContain("correcting a still-wrong answer");
  expect(question.criteria.false).toContain("unresolved alternatives");
});

it.each([
  { answerCorrect: 0.89 },
  { answerIncorrect: 0.3 },
  { needsHelp: 0.101 },
  { needsHelp: 0.97 },
  { tutorHelping: 0.21 },
  { tutorAsking: 0.89 },
  { tutorAcknowledging: 0.1 },
  { tutorAcknowledging: 0.97, tutorHelping: 0.4 },
])("does not recover acknowledgment uncertainty with conflicting evidence %j", overrides => {
  const decision = mapConversationClassification(
    { nodeId: "count-1-duck", transcriptRevision: 13, transcript: review.cases[0].transcript },
    conversationProbabilities({ tutorAcknowledging: 0.87, ...overrides }),
  );
  expect(needsConversationClarification(classificationDiagnostic(decision))).toBe(false);
});
