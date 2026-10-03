import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JEV_MODEL } from "../lib/jev";
import { parseConversationStateProposal } from "../lib/transcript-state-steering/conversation-state-classifier";
import type { ConversationStateClassifierInput } from "../lib/transcript-state-steering/conversation-state-classifier";
import {
  CONVERSATION_QUESTIONS,
  jevConversationStateClassifier,
} from "../lib/transcript-state-steering/jev-conversation-state-classifier";

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
      parentContext: "parent review marker",
      learnerProfile: "historical profile marker",
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
      "parent review marker",
      "historical profile marker",
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
