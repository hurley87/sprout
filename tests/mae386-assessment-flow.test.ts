import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/classify/route";
import { JEV_MODEL } from "../lib/jev";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import type { EvidenceLabel } from "../lib/lesson-runtime/mae386/rubric-types";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { createReducerHarness } from "./helpers/runtime-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Explicit expected *application* outcomes. The semantic judgments below come
// from existing authored examples, not a local grader or measured Jev behavior.
const scenarios = [
  ["q1", "tokens-and-scratchpad", "independent"],
  ["q1", "help-then-application", "partial"],
  ["q6", "definitions-no-examples", "partial"],
  ["q6", "same-domain-two-processes", "independent"],
  ["q8", "sound-based-decoding", "independent"],
  ["q8", "letters-not-pictures", "partial"],
  ["q8", "sounds-but-no-advantage", "partial"],
  ["q8", "separate-word-picture", "incorrect"],
  ["q8", "vague-speed", "unresolved"],
  ["q8", "new-written-known-spoken", "independent"],
  ["q5-a", "model-qualified-uncertainty", "independent"],
  ["q5-a", "model-digital-test", "incorrect"],
  ["q5-c", "rhyme-unknown-origin", "independent"],
  ["q5-c", "rhyme-print-equals-membership", "incorrect"],
  ["q5-f", "spindle-historical-gap", "independent"],
  ["q5-f", "spindle-bare-age", "partial"],
  ["q12", "caf-one-helped-dimension", "assisted"],
  ["q14", "innovation-and-opportunity", "independent"],
  ["q14", "evolution-and-test-conventions", "independent"],
  ["q14", "only-one-argument", "partial"],
  ["q14", "two-examples-one-reason", "partial"],
  ["q14", "literacy-is-intelligence", "incorrect"],
  ["q15", "predictive-utility-without-limits", "independent"],
  ["q15", "practical-mri-argument", "independent"],
  ["q15", "qualified-critique", "independent"],
  ["q15", "model-improvement", "independent"],
  ["q15", "belief-alone", "unresolved"],
] as const;
const observation: Record<EvidenceLabel, string> = {
  independent: "demonstrated_independent",
  assisted: "demonstrated_prompted",
  partial: "partial",
  incorrect: "not_yet", // Wrong objective, not absence, carries incorrectness.
  unresolved: "partial",
  missing: "not_yet",
};

it("rejects tutor-owned Q14 argument locators despite overconfident independent judgments", async () => {
  const sample = MAE386_RUBRICS.find(q => q.id === "q14")!.units[0].examples.find(
    e => e.name === "tutor-reasons-only",
  )!;
  const transcript = sample.turns.map(t => `${t.speaker === "learner" ? "Child" : "Tutor"}: ${t.text}`).join("\n");
  const questions = conversationStateQuestions(lesson, "q14", transcript);
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      const selected =
        id === "objectiveState"
          ? "completed"
          : id === "tutorState"
            ? "confirmed_completion"
            : id.startsWith("concept_")
              ? "demonstrated_independent"
              : "message_0";
      return [
        id,
        {
          type: "choice",
          choice: selected,
          confidence: 1,
          probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === selected)])),
        },
      ];
    }),
  );
  vi.stubEnv("TYPESAFE_API_KEY", "authored-fixture-only");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ model: JEV_MODEL, answers })),
  );
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/classify", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ lessonId: lesson.id, nodeId: "q14", transcriptRevision: 2, transcript }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    proposal: null,
    diagnostic: { decision: "abstained", reason: "provider_unreadable" },
  });
});

it.each(scenarios)(
  "maps authored %s / %s through the route into %s with learner provenance",
  async (nodeId, name, outcome) => {
    const unit = MAE386_RUBRICS.flatMap(q => q.units).find(u => u.id === nodeId)!;
    const sample = unit.examples.find(e => e.name === name)!;
    expect(sample, `Missing authored example ${name}`).toBeDefined();
    const h = createReducerHarness("authored-flow", { lesson: { ...lesson, initialNodeId: nodeId } });
    const lines: string[] = [];
    const turnIds = new Map<number, number>();
    for (const [index, turn] of sample.turns.entries()) {
      const child = turn.speaker === "learner";
      if (child) h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
      lines.push(`${child ? "Child" : "Tutor"}: ${turn.text}`);
      h.send({
        type: "transcript.updated",
        source: runtimeSource(h.state),
        speaker: child ? "child" : "tutor",
        revision: h.state.transcriptRevision + 1,
        transcriptSnapshot: lines.join("\n"),
        ...(child ? { learnerTurnText: turn.text } : {}),
      });
      if (child) {
        turnIds.set(index, h.state.childTurnId);
        h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
      }
    }
    const transcript = lines.join("\n");
    const questions = conversationStateQuestions(lesson, nodeId, transcript);
    const answers = Object.fromEntries(
      Object.entries(questions).map(([id, question]) => {
        const criterionId = id.slice(id.indexOf("_") + 1);
        const label = sample.expected[criterionId];
        const evidenceTurn = label === "assisted" ? sample.evidenceTurns.at(-1)! : sample.evidenceTurns[0];
        const selected =
          id === "objectiveState"
            ? sample.category === "incorrect"
              ? "incorrect"
              : "unclear_or_incomplete"
            : id === "tutorState"
              ? "asking"
              : id === "discussionClosure"
                ? "open"
                : id.startsWith("concept_")
                  ? observation[label]
                  : `message_${evidenceTurn - 1}`;
        // Ambiguous authored meaning is a low-confidence partial, never a fabricated error.
        const uncertain = id.startsWith("concept_") && label === "unresolved";
        return [
          id,
          {
            type: "choice",
            choice: selected,
            confidence: uncertain ? 0.6 : 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map(key => [
                key,
                uncertain ? (key === "partial" ? 0.6 : key === "not_yet" ? 0.4 : 0) : Number(key === selected),
              ]),
            ),
          },
        ];
      }),
    );
    vi.stubEnv("TYPESAFE_API_KEY", "authored-fixture-only");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ model: JEV_MODEL, answers }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/classify", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          nodeId,
          transcriptRevision: h.state.transcriptRevision,
          transcript,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.diagnostic.decision).toBe("accepted");
    expect(fetcher).toHaveBeenCalledOnce();
    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(request.state.transcript).toBe(transcript);
    for (const criterion of unit.criteria.filter(c => !c.optional)) {
      expect(request.questions[`concept_${criterion.id}`].instructions).toContain(criterion.description);
    }
    const source = classificationSource(h.state)!;
    h.send({ type: "proposal.received", source, proposal: result.proposal, transcriptSnapshot: transcript });
    h.send({ type: "stop", runtimeId: h.state.runtimeId });
    const component = h.state.questionOutcomes!.questions.flatMap(q => q.components).find(c => c.nodeId === nodeId)!;
    expect(component.outcome).toBe(outcome);
    for (const criterion of component.criteria) {
      const label = sample.expected[criterion.id];
      if (label === "missing" || label === "incorrect") {
        expect(criterion.evidence?.source ?? null).toBeNull();
        continue;
      }
      const index = (label === "assisted" ? sample.evidenceTurns.at(-1)! : sample.evidenceTurns[0]) - 1;
      expect(criterion.evidence?.source).toMatchObject({
        runtimeId: "authored-flow",
        nodeId,
        visitId: 1,
        childMessageIndex: index,
        // Earlier speech first classified in this later snapshot has no invented turn identity.
        childTurnId: index === sample.turns.length - 1 ? turnIds.get(index) : null,
        childTranscript: sample.turns[index].text,
        transcriptRevision: source.transcriptRevision,
      });
      if (label === "independent" || label === "assisted") {
        expect(criterion.evidence).toMatchObject({
          status: "demonstrated",
          understanding: label === "assisted" ? "prompted" : "independent",
        });
      }
    }
    expect(component.optionalDimensions.every(d => d.assessed === false)).toBe(true);
  },
);
