import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JEV_MODEL } from "../lib/jev";
import { parseConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import type { ConversationStateClassifierInput } from "../lib/lesson-runtime/conversation-state-classifier";
import {
  CONVERSATION_QUESTIONS,
  classifyConversationStateWithDiagnostics,
  jevConversationStateClassifier,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";

type QuestionId = keyof typeof CONVERSATION_QUESTIONS;
const probabilities = (overrides: Partial<Record<QuestionId, number>> = {}) => ({
  answerCorrect: 0.98,
  answerIncorrect: 0.01,
  answerUnclear: 0.01,
  answerNone: 0.01,
  needsHelp: 0.01,
  tutorAcknowledging: 0.01,
  tutorAsking: 0.01,
  tutorClarifying: 0.01,
  tutorHelping: 0.01,
  ...overrides,
});
const providerBody = (values = probabilities()) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.entries(values).map(([id, noul]) => [id, { type: "noul", noul }])),
});
const snapshot: ConversationStateClassifierInput = {
  nodeId: "count-1-duck",
  transcriptRevision: 7,
  transcript: 'Child: "One"',
};
const classify = (input = snapshot, signal = new AbortController().signal) =>
  jevConversationStateClassifier.classify(input, signal);
const mockJev = (values = probabilities()) => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(providerBody(values)),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

beforeEach(() => vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Jev current-node semantic classifier", () => {
  it.each([
    {
      transcript: 'Child: "One"',
      nodeId: "count-1-duck",
      values: probabilities(),
      answerOutcome: "correct",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "Two"',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerIncorrect: 0.98 }),
      answerOutcome: "incorrect",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "One... no, two"',
      nodeId: "count-2-ducks",
      values: probabilities(),
      answerOutcome: "correct",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "One"\nChild: "No, two"',
      nodeId: "count-2-ducks",
      values: probabilities(),
      answerOutcome: "correct",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "There are..."',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerUnclear: 0.96 }),
      answerOutcome: "unclear",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "One"\nTutor: "Yes, one duck!"',
      nodeId: "count-1-duck",
      values: probabilities({ tutorAcknowledging: 0.97 }),
      answerOutcome: "correct",
      tutorState: "acknowledging",
      supportState: "none",
    },
    {
      transcript: 'Tutor: "How many ducks do you see?"',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerNone: 0.98, tutorAsking: 0.98 }),
      answerOutcome: "none",
      tutorState: "asking",
      supportState: "none",
    },
    {
      transcript: 'Tutor: "There is one duck!"',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerNone: 0.98 }),
      answerOutcome: "none",
      tutorState: "unknown",
      supportState: "none",
    },
    {
      transcript: 'Child: "Uh..."\nTutor: "Can you say that again?"',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerUnclear: 0.97, tutorClarifying: 0.98 }),
      answerOutcome: "unclear",
      tutorState: "clarifying",
      supportState: "none",
    },
    {
      transcript: 'Child: "I do not know, help me"\nTutor: "Let us count them one at a time."',
      nodeId: "count-1-duck",
      values: probabilities({ answerCorrect: 0.01, answerUnclear: 0.98, needsHelp: 0.97, tutorHelping: 0.98 }),
      answerOutcome: "unclear",
      tutorState: "helping",
      supportState: "needs_help",
    },
  ] as const)("maps mocked semantic evidence for $nodeId: $transcript", async example => {
    const fetch = mockJev(example.values);
    const result = await classify({ ...snapshot, nodeId: example.nodeId, transcript: example.transcript });
    expect(result).toEqual({
      nodeId: example.nodeId,
      transcriptRevision: 7,
      childActivity: "unknown",
      answerOutcome: example.answerOutcome,
      tutorState: example.tutorState,
      supportState: example.supportState,
    });
    expect(parseConversationStateProposal(result)).toEqual(result);
    const wire = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(wire.state.transcript).toBe(example.transcript);
  });

  it("sends one pinned SystemOne request with only current-node facts and transcript", async () => {
    const fetch = mockJev();
    const signal = new AbortController().signal;
    const extraCallerData = {
      ...snapshot,
      futureNodes: [{ id: "count-2-ducks", content: "future content marker" }],
      onSuccess: { kind: "node", nodeId: "count-2-ducks" },
      privateContext: "private context marker",
      unrelatedState: "unrelated state marker",
    };
    await classify(extraCallerData, signal);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init).toMatchObject({
      method: "POST",
      signal,
      headers: { Authorization: "Bearer synthetic-test-key", "Content-Type": "application/json" },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: JEV_MODEL,
      state: {
        nodeId: "count-1-duck",
        scene: { object: "duck", quantity: 1 },
        learningObjective: "Identify the total of one displayed duck.",
        transcript: snapshot.transcript,
        tutorObservation: { latestMessage: null, precedingChildAttempt: null },
        supportEvidence: {
          precedingContext: [],
          latestChildAttempt: { speaker: "Child", text: '"One"' },
          subsequentMessages: [],
        },
        transcriptRevision: 7,
      },
      questions: CONVERSATION_QUESTIONS,
    });
    expect(Object.values(CONVERSATION_QUESTIONS).every(question => question.type === "noul")).toBe(true);
    for (const forbidden of [
      "count-2-ducks",
      "count-3-butterflies",
      "onSuccess",
      "futureNodes",
      "tutorBrief",
      "private context marker",
      "unrelated state marker",
      "future content marker",
    ])
      expect(init!.body).not.toContain(forbidden);
  });

  it.each([
    probabilities({ answerCorrect: 0.98, answerIncorrect: 0.95 }),
    probabilities({ answerCorrect: 0.7, answerUnclear: 0.65 }),
    probabilities({ answerCorrect: 0.899 }),
    probabilities({ answerUnclear: 0.201 }),
    probabilities({ needsHelp: 0.5 }),
    probabilities({ tutorAsking: 0.95, tutorHelping: 0.94 }),
    probabilities({ tutorAsking: 0.4 }),
    probabilities({ tutorAsking: 0.101 }),
    probabilities({ answerCorrect: 0.01, answerIncorrect: 0.99, tutorAcknowledging: 0.98 }),
    probabilities({ answerCorrect: 0.01 }),
  ])("abstains on uncertain or conflicting probabilities %#", async values => {
    mockJev(values);
    expect(await classify()).toBeNull();
  });

  it("accepts the documented experimental band boundaries", async () => {
    mockJev(probabilities({ answerCorrect: 0.9, answerIncorrect: 0.2, needsHelp: 0.1, tutorAsking: 0.1 }));
    expect(await classify()).toMatchObject({ answerOutcome: "correct", supportState: "none", tutorState: "unknown" });
    mockJev(probabilities({ needsHelp: 0.9, tutorHelping: 0.9, tutorClarifying: 0.2 }));
    expect(await classify()).toMatchObject({ supportState: "needs_help", tutorState: "helping" });
  });

  it.each([undefined, null, "0.98", -0.01, 1.01, NaN, Infinity])(
    "abstains on an invalid required probability %s",
    async noul => {
      const body = providerBody();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            ...body,
            answers: { ...body.answers, tutorHelping: { type: "noul", noul } },
          }),
        ),
      );
      expect(await classify()).toBeNull();
    },
  );

  it("ignores provider identity claims and never exposes or logs raw bodies", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...providerBody(),
          nodeId: "count-3-butterflies",
          transcriptRevision: 999,
          rawDetail: "sensitive provider marker",
          advance: true,
        }),
      ),
    );
    const result = await classify();
    expect(result).toMatchObject({ nodeId: snapshot.nodeId, transcriptRevision: snapshot.transcriptRevision });
    expect(JSON.stringify(result)).not.toContain("sensitive provider marker");
    expect(result).not.toHaveProperty("advance");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    vi.fn(async () => new Response("sensitive provider marker", { status: 429 })),
    vi.fn(async () => new Response("invalid JSON")),
    vi.fn(async () => Response.json({})),
    vi.fn().mockRejectedValue(new Error("sensitive provider marker")),
  ])("abstains on provider failure without retry or raw logging %#", async fetch => {
    const error = vi.spyOn(console, "error");
    vi.stubGlobal("fetch", fetch);
    expect(await classify()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it("abstains without a call if Jev is unconfigured", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetch = mockJev();
    expect(await classify()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...snapshot, nodeId: "future-node" },
    { ...snapshot, transcriptRevision: -1 },
    { ...snapshot, transcriptRevision: 1.5 },
    { ...snapshot, transcriptRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, transcript: "  " },
    { ...snapshot, transcript: null },
  ])("rejects invalid snapshot before calling Jev %#", async input => {
    const fetch = mockJev();
    expect(await classify(input as ConversationStateClassifierInput)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("request identity and cancellation", () => {
  it("does not issue a request with an already cancelled signal", async () => {
    const fetch = mockJev();
    const controller = new AbortController();
    controller.abort();
    expect(await classify(snapshot, controller.signal)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns no proposal when the in-flight fetch is cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      ),
    );
    const pending = classify(snapshot, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
  });

  it("discards a superseded response even when fetch completes after abort", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>(resolve => {
            finish = resolve;
          }),
      ),
    );
    const pending = classify(snapshot, controller.signal);
    controller.abort();
    const newer = mockJev();
    expect(await classify({ ...snapshot, nodeId: "count-2-ducks", transcriptRevision: 8 })).toMatchObject({
      nodeId: "count-2-ducks",
      transcriptRevision: 8,
    });
    expect(newer).toHaveBeenCalledOnce();
    finish(Response.json(providerBody()));
    expect(await pending).toBeNull();
  });

  it("discards a response cancelled during body parsing", async () => {
    const controller = new AbortController();
    let finish!: (body: unknown) => void;
    let parsing!: () => void;
    const started = new Promise<void>(resolve => {
      parsing = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: () => {
          parsing();
          return new Promise(resolve => {
            finish = resolve;
          });
        },
      })),
    );
    const pending = classify(snapshot, controller.signal);
    await started;
    controller.abort();
    finish(providerBody());
    expect(await pending).toBeNull();
  });

  it("keeps the captured request identity if the caller changes its input during fetch", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>(resolve => {
            finish = resolve;
          }),
      ),
    );
    const mutableInput = { ...snapshot };
    const pending = classify(mutableInput);
    mutableInput.nodeId = "count-2-ducks";
    mutableInput.transcriptRevision = 8;
    finish(Response.json(providerBody()));
    expect(await pending).toMatchObject({ nodeId: "count-1-duck", transcriptRevision: 7 });
  });
});

describe("latest tutor evidence after a supported correction", () => {
  const recordedInput: ConversationStateClassifierInput = {
    nodeId: "count-2-ducks",
    transcriptRevision: 40,
    transcript:
      "Tutor: Okay, how many ducks do you see?\nChild: Three\n" +
      "Tutor: Hmm, let's try counting them one at a time. Look carefully. Can you point and count with me?\n" +
      "Child: Uh two\nTutor: Yes, two ducks!",
  };

  it("sends full correction history for answer/support, with a separate latest tutor target in the same single request", async () => {
    const fetch = mockJev(probabilities({ tutorAcknowledging: 0.95 }));
    expect(await classify(recordedInput)).toMatchObject({
      nodeId: "count-2-ducks",
      transcriptRevision: 40,
      answerOutcome: "correct",
      tutorState: "acknowledging",
      supportState: "none",
    });
    expect(fetch).toHaveBeenCalledOnce();
    const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(wire.state.transcript).toBe(recordedInput.transcript);
    expect(wire.state.tutorObservation).toEqual({ latestMessage: "Yes, two ducks!", precedingChildAttempt: "Uh two" });
    for (const key of ["tutorAcknowledging", "tutorAsking", "tutorClarifying", "tutorHelping"] as const) {
      expect(wire.questions[key].instructions).toContain("Classify only tutorObservation.latestMessage.");
      expect(wire.questions[key].instructions).toContain("Do not classify earlier tutor messages");
    }
  });

  it("still abstains on the demo's original conflicting probabilities instead of relaxing the gate", async () => {
    mockJev({
      answerCorrect: 0.94,
      answerIncorrect: 0.08,
      answerUnclear: 0.09,
      answerNone: 0.02,
      needsHelp: 0.08,
      tutorAcknowledging: 0.95,
      tutorAsking: 0.05,
      tutorClarifying: 0.05,
      tutorHelping: 0.27,
    });
    const decision = await classifyConversationStateWithDiagnostics(recordedInput, new AbortController().signal);
    expect(decision).toMatchObject({ status: "abstained", reason: "tutor_margin_too_small" });
  });

  it("keeps unresolved current help and actual latest scaffolding eligible as helping, never acknowledgment", async () => {
    const fetch = mockJev(probabilities({ needsHelp: 0.96, tutorHelping: 0.97 }));
    const input = {
      ...recordedInput,
      transcript: recordedInput.transcript + "\nChild: I still need help\nTutor: Let's count them together again.",
    };
    expect(await classify(input)).toMatchObject({ supportState: "needs_help", tutorState: "helping" });
    const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(wire.state.tutorObservation).toEqual({
      latestMessage: "Let's count them together again.",
      precedingChildAttempt: "I still need help",
    });
  });

  it("does not cut a mixed acknowledgment/scaffold into a pure acknowledgment to bypass ambiguity", async () => {
    const fetch = mockJev(probabilities({ tutorAcknowledging: 0.95, tutorHelping: 0.7 }));
    expect(
      await classify({
        ...recordedInput,
        transcript: recordedInput.transcript + "\nTutor: Let's count them together again.",
      }),
    ).toBeNull();
    const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(wire.state.tutorObservation.latestMessage).toBe("Yes, two ducks!\nLet's count them together again.");
  });

  it("abstains before the provider call when speaker boundaries cannot be projected", async () => {
    const fetch = mockJev();
    expect(await classify({ ...recordedInput, transcript: "unlabelled text\nTutor: Yes, two ducks!" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

// These verify projection and score mapping, not Jev's interpretation of the words.
describe("support evidence and unchanged probability gates", () => {
  it.each([
    {
      transcript:
        "Tutor: How many ducks do you see?\nChild: [breath ]I think [sigh\nChild: ] One\nTutor: Yes. One duck.",
      help: 0.17,
      expected: null,
    },
    {
      transcript: "Child: Help please\nTutor: Point to each duck\nChild: One\nTutor: Yes, one duck",
      help: 0.01,
      expected: "none",
    },
    { transcript: "Child: One\nTutor: Yes, one duck\nChild: I need help", help: 0.98, expected: "needs_help" },
    { transcript: "Child: One...\nChild: can you help?", help: 0.98, expected: "needs_help" },
    { transcript: "Child: One or two?", help: 0.98, expected: "needs_help" },
    { transcript: "Child: Two\nTutor: Try again\nChild: Three", help: 0.98, expected: "needs_help" },
    { transcript: "Tutor: One duck\nChild: One?", help: 0.5, expected: null },
    { transcript: "Child: [breath] I think...\nChild: no, one", help: 0.01, expected: "none" },
  ])("passes all support evidence without overriding help from high correctness: $transcript", async example => {
    const fetch = mockJev(probabilities({ needsHelp: example.help }));
    const input = { ...snapshot, transcript: example.transcript };
    const proposal = await classify(input);
    if (example.expected === null) expect(proposal).toBeNull();
    else expect(proposal).toMatchObject({ supportState: example.expected });
    const wire = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(wire.state.transcript).toBe(example.transcript);
    expect(wire.state.supportEvidence).toBeTruthy();
    expect(wire.questions.needsHelp.instructions).toContain("subsequentMessages");
    expect(wire.questions.needsHelp.criteria.false).toContain("Pauses, breaths, sighs");
    expect(wire.questions.needsHelp.criteria.false).toContain("not independent mastery");
  });
});
