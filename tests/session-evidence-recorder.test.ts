import { afterEach, expect, it, vi } from "vitest";
import { SessionEvidenceRecorder } from "../lib/session-evidence-recorder";
import type { SessionRecorder, Evidence, EndReason } from "../lib/session-recorder";

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const transport = {
    openInput: (fence: (sourceId: number) => void) => {
      fence(1);
      return true;
    },
    startRecording: vi.fn(),
    stopMedia: vi.fn(),
    recording: vi.fn(async () => ({
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
      startOffsetMs: 0,
      durationMs: 1000,
    })),
  };
  const recorder: SessionRecorder = {
    create: vi.fn(async () => "saved"),
    activate: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
    appendTimeline: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
    attachRecording: vi.fn(async () => {}),
    markIncomplete: vi.fn(async () => {}),
  };
  const report = vi.fn();
  const capture = new SessionEvidenceRecorder(transport, recorder, report);
  const scene: Extract<Evidence, { type: "scene_displayed" }> = {
    type: "scene_displayed",
    sceneId: "one-duck",
    targetQuantity: 1,
    items: [{ emoji: "🦆", label: "duck" }],
    arrangement: "row",
  };
  const say = (speaker: "child" | "sprout", delta: string, startMs = 0) =>
    capture.receive({ type: "transcript", speaker, delta, startMs, endMs: startMs + 100, sourceId: 1 });
  capture.create();
  return { capture, transport, recorder, report, scene, say };
}

it("shares the live clock and keeps generated tutor text separate from delivered evidence", async () => {
  const f = fixture();
  f.say("child", "startup");
  await vi.advanceTimersByTimeAsync(2000);
  f.capture.begin();
  f.capture.begin();
  f.capture.displayed(f.scene);
  await vi.advanceTimersByTimeAsync(100);
  f.say("child", "One");
  f.say("sprout", "Yes!");
  f.capture.end("parent_stop");
  await f.capture.recordingSettled();
  expect(f.transport.startRecording).toHaveBeenCalledOnce();
  expect(f.transport.startRecording).toHaveBeenCalledWith(2000);
  const writes = vi.mocked(f.recorder.append).mock.calls;
  expect(writes).toHaveLength(2);
  expect(writes[0][1]).toBe(0);
  expect(writes[1][2]).toMatchObject({
    text: "One",
    recognition: "needs_confirmation",
    sessionTiming: { startMs: 0, endMs: 100 },
  });
  expect(f.recorder.appendTimeline).toHaveBeenCalledWith(
    expect.any(String),
    100,
    expect.objectContaining({ type: "sprout_generated_utterance", text: "Yes!" }),
  );
});

it.each<EndReason>([
  "parent_stop",
  "child_stop",
  "model_goodbye",
  "wrap_up",
  "time_limit",
  "connection_failure",
  "page_hidden",
])(
  "stops media immediately, flushes interrupted evidence once and orders attachment after %s finalization",
  async reason => {
    const f = fixture();
    f.capture.begin();
    f.capture.displayed(f.scene);
    f.say("child", "One");
    f.capture.end(reason);
    f.capture.end(reason);
    f.say("child", "late");
    f.capture.displayed(f.scene);
    expect(f.transport.stopMedia).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    await f.capture.recordingSettled();
    expect(f.recorder.append).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.recorder.append).mock.calls[1][2]).toMatchObject({ text: "One", state: "interrupted" });
    expect(f.recorder.finalize).toHaveBeenCalledExactlyOnceWith(reason, false);
    expect(f.recorder.attachRecording).toHaveBeenCalledOnce();
    expect(vi.mocked(f.recorder.finalize).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(f.recorder.attachRecording).mock.invocationCallOrder[0],
    );
  },
);

it("marks capture and attachment failures incomplete while retaining the ended record", async () => {
  const f = fixture();
  f.transport.startRecording.mockImplementation(() => {
    throw new Error("unsupported");
  });
  vi.mocked(f.recorder.attachRecording).mockRejectedValue(new Error("upload failed"));
  f.capture.begin();
  f.capture.displayed(f.scene);
  f.capture.end("parent_stop");
  await f.capture.recordingSettled();
  expect(f.recorder.finalize).toHaveBeenCalledWith("parent_stop", true);
  expect(f.report.mock.calls.map(([operation]) => operation)).toEqual(["capture", "attachRecording"]);
  expect(f.recorder.markIncomplete).toHaveBeenCalledTimes(2);
});

it("finalizes speaker switches without duplicating the prior turn's quiet timer", async () => {
  const f = fixture();
  f.capture.begin();
  f.capture.displayed(f.scene);
  f.say("child", "One");
  f.say("child", ", two", 100);
  f.say("sprout", "Try again", 200);
  f.say("child", "Three", 400);
  await vi.advanceTimersByTimeAsync(2500);
  f.capture.end("parent_stop");
  await f.capture.recordingSettled();
  expect(
    vi
      .mocked(f.recorder.append)
      .mock.calls.map(([, , evidence]) => (evidence.type === "utterance" ? evidence.text : evidence.type)),
  ).toEqual(["scene_displayed", "One, two", "Three"]);
  expect(f.recorder.appendTimeline).toHaveBeenCalledOnce();
});
