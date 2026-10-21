import { afterEach, expect, it, vi } from "vitest";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { REWRITE_RUBRIC } from "../lib/lesson-runtime/mae386/rewrite-rubric";
import { rewriteWords } from "../lib/lesson-runtime/mae386/rewrite-proposal";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { JEV_MODEL } from "../lib/jev";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const gradeIds = ["rewrite_meaning", "rewrite_concise", "rewrite_grammatical"];
function choice(options: readonly string[], value: string) {
  return {
    type: "choice",
    choice: value,
    confidence: 1,
    probabilities: Object.fromEntries(options.map(id => [id, Number(id === value)])),
  };
}
function setup(nodeId: string, transcript: string, text: string, state = "complete") {
  vi.stubEnv("TYPESAFE_API_KEY", "fixture-key");
  const words = rewriteWords(transcript),
    tokens = text.split(/\s+/u);
  const start = words.findLastIndex((_, index) =>
    tokens.every((token, offset) => words[index + offset]?.text === token),
  );
  const values: Record<string, string> = {
    objectiveState: "incorrect",
    tutorState: "asking",
    rewrite_state: state,
    rewrite_start: state === "complete" ? words[start].id : "none",
    rewrite_end: state === "complete" ? words[start + tokens.length - 1].id : "none",
    rewrite_assistance: "independent",
  };
  const questions = conversationStateQuestions(lesson, nodeId, transcript);
  const answers = Object.fromEntries(
    Object.entries(questions)
      .filter(([id]) => !gradeIds.includes(id))
      .map(([id, q]) => [
        id,
        choice(Object.keys(q.criteria), values[id] ?? (id.startsWith("concept_") ? "not_yet" : "none")),
      ]),
  );
  const secondAnswers = Object.fromEntries(
    gradeIds.map(id => [
      id,
      choice(Object.keys(questions[id].criteria), id === "rewrite_grammatical" ? "demonstrated" : "incorrect"),
    ]),
  );
  const requests: { state: Record<string, unknown>; questions: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({ model: JEV_MODEL, answers: requests.length === 1 ? answers : secondAnswers }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  return { requests, fetcher, answers, secondAnswers, input: { lesson, nodeId, transcriptRevision: 7, transcript } };
}

it.each(REWRITE_RUBRIC.units)("assesses only the current $id selected words in the second Jev request", async unit => {
  const good = unit.examples.find(example => example.name.endsWith("-complete"))!.turns[0].text;
  const bad = unit.examples.find(example => example.name.endsWith("-meaning-changed"))!.turns[0].text;
  const transcript = `Child: ${good}\nChild: Actually replace that with: ${bad}\nChild: This reminds me of an email.`;
  const t = setup(unit.id, transcript, bad);
  const result = await classifyConversationStateWithDiagnostics(t.input, new AbortController().signal);
  expect(t.requests).toHaveLength(2);
  expect(t.requests[0].state).toHaveProperty("transcript", transcript);
  expect(Object.keys(t.requests[0].questions).some(id => gradeIds.includes(id))).toBe(false);
  expect(t.requests[1].state).toEqual({
    nodeId: unit.id,
    transcriptRevision: 7,
    originalSentence: unit.visibleSource,
    proposedRewrite: bad,
  });
  expect(JSON.stringify(t.requests[1].state)).not.toContain(good);
  expect(Object.keys(t.requests[1].questions)).toEqual(gradeIds);
  expect(result.proposal?.currentRewrite).toMatchObject({
    state: "complete",
    criteria: { meaning: "incorrect", concise: "incorrect", grammatical: "demonstrated" },
  });
});
// Authored alternative spans and judgments are mocked: this verifies actual
// two-stage request isolation/mapping, not semantic selection by a live Jev.
it.each(
  REWRITE_RUBRIC.units.flatMap(unit =>
    ["alternate", "modest-valid-reduction"].map(suffix => ({
      unit,
      sample: unit.examples.find(example => example.name === `${unit.id}-${suffix}`)!,
    })),
  ),
)("maps $sample.name without assessing the prior poorer proposal or tutor source", async ({ unit, sample }) => {
  const prior = unit.examples.find(example => example.name.endsWith("-meaning-changed"))!.turns[0].text;
  const text = sample.turns[0].text;
  const transcript = `Tutor: ${unit.visibleSource}\nChild: ${prior}\nChild: No, my revision is: ${text}`;
  const t = setup(unit.id, transcript, text);
  for (const id of gradeIds)
    t.secondAnswers[id] = choice(Object.keys(t.secondAnswers[id].probabilities), "demonstrated");
  const result = await classifyConversationStateWithDiagnostics(t.input, new AbortController().signal);
  expect(t.requests).toHaveLength(2);
  expect(t.requests[1].state).toEqual({
    nodeId: unit.id,
    transcriptRevision: 7,
    originalSentence: unit.visibleSource,
    proposedRewrite: text,
  });
  expect(result.rewriteAssessment).toBe("complete");
  expect(result.proposal?.currentRewrite).toMatchObject({
    state: "complete",
    assistance: "independent",
    criteria: { meaning: "demonstrated", concise: "demonstrated", grammatical: "demonstrated" },
  });
});
it.each(["withdrawn", "none", "unresolved"])("makes no assessment request for %s", async state => {
  const t = setup("q10-1", "Child: I withdraw that.", "I withdraw that.", state);
  const result = await classifyConversationStateWithDiagnostics(t.input, new AbortController().signal);
  expect(t.requests).toHaveLength(1);
  expect(result.proposal?.currentRewrite?.state).toBe(state);
  expect(result.proposal?.currentRewrite?.criteria.meaning).toBe("unresolved");
});
it.each(REWRITE_RUBRIC.units)(
  "does not assess unchanged $id source even if the locator calls it a complete proposal",
  async unit => {
    const original = unit.visibleSource!;
    const t = setup(unit.id, `Child: ${original}`, original);
    await classifyConversationStateWithDiagnostics(t.input, new AbortController().signal);
    expect(t.requests).toHaveLength(1);
  },
);
it.each(["failure", "model", "schema", "network", "cancelled"])(
  "keeps closure independent of second-stage %s without retry or fallback credit",
  async failure => {
    const t = setup("q10-1", "Child: He overslept because he was late.", "He overslept because he was late.");
    t.answers.tutorState = choice(Object.keys(t.answers.tutorState.probabilities), "confirmed_completion");
    const controller = new AbortController();
    t.fetcher
      .mockImplementationOnce(async (_url, init) => {
        t.requests.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ model: JEV_MODEL, answers: t.answers }) };
      })
      .mockImplementationOnce(async (_url, init) => {
        t.requests.push(JSON.parse(init.body));
        if (failure === "cancelled") controller.abort();
        if (failure === "network") throw new Error("fixture network failure");
        return {
          ok: failure !== "failure",
          json: async () => ({
            model: failure === "model" ? "other-model" : JEV_MODEL,
            answers:
              failure === "schema" ? { ...t.secondAnswers, rewrite_start: t.answers.rewrite_start } : t.secondAnswers,
          }),
        };
      });
    const result = await classifyConversationStateWithDiagnostics(t.input, controller.signal);
    if (failure === "cancelled") {
      expect(result.status).toBe("abstained");
      expect(result.proposal).toBeNull();
    } else {
      expect(result.status).toBe("accepted");
      expect(result.rewriteAssessment).toBe("unavailable");
      expect(result.outcome).toBe("allow_semantic_completion_evidence");
      expect(result.proposal?.tutorState).toBe("acknowledging");
      expect(result.proposal?.currentRewrite?.criteria).toEqual({
        meaning: "unresolved",
        concise: "unresolved",
        grammatical: "unresolved",
      });
    }
    expect(t.requests).toHaveLength(2);
  },
);
it("cancels between selection and assessment", async () => {
  const t = setup("q10-1", "Child: He was late because he overslept.", "He was late because he overslept.");
  const controller = new AbortController();
  t.fetcher.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => {
      controller.abort();
      return { model: JEV_MODEL, answers: t.answers };
    },
  }));
  const result = await classifyConversationStateWithDiagnostics(t.input, controller.signal);
  expect(result.reason).toBe("cancelled");
  expect(t.fetcher).toHaveBeenCalledTimes(1);
});
