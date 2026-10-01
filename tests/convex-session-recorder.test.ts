import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "../convex/_generated/api";
import { ConvexSessionRecorder } from "../lib/convex-session-recorder";
const { mutation, query } = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mutation;
    query = query;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mutation.mockReset();
  query.mockReset();
});
const audio = {
  blob: new Blob(["audio"], { type: "audio/mp4" }),
  mimeType: "audio/mp4",
  startOffsetMs: 0,
  durationMs: 789,
};
async function setup() {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  mutation.mockImplementation(async fn => {
    if (getFunctionName(fn) === getFunctionName(api.sessions.create)) return "session-test";
    if (getFunctionName(fn) === getFunctionName(api.sessions.generateUploadUrl))
      return "https://test.convex.cloud/upload";
  });
  const upload = vi.fn(async () => ({ ok: true, json: async () => ({ storageId: "storage-test" }) }));
  vi.stubGlobal("fetch", upload);
  const recorder = new ConvexSessionRecorder();
  await recorder.create();
  return { recorder, upload };
}
it("requests a URL, POSTs the Blob with actual MIME, and attaches to the same session", async () => {
  const { recorder, upload } = await setup();
  await recorder.finalize("parent_stop");
  await recorder.attachRecording(audio);
  expect(mutation.mock.calls.map(call => getFunctionName(call[0]))).toEqual(
    [api.sessions.create, api.sessions.finalize, api.sessions.generateUploadUrl, api.sessions.attachRecording].map(
      getFunctionName,
    ),
  );
  expect(upload).toHaveBeenCalledWith("https://test.convex.cloud/upload", {
    method: "POST",
    headers: { "Content-Type": "audio/mp4" },
    body: audio.blob,
  });
  expect(mutation).toHaveBeenLastCalledWith(api.sessions.attachRecording, {
    sessionId: "session-test",
    storageId: "storage-test",
    mimeType: "audio/mp4",
    startOffsetMs: 0,
    durationMs: 789,
  });
  expect(upload).toHaveBeenNthCalledWith(2, "/api/observer/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-test" }),
  });
});
it.each(["url", "upload", "id", "attach"])("propagates %s failure to the persistence queue", async failure => {
  const { recorder, upload } = await setup();
  if (failure === "url" || failure === "attach")
    mutation.mockImplementation(async fn => {
      if (
        getFunctionName(fn) ===
        getFunctionName(failure === "url" ? api.sessions.generateUploadUrl : api.sessions.attachRecording)
      )
        throw new Error("offline");
      return "https://test.convex.cloud/upload";
    });
  if (failure === "upload") upload.mockResolvedValue({ ok: false, json: async () => ({ storageId: "storage-test" }) });
  if (failure === "id") upload.mockResolvedValue({ ok: true, json: async () => ({ storageId: "" }) });
  await expect(recorder.attachRecording(audio)).rejects.toThrow();
});

it("returns durable identity and passes explicit retry linkage to create", async () => {
  const { recorder } = await setup();
  expect(await recorder.create("prior-session")).toBe("session-test");
  expect(mutation).toHaveBeenLastCalledWith(api.sessions.create, { retryOf: "prior-session" });
});
it("fetches an application record by reference without exposing storage/database internals", async () => {
  const { recorder } = await setup();
  query.mockResolvedValue({
    session: {
      _id: "session-test",
      state: "ended",
      recordStatus: "complete",
      createdAt: 100,
      recording: { storageId: "secret-internal-id", mimeType: "audio/webm", startOffsetMs: 0, durationMs: 1000 },
    },
    recordingUrl: "https://storage.invalid/audio",
    events: [
      {
        _id: "event-id",
        sessionId: "session-test",
        eventKey: "scene",
        order: 0,
        atMs: 0,
        evidence: { type: "support", source: "parent", mode: "other", description: "help" },
      },
    ],
  });
  const record = await recorder.getRecord("session-test");
  expect(query).toHaveBeenCalledWith(api.sessions.getRecord, { sessionId: "session-test" });
  expect(record?.recording?.url).toBe("https://storage.invalid/audio");
  expect(record?.recording?.recordingId).toBe("session-test:recording");
  expect(record?.events[0]).toEqual({
    eventKey: "scene",
    order: 0,
    atMs: 0,
    evidence: { type: "support", source: "parent", mode: "other", description: "help" },
  });
  expect(JSON.stringify(record)).not.toContain("secret-internal-id");
  expect(JSON.stringify(record)).not.toContain("event-id");
});
it("does not invent a playback URL and handles a missing record", async () => {
  const { recorder } = await setup();
  query.mockResolvedValue({
    session: { _id: "session-test", state: "ended", recordStatus: "pending", createdAt: 100 },
    events: [],
    recordingUrl: null,
  });
  expect((await recorder.getRecord("session-test"))?.recording).toBeUndefined();
  query.mockResolvedValue(null);
  expect(await recorder.getRecord("session-test")).toBeNull();
});
it("reads an existing record with a fresh reader and does not create a live session", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  query.mockResolvedValue({
    session: { _id: "session-after-reload", state: "ended", recordStatus: "incomplete", createdAt: 100 },
    events: [],
    recordingUrl: null,
  });
  const reader = new ConvexSessionRecorder();
  expect((await reader.getRecord("session-after-reload"))?.recordStatus).toBe("incomplete");
  expect(query).toHaveBeenCalledWith(api.sessions.getRecord, { sessionId: "session-after-reload" });
  expect(mutation).not.toHaveBeenCalled();
});
it("failed create returns no identity while read-only lookup remains independent", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  mutation.mockRejectedValue(new Error("offline"));
  const recorder = new ConvexSessionRecorder();
  await expect(recorder.create()).rejects.toThrow("offline");
  expect(await recorder.getRecord("unknown")).toBeNull();
  expect(query).toHaveBeenCalledWith(api.sessions.getRecord, { sessionId: "unknown" });
});

it("passes the live start clock and separate timeline payload through the durable adapter", async () => {
  const { recorder } = await setup();
  await recorder.activate(123456);
  expect(mutation).toHaveBeenLastCalledWith(api.sessions.activate, { sessionId: "session-test", startedAt: 123456 });
  const timeline = { type: "playback_gate_changed" as const, state: "blocked" as const, reason: "answer_evaluation" };
  await recorder.appendTimeline("timeline_1", 100, timeline);
  expect(mutation).toHaveBeenLastCalledWith(api.sessions.appendEvent, {
    sessionId: "session-test",
    eventKey: "timeline_1",
    atMs: 100,
    timeline,
  });
});
