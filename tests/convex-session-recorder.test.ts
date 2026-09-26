import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "../convex/_generated/api";
import { ConvexSessionRecorder } from "../lib/convex-session-recorder";
const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mutation;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mutation.mockReset();
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
