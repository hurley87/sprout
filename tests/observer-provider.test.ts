import { afterEach, expect, it, vi } from "vitest";
import { analyzeSavedRecording, createOpenAIObserverProvider, ObserverProviderError } from "../lib/observer-provider";

// Entirely synthetic records and provider payloads; no live call or child audio.
const sessionId = "sessions_synthetic";
const snapshot = JSON.stringify({
  sessionId,
  state: "ended",
  recordStatus: "complete",
  recording: { storageId: "storage_synthetic", startOffsetMs: 0, durationMs: 4000 },
  events: [
    {
      _id: "scene",
      atMs: 500,
      evidence: {
        type: "scene_displayed",
        sceneId: "ducks",
        targetQuantity: 3,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    },
    {
      _id: "help",
      atMs: 700,
      evidence: { type: "support", source: "sprout", mode: "spoken", description: "Count with me." },
    },
    {
      _id: "response",
      atMs: 2200,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "One, two, three",
        startMs: 1500,
        endMs: 2200,
        state: "finalized",
      },
    },
  ],
});
const proposal = {
  kind: "observer_proposal",
  proposalId: "proposal-one",
  sessionId,
  exchangeAtMs: 2200,
  observation: {
    behavior: "counting_aloud_with_total",
    outcome: "correct",
    speakerAttribution: "child_or_nearby_speaker",
    statedTotal: 3,
    countSequenceObserved: true,
    targetQuantity: 3,
    description: "The child said a count sequence and gave the displayed total.",
    support: { status: "recorded", kinds: ["counting_together"], sourceEventIds: ["help"], recordingSourceIds: [] },
    uncertaintyReasons: [],
  },
  sources: [
    { eventId: "scene", role: "scene" },
    { eventId: "help", role: "support" },
    { eventId: "response", role: "response" },
  ],
};
const provider = (proposals: unknown) => ({
  transcribe: vi.fn(async () => "one two three"),
  propose: vi.fn(async () => proposals),
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it("runs saved audio transcription and validates evidence against the exact canonical snapshot", async () => {
  const mocked = provider([proposal]);
  const result = await analyzeSavedRecording({
    provider: mocked,
    audio: new Blob(["synthetic audio"]),
    mimeType: "audio/webm",
    canonicalSnapshot: snapshot,
    signal: new AbortController().signal,
  });
  expect(result).toHaveLength(1);
  expect(mocked.propose).toHaveBeenCalledWith(
    { transcript: "one two three", canonicalSnapshot: snapshot },
    expect.any(AbortSignal),
  );
});

it("uploads supported recording containers with an extension parsed from MIME parameters", async () => {
  const cases = [
    ["audio/webm;codecs=opus", "audio/webm;codecs=opus", "session.webm"],
    ["audio/ogg;codecs=opus", "audio/ogg;codecs=opus", "session.ogg"],
    [' Audio/WebM ; Codecs = "Opus" ', "audio/webm;codecs=opus", "session.webm"],
    ["audio/ogg", "audio/ogg", "session.ogg"],
    ["audio/wav", "audio/wav", "session.wav"],
  ] as const;

  for (const [mimeType, blobType, filename] of cases) {
    let uploaded: FormDataEntryValue | null = null;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      uploaded = (init?.body as FormData).get("file");
      return Response.json({ text: "synthetic transcript" });
    });
    const openai = createOpenAIObserverProvider("synthetic-key", fetcher as typeof fetch);
    const audio = new Blob(["synthetic audio bytes"], { type: blobType });

    await expect(openai.transcribe(audio, mimeType, new AbortController().signal)).resolves.toBe(
      "synthetic transcript",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(uploaded).toMatchObject({ name: filename, type: blobType, size: audio.size });
  }
});

it("rejects malformed or unsupported MIME parameters before making a request", async () => {
  const fetcher = vi.fn(async () => Response.json({ text: "unexpected" }));
  const openai = createOpenAIObserverProvider("synthetic-key", fetcher as typeof fetch);

  for (const mimeType of [
    "audio/webm;codecs=vorbis",
    "audio/wav;codecs=opus",
    "audio/webm;codecs=opus;rate=48000",
    'audio/webm;codecs="opus',
    "audio//webm",
    "not a mime type",
  ]) {
    await expect(openai.transcribe(new Blob(["synthetic"]), mimeType, new AbortController().signal)).rejects.toThrow(
      "MIME type is unsupported",
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("accepts explicit empty evidence without turning provider failure into empty success", async () => {
  const empty = provider([]);
  await expect(
    analyzeSavedRecording({
      provider: empty,
      audio: new Blob(["synthetic"]),
      mimeType: "audio/webm",
      canonicalSnapshot: snapshot,
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual([]);
  const unavailable = {
    ...empty,
    transcribe: vi.fn(async () => {
      throw new ObserverProviderError("offline");
    }),
  };
  await expect(
    analyzeSavedRecording({
      provider: unavailable,
      audio: new Blob(["synthetic"]),
      mimeType: "audio/webm",
      canonicalSnapshot: snapshot,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("offline");
});

it("rejects cross-session, untimed/cross-scene and support-inventing proposals", async () => {
  for (const invalid of [
    { ...proposal, sessionId: "sessions_other" },
    { ...proposal, sources: [{ eventId: "response", role: "response" }] },
    {
      ...proposal,
      observation: {
        ...proposal.observation,
        support: { status: "recorded", kinds: ["hint"], sourceEventIds: ["invented"], recordingSourceIds: [] },
      },
    },
  ]) {
    await expect(
      analyzeSavedRecording({
        provider: provider([invalid]),
        audio: new Blob(["synthetic"]),
        mimeType: "audio/webm",
        canonicalSnapshot: snapshot,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(ObserverProviderError);
  }
});

it("rejects a provider count proposal when the canonical response has an incomplete sequence", async () => {
  const incompleteSnapshot = snapshot.replace("One, two, three", "Three, one");
  await expect(
    analyzeSavedRecording({
      provider: provider([proposal]),
      audio: new Blob(["synthetic"]),
      mimeType: "audio/webm",
      canonicalSnapshot: incompleteSnapshot,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(ObserverProviderError);
});

it("fails closed for missing configuration, refusals, malformed output and oversized audio", async () => {
  expect(() => createOpenAIObserverProvider(undefined)).toThrow("OPENAI_API_KEY");
  const fetcher = vi.fn(async () =>
    Response.json({ status: "completed", output: [{ content: [{ type: "refusal", refusal: "no" }] }] }),
  );
  const openai = createOpenAIObserverProvider("synthetic-key", fetcher as typeof fetch);
  await expect(
    openai.propose({ transcript: "synthetic", canonicalSnapshot: snapshot }, new AbortController().signal),
  ).rejects.toThrow("declined");
  const badJson = vi.fn(async () => Response.json({ status: "completed", output_text: "{" }));
  await expect(
    createOpenAIObserverProvider("synthetic-key", badJson as typeof fetch).propose(
      { transcript: "", canonicalSnapshot: snapshot },
      new AbortController().signal,
    ),
  ).rejects.toThrow("malformed");
  const providerFailure = createOpenAIObserverProvider(
    "synthetic-key",
    vi.fn(async () => new Response("", { status: 503 })) as typeof fetch,
  );
  await expect(
    providerFailure.transcribe(new Blob(["synthetic"]), "audio/webm", new AbortController().signal),
  ).rejects.toThrow("HTTP 503");
  await expect(
    providerFailure.transcribe(new Blob(["synthetic"]), "audio/unknown", new AbortController().signal),
  ).rejects.toThrow("MIME type is unsupported");
  const oversized = provider([]);
  await expect(
    analyzeSavedRecording({
      provider: oversized,
      audio: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]),
      mimeType: "audio/webm",
      canonicalSnapshot: snapshot,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("size limit");
});
