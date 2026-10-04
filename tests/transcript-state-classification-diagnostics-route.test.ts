import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/classify/route";
import {
  classifyConversationStateWithDiagnostics,
  jevConversationStateClassifier,
} from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { conversationProbabilities, conversationProviderBody } from "./fixtures/conversation-classification";

const input = {
  nodeId: "count-3-butterflies" as const,
  transcriptRevision: 17,
  transcript:
    "Tutor: How many butterflies do you see?\nChild: What's a butterfly\nTutor: A butterfly is a little insect with big wings that flies around. Look at the butterflies on the screen. How many do you see?\nChild: Uh, two\nTutor: Nice try. Want to count them one at a time with me?\nChild: Yes\nTutor: Okay, point to each butterfly and say a number, starting with one.\nChild: One, two. Three\nTutor: Yes, three butterflies!",
};
const request = () =>
  new Request("http://localhost:3000/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify({ ...input, classifierMode: "legacy" }),
  });
beforeEach(() => vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { values: conversationProbabilities(), status: "accepted", reason: undefined },
  { values: conversationProbabilities({ needsHelp: 0.5 }), status: "abstained", reason: "support_ambiguous" },
])(
  "returns isolated mapping diagnostics for $status without altering proposal output or trimming the snapshot",
  async ({ values, status, reason }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        ...conversationProviderBody(values),
        rawBody: "raw provider marker",
        credential: "provider credential marker",
        model: "untrusted provider model marker",
        nodeId: "count-1-duck",
        transcriptRevision: 999,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).state.transcript).toBe(input.transcript);
    expect(Object.keys(body)).toEqual(["proposal", "diagnostic"]);
    expect(body.diagnostic).toMatchObject({
      decision: status,
      probabilities: values,
      thresholds: { HIGH: 0.9, LOW: 0.1, COMPETITOR_CEILING: 0.2, MIN_MARGIN: 0.7 },
    });
    expect(body.diagnostic.reason).toBe(reason);
    expect(JSON.stringify(body)).not.toMatch(
      /raw provider marker|provider credential marker|untrusted provider model marker|rawBody|credential/,
    );
    if (body.proposal)
      expect(body.proposal).toMatchObject({ nodeId: input.nodeId, transcriptRevision: input.transcriptRevision });
    // The provider-independent classifier still returns only the same proposal or null.
    expect(await jevConversationStateClassifier.classify(input, new AbortController().signal)).toEqual(body.proposal);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  },
);

it.each([
  { result: () => new Response("raw provider marker", { status: 429 }), reason: "provider_rejected" },
  {
    result: () => Response.json({ ...conversationProviderBody(), answers: {}, rawBody: "raw provider marker" }),
    reason: "provider_unreadable",
  },
  {
    result: () => {
      throw new Error("raw provider marker");
    },
    reason: "provider_unreachable",
  },
])("explains $reason without fabricated probabilities, raw bodies or retries", async ({ result, reason }) => {
  const fetch = vi.fn(async () => result());
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request());
  expect(await response.json()).toEqual({
    proposal: null,
    diagnostic: {
      classifierMode: "legacy",
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      elapsedMs: expect.any(Number),
      decision: "abstained",
      reason,
      probabilities: null,
      thresholds: { HIGH: 0.9, LOW: 0.1, COMPETITOR_CEILING: 0.2, MIN_MARGIN: 0.7 },
    },
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it("reports cancellation without returning a superseded mapping decision", async () => {
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
  const abort = new AbortController();
  const pending = classifyConversationStateWithDiagnostics(input, abort.signal);
  abort.abort();
  finish(Response.json(conversationProviderBody()));
  expect(await pending).toEqual({ status: "abstained", reason: "cancelled", probabilities: null });
});

it("reports missing configuration without a provider request", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "unconfigured" });
  expect(fetch).not.toHaveBeenCalled();
});

it("reports server timeout separately from semantic abstention", async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      timeout.abort();
      return Response.json(conversationProviderBody());
    }),
  );
  const response = await POST(request());
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ code: "timeout" });
});

it("does not forward unexpected server exception text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      get ok() {
        throw new Error("private marker");
      },
    })),
  );
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: "Classification did not finish.",
    code: "internal_error",
    classifierMode: "legacy",
  });
});
