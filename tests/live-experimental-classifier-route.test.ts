import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/classify/route";
import * as legacy from "../lib/lesson-runtime/jev-conversation-state-classifier";
import * as experimental from "../lib/lesson-runtime/live-experimental-classifier";
import { JEV_MODEL } from "../lib/jev";
import {
  CONTEXT_PROJECTION_QUESTIONS,
  fullTranscriptObserverState,
} from "../lib/experiments/issue-57/context-projection";
import {
  mapSimplifiedObservation,
  type SimplifiedOutputs,
} from "../lib/experiments/issue-57/simplified-observer-contract";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { conversationProviderBody } from "./fixtures/conversation-classification";
import fixture from "./fixtures/issue-57-fragmented-confirmation.json";
const input = { ...fixture.input, nodeId: "count-2-ducks" as const };
const request = (fields: Record<string, unknown> = input) =>
  new Request("http://localhost:3000/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(fields),
  });
// Synthetic supplied Choice scores: a transport/mapping control, never an expected Jev result.
const outputs: SimplifiedOutputs = {
  objectiveState: {
    choice: "completed",
    confidence: 0.96,
    probabilities: {
      completed: 0.96,
      incorrect: 0.01,
      unclear_or_incomplete: 0.01,
      unresolved_help: 0.01,
      no_attempt: 0.01,
    },
  },
  tutorState: {
    choice: "confirmed_completion",
    confidence: 0.96,
    probabilities: { confirmed_completion: 0.96, clarifying: 0.01, helping: 0.01, asking: 0.01, other: 0.01 },
  },
};
const providerBody = () => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.entries(outputs).map(([id, value]) => [id, { type: "choice", ...value }])),
  rawBody: "private provider marker",
  nodeId: "count-3-butterflies",
  transcriptRevision: 999,
});
beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
  vi.stubEnv("NEXT_PUBLIC_SPROUT_CLASSIFIER_MODE", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("defaults the live route to full-context Choice and never invokes legacy (mock provider)", async () => {
  const old = vi.spyOn(legacy, "classifyConversationStateWithDiagnostics");
  const selected = vi.spyOn(experimental, "classifyFullContextObserver");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(providerBody()));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(selected).toHaveBeenCalledOnce();
  expect(old).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
  const wire = JSON.parse(fetch.mock.calls[0][1]?.body as string);
  expect(wire).toEqual({
    model: JEV_MODEL,
    state: fullTranscriptObserverState(input),
    questions: CONTEXT_PROJECTION_QUESTIONS,
  });
  expect(wire.state.transcript).toBe(fixture.input.transcript);
  expect(Object.keys(wire.state)).toEqual(["nodeId", "scene", "learningObjective", "transcript", "transcriptRevision"]);
  expect(body.proposal).toEqual(mapSimplifiedObservation(input, outputs).proposal);
  expect(body.diagnostic).toMatchObject({
    classifierMode: "simplified-full-context",
    nodeId: input.nodeId,
    transcriptRevision: 22,
    elapsedMs: expect.any(Number),
    outputs,
    outcome: "allow_semantic_completion_evidence",
  });
  expect(parseLiveClassificationDiagnostic(body.diagnostic)).toEqual(body.diagnostic);
  expect(JSON.stringify(body)).not.toMatch(
    /private provider marker|rawBody|"transcriptRevision":999|count-3-butterflies/,
  );
});
it.each(["request", "environment"])("switches back to legacy through %s and never calls experimental", async how => {
  if (how === "environment") vi.stubEnv("NEXT_PUBLIC_SPROUT_CLASSIFIER_MODE", "legacy");
  const old = vi.spyOn(legacy, "classifyConversationStateWithDiagnostics");
  const selected = vi.spyOn(experimental, "classifyFullContextObserver");
  const fetch = vi.fn(async () => Response.json(conversationProviderBody()));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request(how === "request" ? { ...input, classifierMode: "legacy" } : input));
  expect(old).toHaveBeenCalledOnce();
  expect(selected).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
  expect((await response.json()).diagnostic.classifierMode).toBe("legacy");
});
it("does not fall back to legacy on an experimental provider failure", async () => {
  const old = vi.spyOn(legacy, "classifyConversationStateWithDiagnostics");
  const fetch = vi.fn(async () => new Response("private provider marker", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const body = await (await POST(request())).json();
  expect(old).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
  expect(body).toMatchObject({
    proposal: null,
    diagnostic: {
      classifierMode: "simplified-full-context",
      decision: "abstained",
      reason: "provider_rejected",
      outputs: null,
      outcome: "unresolved",
    },
  });
  expect(parseLiveClassificationDiagnostic(body.diagnostic)).toEqual(body.diagnostic);
});
it("rejects invalid modes before a provider call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request({ ...input, classifierMode: "other" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("returns held-scene diagnostics for valid negative semantic states", async () => {
  const raw = providerBody();
  raw.answers.tutorState = {
    type: "choice",
    choice: "other",
    confidence: 1,
    probabilities: { confirmed_completion: 0, clarifying: 0, helping: 0, asking: 0, other: 1 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(raw)),
  );
  const body = await (await POST(request())).json();
  expect(body.proposal).toBeNull();
  expect(body.diagnostic.outcome).toBe("hold_scene");
  expect(parseLiveClassificationDiagnostic(body.diagnostic)).toEqual(body.diagnostic);
});
