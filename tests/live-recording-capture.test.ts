import { afterEach, expect, it, vi } from "vitest";
import { installMediaRecorderCapture } from "../scripts/live/recording-capture.mjs";

class FakeMediaRecorder extends EventTarget {
  readonly mimeType = "audio/webm";
  start() {
    this.dispatchEvent(new Event("start"));
  }
  finish(value: string) {
    const data = new Event("dataavailable");
    Object.defineProperty(data, "data", { value: new Blob([value], { type: this.mimeType }) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event("stop"));
  }
}

afterEach(() => vi.unstubAllGlobals());

it("associates MediaRecorder bytes and clocks with the recorder that produced them", async () => {
  let pageClock = 10;
  vi.stubGlobal("window", {
    MediaRecorder: FakeMediaRecorder,
    __liveNow: () => pageClock,
  });
  installMediaRecorderCapture();
  const browserWindow = window as unknown as {
    MediaRecorder: new (stream: MediaStream) => FakeMediaRecorder;
    __liveAudioCaptures: { startedAtPageMs: number; stoppedAtPerformanceMs: number; blob: Blob }[];
  };
  const first = new browserWindow.MediaRecorder({} as MediaStream);
  const second = new browserWindow.MediaRecorder({} as MediaStream);
  first.start();
  pageClock = 20;
  second.start();
  second.finish("second-recorder");
  pageClock = 30;
  first.finish("first-recorder");
  const captures = browserWindow.__liveAudioCaptures;
  expect(captures.map(capture => capture.startedAtPageMs)).toEqual([10, 20]);
  expect(await captures[0].blob.text()).toBe("first-recorder");
  expect(await captures[1].blob.text()).toBe("second-recorder");
  expect(captures.every(capture => Number.isFinite(capture.stoppedAtPerformanceMs))).toBe(true);
});
