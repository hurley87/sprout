import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { JEV_MODEL } from "../lib/jev";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  conversationObserverState,
  conversationStateQuestions,
  learnerSourceOptions,
  mapConversationObservation,
  normalizeConversationOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { ProposedConceptObservation } from "../lib/lesson-runtime/conversation-state-classifier";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";
import trace from "./fixtures/catching-unicorns-attribution-oct17.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
const definition = { ...lesson, initialNodeId: "exographics" };
const input = (transcript: string, transcriptRevision = 1) => ({
  lesson,
  nodeId: "exographics",
  transcript,
  transcriptRevision,
});
let runtime: LessonRuntime | undefined;
afterEach(() => {
  runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// These scores are controlled judgments, never recorded/live Jev output.
type Selection = { start: number | null; end?: number; observation?: string; uncertainSource?: boolean };
function body(transcript: string, selections: Record<string, Selection>) {
  const questions = conversationStateQuestions(lesson, "exographics", transcript);
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, question]) => {
        const match = /^(concept_|source_|sourceEnd_)(.*)$/.exec(id);
        const selection = match ? selections[match[2]] : undefined;
        const selected = !match
          ? id === "objectiveState"
            ? "unclear_or_incomplete"
            : "other"
          : match[1] === "concept_"
            ? (selection?.observation ?? (selection ? "demonstrated_independent" : "not_yet"))
            : !selection || selection.start === null
              ? "none"
              : `message_${match[1] === "sourceEnd_" ? (selection.end ?? selection.start) : selection.start}`;
        const uncertain = selection?.uncertainSource && id.startsWith("source");
        const alternative = selected === "none" ? Object.keys(question.criteria).find(key => key !== "none")! : "none";
        return [
          id,
          {
            type: "choice",
            choice: selected,
            confidence: uncertain ? 0.6 : 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map(key => [
                key,
                key === selected ? (uncertain ? 0.6 : 1) : uncertain && key === alternative ? 0.4 : 0,
              ]),
            ),
          },
        ];
      }),
    ),
  };
}
function mapped(transcript: string, selections: Record<string, Selection>, revision = 1) {
  const outputs = normalizeConversationOutputs(body(transcript, selections), lesson, "exographics", transcript)!;
  expect(outputs).not.toBeNull();
  return mapConversationObservation(input(transcript, revision), outputs).proposal!.conceptObservations!;
}
function harness() {
  let state = createLessonRuntime("fragment-attribution", { lesson: definition });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition);
    state = result.state;
    return result;
  };
  return {
    get state() {
      return state;
    },
    send,
    prepare() {
      send({ type: "child.turn.started", source: runtimeSource(state) });
      send({
        type: "transcript.updated",
        source: runtimeSource(state),
        speaker: "child",
        revision: state.transcriptRevision + 1,
      });
      send({ type: "child.turn.ended", source: runtimeSource(state) });
      return classificationSource(state)!;
    },
    apply(
      transcript: string,
      observations: readonly ProposedConceptObservation[],
      source = classificationSource(state)!,
    ) {
      return send({
        type: "proposal.received",
        source,
        transcriptSnapshot: transcript,
        proposal: {
          nodeId: state.nodeId,
          transcriptRevision: source.transcriptRevision,
          childActivity: "unknown",
          answerOutcome: "unclear",
          supportState: "none",
          tutorState: "unknown",
          conceptObservations: observations,
        },
      });
    },
  };
}

it("gives source selectors the exact revision-bound message table, preserving neutral tutor boundaries", () => {
  const transcript =
    "Tutor: Explain.\nChild: Numbers and\nChild: the plus sign\nTutor: Mm-hmm.\nChild: stand for abstract relationships.";
  const projected = conversationObserverState(input(transcript, 7))!;
  expect(projected).toMatchObject({
    transcriptRevision: 7,
    evidenceMessages: [
      { messageIndex: 0, speaker: "Tutor", text: "Explain." },
      { messageIndex: 1, speaker: "Child", text: "Numbers and\nthe plus sign" },
      { messageIndex: 2, speaker: "Tutor", text: "Mm-hmm." },
      { messageIndex: 3, speaker: "Child", text: "stand for abstract relationships." },
    ],
  });
  expect(Object.keys(learnerSourceOptions(transcript))).toEqual(["none", "message_1", "message_3"]);
  const questions = conversationStateQuestions(lesson, "exographics", transcript);
  for (const key of ["source_abstract-concepts", "sourceEnd_abstract-concepts"]) {
    expect(questions[key].instructions).toContain("evidenceMessages.messageIndex");
    expect(questions[key].instructions).toContain("Never join distinct answers");
  }
});

it("runs reconstructed October 17 provider fragments through assembly, Jev mapping, and evidence persistence", async () => {
  useRuntimeFakeTimers();
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  const wires: { state: ReturnType<typeof conversationObserverState> }[] = [];
  const selections = {
    "beyond-prose": { start: 1 },
    "visual-symbols": { start: 1 },
    "abstract-concepts": { start: 3 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string);
      if (url === "/api/classify")
        return Response.json(
          await classifyConversationStateWithDiagnostics({ ...request, lesson }, init.signal!).then(decision => ({
            proposal: decision.proposal,
          })),
        );
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(request.model).toBe(JEV_MODEL);
      wires.push(request);
      return Response.json(body(request.state.transcript, selections));
    }),
  );
  const emit = (event: ProviderEvent) => transport.receive!(event);
  const events = providerEvents(emit);
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  events.acknowledgeSteering(transport.send.mock.calls[0][0].event_id, 0);
  for (const [index, fragment] of trace.fragments.entries()) {
    const previous = trace.fragments[index - 1];
    const next = trace.fragments[index + 1];
    if (fragment.speaker === "child" && previous?.speaker !== "child") emit({ type: "microphone.activity_started" });
    emit({ type: "transcript", ...fragment } as ProviderEvent);
    if (fragment.speaker === "child" && next?.speaker !== "child")
      emit({ type: "microphone.speech_stopped", quietMs: 900 });
  }
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(wires).toHaveLength(1);
  expect(wires[0].state?.transcript).toBe(trace.expectedTranscript);
  expect(wires[0].state).toHaveProperty(
    "evidenceMessages",
    transcriptMessages(trace.expectedTranscript)!.map((message, messageIndex) => ({ messageIndex, ...message })),
  );
  for (const [id, index] of [
    ["beyond-prose", 1],
    ["visual-symbols", 1],
    ["abstract-concepts", 3],
  ] as const) {
    expect(runtime.snapshot().runtime?.conceptEvidence[`exographics:${id}`]).toMatchObject({
      status: "demonstrated",
      understanding: "independent",
      source: {
        childMessageIndex: index,
        childTranscript: transcriptMessages(trace.expectedTranscript)![index].text,
        transcriptRevision: wires[0].state!.transcriptRevision,
      },
    });
  }
  expect(runtime.snapshot().runtime?.conceptEvidence["exographics:cultural-agreement"]?.status).not.toBe(
    "demonstrated",
  );
});

it.each([
  [
    "consecutive fragments",
    "Tutor: Explain.\nChild: Numbers and the plus sign\nChild: represent abstract relationships.",
    1,
  ],
  [
    "neutral tutor backchannel",
    "Tutor: Explain.\nChild: Numbers and the plus sign\nTutor: Mm-hmm.\nChild: represent abstract relationships.",
    3,
  ],
] as const)("persists validated %s without dropping learner words", (_name, transcript, end) => {
  const h = harness();
  h.prepare();
  h.apply(transcript, mapped(transcript, { "abstract-concepts": { start: 1, end } }));
  const record = h.state.conceptEvidence["exographics:abstract-concepts"];
  expect(record).toMatchObject({ status: "demonstrated", understanding: "independent" });
  if (end === 1) expect(record.source!.childTranscript).toContain("\nrepresent abstract relationships.");
  else
    expect(record.source!.messages).toEqual(
      transcriptMessages(transcript)!
        .slice(1)
        .map((message, offset) => ({ messageIndex: offset + 1, ...message })),
    );
});

it("does not merge separate substantive answers or guess between ambiguous candidates", () => {
  const transcript =
    "Tutor: Give an example.\nChild: Mathematics uses symbols.\nTutor: What did you have for lunch?\nChild: I had soup.";
  const h = harness();
  h.prepare();
  const projected = conversationObserverState(input(transcript))!;
  expect(projected).toHaveProperty(
    "evidenceMessages",
    transcriptMessages(transcript)!.map((message, messageIndex) => ({ messageIndex, ...message })),
  );
  h.apply(transcript, mapped(transcript, { "beyond-prose": { start: 1, uncertainSource: true } }));
  expect(h.state.conceptEvidence["exographics:beyond-prose"]).toBeUndefined();
  h.prepare();
  h.apply(transcript, mapped(transcript, { "beyond-prose": { start: 1, end: 3 } }));
  expect(h.state.conceptEvidence["exographics:beyond-prose"].status).toBe("partial");
});

it("does not turn a positive unattributed label with no source into demonstrated evidence", () => {
  const transcript = trace.expectedTranscript;
  const raw = body(transcript, { "abstract-concepts": { start: null } });
  raw.answers["concept_abstract-concepts"] = {
    type: "choice",
    choice: "demonstrated_independent",
    confidence: 0.55,
    probabilities: { not_yet: 0.03, partial: 0.02, demonstrated_independent: 0.55, demonstrated_prompted: 0.4 },
  };
  const outputs = normalizeConversationOutputs(raw, lesson, "exographics", transcript)!;
  const observations = mapConversationObservation(input(transcript), outputs).proposal!.conceptObservations!;
  expect(observations).toContainEqual({
    criterionId: "abstract-concepts",
    observation: "demonstrated_unattributed",
    childMessageIndex: null,
  });
  const h = harness();
  h.prepare();
  h.apply(transcript, observations);
  expect(h.state.conceptEvidence["exographics:abstract-concepts"]).toBeUndefined();
});

it("rejects tutor sources even when a semantic label claims independent understanding", () => {
  const h = harness();
  h.prepare();
  h.apply(trace.expectedTranscript, [
    { criterionId: "cultural-agreement", observation: "demonstrated_independent", childMessageIndex: 4 },
  ]);
  expect(h.state.conceptEvidence).toEqual({});
  expect(Object.keys(learnerSourceOptions(trace.expectedTranscript))).not.toContain("message_4");
});

it.each(["runtimeId", "visitId", "childTurnId", "nodeId", "transcriptRevision"] as const)(
  "rejects mismatched %s source identity",
  key => {
    const h = harness();
    const source = h.prepare();
    const observations = mapped(trace.expectedTranscript, { "visual-symbols": { start: 1 } });
    h.apply(trace.expectedTranscript, observations, {
      ...source,
      [key]: typeof source[key] === "number" ? source[key] + 1 : "other",
    });
    expect(h.state.conceptEvidence).toEqual({});
  },
);

it("retains earlier accepted evidence and its revision through later source uncertainty", () => {
  const h = harness();
  const source = h.prepare();
  h.apply(trace.expectedTranscript, mapped(trace.expectedTranscript, { "visual-symbols": { start: 1 } }));
  const accepted = h.state.conceptEvidence["exographics:visual-symbols"];
  h.prepare();
  h.apply(
    trace.expectedTranscript,
    mapped(
      trace.expectedTranscript,
      { "visual-symbols": { start: 1, uncertainSource: true } },
      h.state.transcriptRevision,
    ),
  );
  expect(h.state.conceptEvidence["exographics:visual-symbols"]).toEqual(accepted);
  expect(accepted.source!.transcriptRevision).toBe(source.transcriptRevision);
});

it.each(["demonstrated_prompted", "demonstrated_independent"])(
  "does not credit tutor-supplied shared meaning repeated verbatim: %s",
  observation => {
    const transcript =
      "Tutor: People agree on the meanings of symbols.\nChild: People agree on the meanings of symbols.";
    const h = harness();
    h.prepare();
    h.apply(transcript, mapped(transcript, { "cultural-agreement": { start: 1, observation } }));
    expect(h.state.conceptEvidence["exographics:cultural-agreement"]).toMatchObject({
      status: "partial",
      understanding: null,
    });
  },
);

it("keeps a learner's own application after shared-meaning help prompted rather than independent", () => {
  const transcript =
    "Tutor: People agree on what symbols mean.\nChild: Then if I send you a plus sign, you know to add rather than subtract because we use the same rule.";
  const h = harness();
  h.prepare();
  h.apply(transcript, mapped(transcript, { "cultural-agreement": { start: 1, observation: "demonstrated_prompted" } }));
  expect(h.state.conceptEvidence["exographics:cultural-agreement"]).toMatchObject({
    status: "demonstrated",
    understanding: "prompted",
  });
});

it("reprojects late provider ordering at a new revision rather than reusing old indexes", () => {
  const first = "Child: Mathematics uses written symbols.";
  const later = "Tutor: Explain exographics.\n" + first;
  expect(conversationObserverState(input(first, 1))).toHaveProperty("evidenceMessages", [
    { messageIndex: 0, speaker: "Child", text: "Mathematics uses written symbols." },
  ]);
  expect(conversationObserverState(input(later, 2))).toHaveProperty("evidenceMessages", [
    { messageIndex: 0, speaker: "Tutor", text: "Explain exographics." },
    { messageIndex: 1, speaker: "Child", text: "Mathematics uses written symbols." },
  ]);
  // A locator response for the old message table cannot validate against the new one.
  expect(
    normalizeConversationOutputs(body(first, { "beyond-prose": { start: 0 } }), lesson, "exographics", later),
  ).toBeNull();
});

it("does not invent a coherent span across an ambiguous neutral backchannel", () => {
  const transcript =
    "Tutor: Explain.\nChild: It can mean something.\nTutor: Mm-hmm.\nChild: Or it could be something else.";
  const h = harness();
  h.prepare();
  h.apply(transcript, mapped(transcript, { "abstract-concepts": { start: null } }));
  expect(h.state.conceptEvidence["exographics:abstract-concepts"]).toBeUndefined();
  expect(Object.keys(learnerSourceOptions(transcript))).toEqual(["none", "message_1", "message_3"]);
});
