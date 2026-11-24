// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceDemo } from "@/components/voice-demo/use-voice-demo";
import { DINO_CAR_CRUNCH_LESSON } from "@/lib/lesson-runtime/dino-car-crunch-lesson";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";

const { attempts } = vi.hoisted(() => ({ attempts: [] as Array<{ stop: () => void }> }));

vi.mock("@/lib/lesson-runtime/lesson-runtime", () => ({
  LessonRuntime: class {
    private readonly id = crypto.randomUUID();
    private status: LessonSnapshot["status"] = "prepared";

    constructor(
      _audio: HTMLAudioElement,
      private readonly publish: (snapshot: object) => void,
    ) {
      attempts.push(this);
    }

    snapshot() {
      return { status: this.status, runtime: { runtimeId: this.id } };
    }

    stop() {
      this.status = "ended";
      this.publish(this.snapshot());
    }
  },
}));

describe("useVoiceDemo session saving", () => {
  const lesson = DINO_CAR_CRUNCH_LESSON;
  const fetchSession = vi.fn<typeof fetch>();
  let root: ReturnType<typeof createRoot>;
  let demo: ReturnType<typeof useVoiceDemo>;

  beforeEach(() => {
    attempts.length = 0;
    fetchSession.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSession);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount(saveSession?: boolean, text = "session diagnostics") {
    function Harness() {
      demo = useVoiceDemo({
        lesson,
        saveSession,
        exportPrefix: "test",
        exportReport: runtime => ({ text, source: runtime.snapshot().runtime?.runtimeId, apiKey: "scrub me" }),
      });
      return createElement("audio", { ref: demo.audio });
    }
    act(() => root.render(createElement(Harness)));
    act(() => demo.start());
  }

  it("posts the scrubbed report once per runtime and posts again after Play again", async () => {
    mount(true);
    const firstId = demo.snapshot?.runtime?.runtimeId;
    await act(async () => demo.stop());
    expect(fetchSession).toHaveBeenCalledExactlyOnceWith("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        lessonId: lesson.id,
        runtimeId: firstId,
        report: { text: "session diagnostics", source: firstId },
      }),
    });
    await act(async () => attempts[0].stop());
    expect(fetchSession).toHaveBeenCalledTimes(1);

    act(() => demo.start());
    const secondId = demo.snapshot?.runtime?.runtimeId;
    expect(secondId).not.toBe(firstId);
    await act(async () => {
      attempts[0].stop();
      demo.stop();
    });
    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchSession.mock.calls[1][1]?.body))).toEqual({
      lessonId: lesson.id,
      runtimeId: secondId,
      report: { text: "session diagnostics", source: secondId },
    });
  });

  it.each([false, undefined])("skips uploads when saveSession is %s", async saveSession => {
    mount(saveSession);
    await act(async () => demo.stop());
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it.each(["visibilitychange", "pagehide"])("starts the upload synchronously on %s", async event => {
    mount(true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      const target = event === "pagehide" ? window : document;
      target.dispatchEvent(new Event(event));
      expect(fetchSession).toHaveBeenCalledTimes(1);
    });
  });

  it("drops keepalive based on UTF-8 byte size", async () => {
    mount(true, "🦕".repeat(15_000));
    await act(async () => demo.stop());
    expect(fetchSession).toHaveBeenCalledTimes(1);
    expect(fetchSession.mock.calls[0][1]).not.toHaveProperty("keepalive");
  });

  it.each(["network", "HTTP"])("warns without throwing on %s failure", async failure => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "network") fetchSession.mockRejectedValueOnce(new Error("private details"));
    else fetchSession.mockResolvedValueOnce(new Response("private details", { status: 502 }));

    mount(true);
    await act(async () => demo.stop());
    expect(demo.snapshot?.status).toBe("ended");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      failure === "network" ? "Could not save the Sprout session." : "Could not save the Sprout session (HTTP 502).",
    );
  });
});
