import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { neutralLearnerSourceBlock, learnerSourceBlocks } from "../lib/lesson-runtime/mae386/source-block";
import {
  conversationStateQuestions,
  normalizeConversationOutputs,
  mapConversationObservation,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  CLASSIFIER_VERSION,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { createReducerHarness } from "./helpers/runtime-harness";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { JEV_MODEL } from "../lib/jev";

const captured = JSON.parse(
  readFileSync(new URL("../docs/evidence/mae386-live-2026-10-21-c7d94b28.json", import.meta.url), "utf8"),
);
const transcript: string = captured.conversation.find((visit: { nodeId: string }) => visit.nodeId === "q6").transcript;
const recorded = captured.events.find((event: { sourceEventIndex: number }) => event.sourceEventIndex === 2118).detail
  .outputs;
const input = { lesson, nodeId: "q6", transcriptRevision: 207, transcript };
function choice(options: readonly string[], selected: string, probability = 1) {
  return {
    type: "choice",
    choice: selected,
    confidence: probability,
    probabilities: Object.fromEntries(
      options.map(id => [id, id === selected ? probability : (1 - probability) / (options.length - 1)]),
    ),
  };
}
function bodyFor(text = transcript, concept = "demonstrated_independent", probability = 1) {
  const questions = conversationStateQuestions(lesson, "q6", text);
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, q]) => {
        if (
          (id === "objectiveState" || id === "tutorState" || id.startsWith("concept_")) &&
          text === transcript &&
          concept === "demonstrated_independent"
        )
          return [id, { type: "choice", ...(id.startsWith("concept_") ? recorded.concepts[id] : recorded[id]) }];
        const selected =
          id === "objectiveState"
            ? "completed"
            : id === "tutorState"
              ? "confirmed_completion"
              : id.startsWith("concept_")
                ? concept
                : Object.keys(q.criteria).find(key => key !== "none")!;
        return [id, choice(Object.keys(q.criteria), selected, id.startsWith("sourceSpan_") ? probability : 1)];
      }),
    ),
  };
}
function apply(text: string, proposal: NonNullable<ReturnType<typeof mapConversationObservation>["proposal"]>) {
  const h = createReducerHarness("source-block", { lesson: { ...lesson, initialNodeId: "q6" } });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: 207,
    transcriptSnapshot: text,
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  h.send({ type: "proposal.received", source: classificationSource(h.state)!, proposal, transcriptSnapshot: text });
  return h.state;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("captured Q6 becomes one source candidate while retaining raw indexes and tutor context", () => {
  const block = neutralLearnerSourceBlock(transcript)!;
  expect(block).toMatchObject({ id: "span_3_7", start: 3, end: 7 });
  expect(block.messages.map(message => message.messageIndex)).toEqual([3, 4, 5, 6, 7]);
  expect(block.messages.filter(message => message.speaker === "Tutor").map(message => message.text)).toEqual([
    "Yes.",
    "Hmm.",
  ]);
  const questions = conversationStateQuestions(lesson, "q6", transcript);
  expect(questions).toHaveProperty("sourceSpan_system1-example");
  expect(questions).not.toHaveProperty("source_system1-example");
  expect(questions).not.toHaveProperty("sourceEnd_system1-example");
  expect(Object.keys(questions["sourceSpan_system1-example"].criteria)).toEqual(["none", "span_3_7"]);
});

it("preserves recorded Q6 semantic scores; a MOCKED confident block locator records complete independent provenance", async () => {
  const body = bodyFor(); // The new locator is synthetic. Recorded concept judgments are unchanged.
  vi.stubEnv("TYPESAFE_API_KEY", "fixture-only");
  const fetcher = vi.fn(async () => Response.json(body));
  vi.stubGlobal("fetch", fetcher);
  const result = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(result.outputs?.concepts).toEqual(recorded.concepts);
  expect(result.proposal?.conceptObservations).toHaveLength(4);
  for (const observation of result.proposal!.conceptObservations!)
    expect(observation).toMatchObject({
      observation: "demonstrated_independent",
      childMessageIndex: 3,
      childMessageEndIndex: 7,
    });
  const state = apply(transcript, result.proposal!);
  for (const evidence of Object.values(state.conceptEvidence)) {
    expect(evidence.status).toBe("demonstrated");
    expect(evidence.understanding).toBe("independent");
    expect(evidence.source).toMatchObject({
      childMessageIndex: 3,
      childMessageEndIndex: 7,
      childTurnId: null,
      transcriptRevision: 207,
    });
    expect(evidence.source?.messages?.map(message => message.messageIndex)).toEqual([3, 4, 5, 6, 7]);
  }
  expect(
    parseLiveClassificationDiagnostic(
      {
        classifierVersion: CLASSIFIER_VERSION,
        decision: result.status,
        outcome: result.outcome,
        outputs: result.outputs,
        labelCompletionEligible: result.labelCompletionEligible,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId: "q6",
        transcriptRevision: 207,
        elapsedMs: 1,
      },
      lesson,
      "q6",
      transcript,
    ),
  ).toBeTruthy();
});

it("historical start/end diagnostics retain their original uncertain mapping", () => {
  const result = mapConversationObservation(input, recorded);
  const system1 = result.proposal!.conceptObservations!.filter(o => o.criterionId.startsWith("system1"));
  expect(system1).toHaveLength(2);
  expect(system1.every(o => o.childMessageIndex === null)).toBe(true);
  expect(apply(transcript, result.proposal!).conceptEvidence["q6:system1-example"]).toBeUndefined();
});

it.each([
  "Here is a hint.",
  "Yes, the answer is automatic thinking.",
  "What do you mean?",
  "Hmm, think about deliberate checking.",
])("substantive tutor context separates source candidates: %s", tutor => {
  const text = `Child: Fast thinking is\nTutor: ${tutor}\nChild: an automatic reaction.`;
  expect(neutralLearnerSourceBlock(text)).toBeNull();
  expect(learnerSourceBlocks(text).map(block => [block.start, block.end])).toEqual([
    [0, 0],
    [2, 2],
  ]);
  expect(
    Object.keys(conversationStateQuestions(lesson, "q6", text)["sourceSpan_system1-description"].criteria),
  ).toEqual(["none", "span_0_0", "span_2_2"]);
});

it("does not enable block selection for other lessons or Q10", () => {
  const text = "Child: The first part\nTutor: Yes.\nChild: and the rest.";
  const other = { ...CATCHING_UNICORNS_LESSON, nodes: lesson.nodes };
  for (const questions of [
    conversationStateQuestions(other, "q6", text),
    conversationStateQuestions(lesson, "q10-1", text),
  ])
    expect(Object.keys(questions).some(id => id.startsWith("sourceSpan_"))).toBe(false);
});

it("uncertain source choice cannot gain credit from a strong concept judgment", () => {
  const outputs = normalizeConversationOutputs(
    bodyFor(transcript, "demonstrated_independent", 0.8),
    lesson,
    "q6",
    transcript,
  )!;
  const result = mapConversationObservation(input, outputs);
  expect(result.proposal!.conceptObservations!.every(o => o.childMessageIndex === null)).toBe(true);
  expect(apply(transcript, result.proposal!).conceptEvidence).toEqual({});
});

it("confident grouping cannot upgrade uncertain semantic sufficiency", () => {
  const body = bodyFor();
  for (const [id, value] of Object.entries(body.answers))
    if (id.startsWith("concept_")) {
      Object.assign(value, choice(Object.keys(value.probabilities), "demonstrated_prompted", 0.79));
    }
  const result = mapConversationObservation(input, normalizeConversationOutputs(body, lesson, "q6", transcript)!);
  expect(result.proposal?.conceptObservations ?? []).toEqual([]);
});

it("a distinct or competing answer block may be rejected without credit despite confident semantic labels", () => {
  const text = "Child: System one is deliberate.\nTutor: Okay.\nChild: This is a different answer about the weather.";
  const body = bodyFor(text);
  for (const [id, value] of Object.entries(body.answers))
    if (id.startsWith("sourceSpan_")) Object.assign(value, choice(Object.keys(value.probabilities), "none"));
  const result = mapConversationObservation(
    { ...input, transcript: text },
    normalizeConversationOutputs(body, lesson, "q6", text)!,
  );
  expect(apply(text, result.proposal!).conceptEvidence).toEqual({});
});

it("copied tutor words across neutral backchannels are still rejected as independent demonstration", () => {
  const text =
    "Tutor: Fast thinking is automatic. It can produce an immediate reaction.\nChild: Fast thinking is automatic.\nTutor: Hmm.\nChild: It can produce an immediate reaction.";
  const result = mapConversationObservation(
    { ...input, transcript: text },
    normalizeConversationOutputs(bodyFor(text), lesson, "q6", text)!,
  );
  const state = apply(text, result.proposal!);
  expect(Object.values(state.conceptEvidence).every(e => e.status === "partial" && e.understanding === null)).toBe(
    true,
  );
});

it("prompted semantic judgments retain assisted provenance in a neutral block", () => {
  const text =
    "Tutor: Quick thinking can be automatic, like an immediate reaction.\nChild: I might react to being cut off\nTutor: Hmm.\nChild: before reasoning about the safest response.";
  const result = mapConversationObservation(
    { ...input, transcript: text },
    normalizeConversationOutputs(bodyFor(text, "demonstrated_prompted"), lesson, "q6", text)!,
  );
  expect(Object.values(apply(text, result.proposal!).conceptEvidence).every(e => e.understanding === "prompted")).toBe(
    true,
  );
});

it("rejects forged, mixed or unbound span schemas rather than accepting provider-chosen ranges", () => {
  const good = bodyFor();
  const forged = structuredClone(good);
  forged.answers["sourceSpan_system1-description"] = choice(["none", "span_1_9"], "span_1_9");
  expect(normalizeConversationOutputs(forged, lesson, "q6", transcript)).toBeNull();
  const mixed = structuredClone(good);
  mixed.answers["source_system1-description"] = choice(["none", "message_3"], "message_3");
  expect(normalizeConversationOutputs(mixed, lesson, "q6", transcript)).toBeNull();
  expect(normalizeConversationOutputs(good, lesson, "q6")).toBeNull();
  expect(normalizeConversationOutputs(good, CATCHING_UNICORNS_LESSON, "q6", transcript)).toBeNull();
});

it("the paid boundary rejects a legacy-schema response to a fresh block request", async () => {
  const answers = {
    objectiveState: { type: "choice", ...recorded.objectiveState },
    tutorState: { type: "choice", ...recorded.tutorState },
    ...Object.fromEntries(
      Object.entries({ ...recorded.concepts, ...recorded.sources }).map(([k, v]) => [
        k,
        { type: "choice", ...(v as object) },
      ]),
    ),
  };
  vi.stubEnv("TYPESAFE_API_KEY", "fixture-only");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ model: JEV_MODEL, answers })),
  );
  expect(await classifyConversationStateWithDiagnostics(input, new AbortController().signal)).toMatchObject({
    status: "abstained",
    reason: "provider_unreadable",
    proposal: null,
  });
});
