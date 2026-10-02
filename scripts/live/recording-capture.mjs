/** Test-only mirror of MediaRecorder bytes. The app's recorder still receives every event unchanged. */
export function installMediaRecorderCapture() {
  const NativeRecorder = window.MediaRecorder;
  const captures = [];
  const captureByRecorder = new WeakMap();
  Object.defineProperty(window, "__liveAudioCaptures", { configurable: false, value: captures });
  window.MediaRecorder = class extends NativeRecorder {
    constructor(...args) {
      super(...args);
      const parts = [];
      const capture = {
        mimeType: this.mimeType,
        startedAtPerformanceMs: null,
        startedAtPageMs: null,
        stoppedAtPerformanceMs: null,
        blob: null,
      };
      captures.push(capture);
      captureByRecorder.set(this, capture);
      this.addEventListener("dataavailable", event => {
        if (event.data?.size) parts.push(event.data);
      });
      this.addEventListener("stop", () => {
        capture.stoppedAtPerformanceMs = performance.now();
        capture.blob = new Blob(parts, { type: this.mimeType || parts[0]?.type });
      });
    }

    start(...args) {
      const capture = captureByRecorder.get(this);
      capture.startedAtPerformanceMs = performance.now();
      capture.startedAtPageMs = window.__liveNow?.() ?? null;
      return super.start(...args);
    }
  };
}
