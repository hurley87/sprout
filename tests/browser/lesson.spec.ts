import { test, expect, type Page } from "@playwright/test";

type TestState = {
  emit: (event: object) => void;
  disconnect: () => void;
  /** Each command carries `at`, so scene/speech ordering can be checked. */
  commands: Record<string, unknown>[];
  /** When each scene id first reached the DOM, on the same clock. */
  shownAt: Record<string, number>;
  tracks: MediaStreamTrack[];
  closed: boolean;
  recordingsStarted: number;
  peerCount: number;
  persistence: string[];
  releaseMic?: () => void;
};

declare global {
  interface Window {
    sproutTest: TestState;
  }
}

// This harness replaces ONLY the provider transport. getUserMedia and its
// tracks are real Chromium APIs backed by Chromium's synthetic microphone.
/** Later routes win in Playwright, so a test can override this default. */
async function mockEvaluate(page: Page, probability: number) {
  await page.route("**/api/evaluate", route => route.fulfill({ json: { probability, model: "jev-test" } }));
}

async function mockLive(page: Page, pendingMic = false, pendingReplacement = false) {
  await page.route("**/api/query", route => route.fulfill({ json: { status: "success", value: null } }));
  await page.route("**/api/mutation", async route => {
    const { path } = route.request().postDataJSON();
    await page.evaluate(path => window.sproutTest.persistence.push(path), path);
    const value =
      path === "sessions:generateUploadUrl"
        ? "https://audio-test.invalid/upload"
        : path === "sessions:create"
          ? "session-test"
          : null;
    await route.fulfill({ json: { status: "success", value } });
  });
  await page.route("https://audio-test.invalid/upload", route =>
    route.fulfill({ json: { storageId: "storage-test" } }),
  );
  await page.route("**/api/live", route =>
    route.fulfill({ json: { session: { id: "test" }, transport: { sdp: "test" } } }),
  );
  // No lesson reaches the real evaluation service; tests that care override this.
  await mockEvaluate(page, 0);
  await page.addInitScript(
    ({ pendingMic, pendingReplacement }) => {
      const state: TestState = {
        recordingsStarted: 0,
        peerCount: 0,
        persistence: [],
        commands: [],
        shownAt: {},
        tracks: [],
        closed: false,
        emit: () => {},
        disconnect: () => {},
      };
      window.sproutTest = state;
      const NativeMediaRecorder = window.MediaRecorder;
      window.MediaRecorder = class extends NativeMediaRecorder {
        start(timeslice?: number) {
          state.recordingsStarted++;
          super.start(timeslice);
        }
      };
      // Provider mock has a continuous fake microphone waveform, not utterances.
      // Exercise the transcript fallback here; microphone VAD is covered by session tests.
      const NativeAudioContext = window.AudioContext;
      Object.defineProperty(window, "AudioContext", {
        value: class extends NativeAudioContext {
          createAnalyser(): AnalyserNode {
            const analyser = super.createAnalyser();
            analyser.getFloatTimeDomainData = samples => samples.fill(0);
            return analyser;
          }
        },
      });
      new MutationObserver(() => {
        const scene = document.querySelector("[data-scene]")?.getAttribute("data-scene");
        if (scene && !(scene in state.shownAt)) state.shownAt[scene] = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true });
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await getUserMedia(constraints);
        state.tracks.push(...stream.getTracks());
        if (pendingMic)
          await new Promise<void>(resolve => {
            state.releaseMic = resolve;
          });
        return stream;
      };
      class Peer {
        sourceNumber = ++state.peerCount;
        localDescription = { sdp: "v=0\r\n" };
        iceGatheringState = "complete";
        connectionState = "connected";
        ontrack?: (event: { track: MediaStreamTrack }) => void;
        onconnectionstatechange?: () => void;
        channel = {
          readyState: "open",
          onmessage: null as ((event: { data: string }) => void) | null,
          onclose: null as (() => void) | null,
          onerror: null,
          send: (raw: string) => state.commands.push({ ...JSON.parse(raw), at: performance.now() }),
          close: () => {
            this.channel.readyState = "closed";
            this.channel.onclose?.();
          },
        };
        constructor() {
          if (this.sourceNumber === 1) state.emit = event => this.channel.onmessage?.({ data: JSON.stringify(event) });
          state.disconnect = () => {
            this.connectionState = "failed";
            this.onconnectionstatechange?.();
          };
        }
        addTrack() {}
        createDataChannel() {
          return this.channel;
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\n" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {
          const remote = state.tracks[0].clone();
          state.tracks.push(remote);
          this.ontrack?.({ track: remote });
          if (!pendingReplacement || this.sourceNumber === 1)
            this.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
        }
        close() {
          state.closed = true;
          this.connectionState = "closed";
          this.onconnectionstatechange?.();
        }
      }
      window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
    },
    { pendingMic, pendingReplacement },
  );
}
const emit = (page: Page, event: object) => page.evaluate(event => window.sproutTest.emit(event), event);
const say = (page: Page, delta: string, start_ms = 0) =>
  emit(page, { type: "session.input_transcript.delta", delta, start_ms, end_ms: start_ms + 500 });
const commands = (page: Page) => page.evaluate(() => window.sproutTest.commands);
const sentContent = async (page: Page) => (await commands(page)).map(command => String(command.content ?? ""));
/** The app telling GPT-Live the scene stayed, which ends its answer-check pause. */
const releases = async (page: Page) => (await sentContent(page)).filter(text => text.includes("has not changed"));
const tracksStopped = (page: Page) =>
  page.evaluate(() => window.sproutTest.tracks.every(track => track.readyState === "ended"));

async function begin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start counting together" }).click();
  await expect(page.locator('[data-scene="hello-duck"]')).toBeVisible();
  await expect.poll(async () => (await commands(page)).length).toBeGreaterThan(0);
}

test("parent start, committed scene, stop, late actions, and diagnostics export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockLive(page);
  await mockEvaluate(page, 0.95);
  await begin(page);
  await expect(page.getByRole("heading")).toHaveCount(0);
  expect(await page.evaluate(() => window.sproutTest.recordingsStarted)).toBe(1);
  await say(page, "One!");
  await expect(page.locator('[data-scene="duck-friends"] > span')).toHaveCount(2);
  await expect.poll(async () => (await sentContent(page)).some(text => text.includes("2 ducks"))).toBe(true);
  // The model is told about the new group only after the app has displayed it.
  const { shownAt, told } = await page.evaluate(() => ({
    shownAt: window.sproutTest.shownAt["duck-friends"],
    told: window.sproutTest.commands.find(command => String(command.content ?? "").includes("2 ducks"))?.at as number,
  }));
  expect(told).toBeGreaterThanOrEqual(shownAt);
  expect(await releases(page)).toEqual([]);
  await page.getByRole("button", { name: "End lesson" }).click();
  await expect(page.getByText("The microphone and voice playback are off.")).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused && audio.srcObject === null),
  ).toBe(true);
  await emit(page, { type: "session.delegation.created", delegation: { id: "late", target: "client" } });
  await expect(page.locator("[data-scene]")).toHaveCount(0);
  await page.getByText("Parent testing notes").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download attempt diagnostics" }).click();
  expect((await download).suggestedFilename()).toMatch(/^sprout-attempt-/);
  await expect.poll(() => page.evaluate(() => window.sproutTest.persistence)).toContain("sessions:attachRecording");
  const persistence = await page.evaluate(() => window.sproutTest.persistence);
  expect(persistence.indexOf("sessions:generateUploadUrl")).toBeGreaterThan(persistence.indexOf("sessions:finalize"));
  expect(errors).toEqual([]);
});

test("a correct count commits once and holds its response until output transcript quiet", async ({ page }) => {
  await mockLive(page);
  let evaluations = 0;
  let finishEvaluation!: () => Promise<void>;
  await page.route("**/api/evaluate", async route => {
    evaluations++;
    await new Promise<void>(resolve => {
      finishEvaluation = async () => {
        await route.fulfill({ json: { probability: 0.95, model: "jev-test" } });
        resolve();
      };
    });
  });
  await begin(page);
  const before = (await commands(page)).length;
  await say(page, "One!");
  await emit(page, {
    type: "session.output_transcript.delta",
    delta: "Let's count the duck together",
    start_ms: 800,
    end_ms: 1300,
  });
  await expect.poll(() => evaluations).toBe(1);
  await expect(page.locator('[data-scene="hello-duck"]')).toBeVisible();
  expect(await commands(page)).toHaveLength(before);
  await emit(page, {
    type: "session.output_transcript.delta",
    delta: ". There is one duck.",
    start_ms: 1800,
    end_ms: 2300,
  });
  await finishEvaluation();
  await expect(page.locator('[data-scene="duck-friends"]')).toBeVisible();
  expect(await commands(page)).toHaveLength(before);
  await expect.poll(async () => (await sentContent(page)).filter(text => text.includes("2 ducks"))).toHaveLength(1);
  expect(evaluations).toBe(1);
  expect(await releases(page)).toEqual([]);
  const { shownAt, told } = await page.evaluate(() => ({
    shownAt: window.sproutTest.shownAt["duck-friends"],
    told: window.sproutTest.commands.find(command => String(command.content ?? "").includes("2 ducks"))?.at as number,
  }));
  expect(told).toBeGreaterThanOrEqual(shownAt);
});

test("an unconvincing count keeps the scene and releases GPT-Live on it", async ({ page }) => {
  await mockLive(page);
  await mockEvaluate(page, 0.4);
  await begin(page);
  const before = (await commands(page)).length;
  await say(page, "Five!");
  await expect.poll(() => releases(page)).toEqual([expect.stringContaining("still shows 1 duck")]);
  await expect(page.locator('[data-scene="hello-duck"] > span')).toHaveCount(1);
  expect(await commands(page)).toHaveLength(before + 1);
  // Speech GPT-Live was never asked to pause for is left to it.
  await say(page, "I have a dinosaur!", 10_000);
  await page.waitForTimeout(2500);
  expect(await commands(page)).toHaveLength(before + 1);
});

test("a timed-out evaluation keeps the scene and releases GPT-Live neutrally", async ({ page }) => {
  await mockLive(page);
  await page.route("**/api/evaluate", () => {});
  await begin(page);
  await say(page, "One!");
  await expect.poll(() => releases(page), { timeout: 8000 }).toHaveLength(1);
  expect((await releases(page))[0]).toContain("could not verify");
  expect((await releases(page))[0]).toContain("count this group again");
  expect((await releases(page))[0]).not.toContain("Respond to the child's answer");
  await expect(page.locator('[data-scene="hello-duck"]')).toBeVisible();
});

test("fragmented child stop releases the microphone immediately", async ({ page }) => {
  await mockLive(page);
  await begin(page);
  await emit(page, { type: "session.input_transcript.delta", delta: "I want to ", start_ms: 0, end_ms: 500 });
  await emit(page, { type: "session.input_transcript.delta", delta: "stop", start_ms: 500, end_ms: 900 });
  await expect(page.getByRole("heading", { name: "Bye for now." })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
});

test("connection failure preserves a retryable explanation and stops capture", async ({ page }) => {
  await mockLive(page);
  await begin(page);
  await page.evaluate(() => window.sproutTest.disconnect());
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "connection was lost" })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
  await expect(page.getByRole("button", { name: "Start a new lesson" })).toBeVisible();
});

test("stop while microphone permission is pending cleans up the late stream", async ({ page }) => {
  await mockLive(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Start counting together" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.sproutTest.releaseMic))).toBe(true);
  await page.getByRole("button", { name: "End lesson" }).click();
  await page.evaluate(() => window.sproutTest.releaseMic?.());
  await expect.poll(() => tracksStopped(page)).toBe(true);
  await expect(page.getByRole("heading", { name: "Bye for now." })).toBeVisible();
});

test("natural timing asks for wrap-up and goodbye, then stops without a model response", async ({ page }) => {
  await mockLive(page);
  await page.clock.install();
  await begin(page);
  await page.clock.fastForward(270_000);
  await expect.poll(async () => (await sentContent(page)).some(text => text.includes("four and a half"))).toBe(true);
  await page.clock.fastForward(30_000);
  await expect
    .poll(async () => (await sentContent(page)).some(text => text.includes("Say a brief warm goodbye")))
    .toBe(true);
  await page.clock.fastForward(8000);
  await expect(page.getByRole("heading", { name: "Bye for now." })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
});

test("missing server configuration is explained and releases real microphone tracks", async ({ page }) => {
  await mockLive(page);
  await page.unroute("**/api/live");
  // Fixed error response keeps the suite independent of the developer's key.
  await page.route("**/api/live", route =>
    route.fulfill({ status: 503, json: { error: "Sprout needs OPENAI_API_KEY configured on this computer." } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Start counting together" }).click();
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "OPENAI_API_KEY" })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
});

test("inspects pending then complete canonical evidence, seeks audio, retries and starts unlinked", async ({
  page,
}) => {
  await mockLive(page);
  type DurableRecord = {
    session: {
      _id: string;
      state: string;
      recordStatus: string;
      createdAt: number;
      startedAt?: number;
      endedAt?: number;
      endingReason?: string;
      retryOf?: string;
      recording?: { storageId: string; mimeType: string; startOffsetMs: number; durationMs: number };
    };
    events: { eventKey: string; order: number; atMs: number; evidence?: object; timeline?: object }[];
    recordingUrl: string | null;
  };
  const records = new Map<string, DurableRecord>();
  const creates: { retryOf?: string }[] = [];
  let pending = true;
  let seekTimestamp = 12300;
  await page.route("**/api/mutation", async route => {
    const {
      path,
      args: [args],
    } = route.request().postDataJSON();
    const record = records.get(args.sessionId);
    let value: string | null = null;
    if (path === "sessions:create") {
      creates.push(args);
      value = `attempt-${creates.length}`;
      records.set(value, {
        session: {
          _id: value,
          state: "starting",
          recordStatus: "pending",
          createdAt: Date.now(),
          retryOf: args.retryOf,
        },
        events: [],
        recordingUrl: null,
      });
    } else if (path === "sessions:activate" && record) {
      record.session.state = "active";
      record.session.startedAt = args.startedAt ?? Date.now();
    } else if (path === "sessions:appendEvent" && record) {
      record.events.push({
        eventKey: args.eventKey,
        order: record.events.length,
        atMs: args.atMs,
        evidence: args.evidence,
        timeline: args.timeline,
      });
    } else if (path === "sessions:finalize" && record) {
      record.session.state = "ended";
      record.session.endingReason = args.endingReason;
      record.session.endedAt = Date.now();
    } else if (path === "sessions:generateUploadUrl") value = "https://audio-test.invalid/upload";
    else if (path === "sessions:attachRecording" && record) {
      record.session.recordStatus = "complete";
      record.session.recording = {
        storageId: args.storageId,
        mimeType: args.mimeType,
        startOffsetMs: 0,
        durationMs: 20000,
      };
      record.recordingUrl = "https://audio-test.invalid/full.wav";
    }
    await route.fulfill({ json: { status: "success", value } });
  });
  await page.route("**/api/query", async route => {
    const {
      args: [{ sessionId }],
    } = route.request().postDataJSON();
    const stored = records.get(sessionId);
    const value = stored ? structuredClone(stored) : null;
    if (pending && value) {
      value.session.recordStatus = "pending";
      delete value.session.recording;
      value.recordingUrl = null;
    }
    // A fixture timestamp exercises the canonical seek action without a 12-second browser wait.
    if (value?.session.recording) value.events[0].atMs = seekTimestamp;
    await route.fulfill({ json: { status: "success", value } });
  });
  const wav = Buffer.alloc(44 + 8000 * 30 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await page.route("https://audio-test.invalid/full.wav", route => {
    const range = route
      .request()
      .headers()
      ["range"]?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : wav.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      headers: {
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` } : {}),
      },
      body: wav.subarray(start, end + 1),
    });
  });
  await begin(page);
  await emit(page, { type: "session.output_transcript.delta", delta: "Hello friend", start_ms: 100, end_ms: 400 });
  await page.getByRole("button", { name: "End lesson" }).click();
  const inspector = page.getByRole("region", { name: "Durable session record" });
  await expect(inspector.getByText("Record still pending", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Scene actually displayed: hello-duck", { exact: false })).toBeVisible();
  await expect(inspector.getByText("Full-session audio unavailable.")).toBeVisible();
  await expect.poll(() => records.get("attempt-1")?.session.recordStatus).toBe("complete");
  pending = false;
  await inspector.getByRole("button", { name: "Refresh record" }).click();
  await expect(inspector.getByText("Record complete", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Generated by Sprout · Delivery not established", { exact: false })).toBeVisible();
  await expect(inspector.getByText("Sprout playback permitted", { exact: false })).toBeVisible();
  const player = inspector.locator("audio");
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBe(4);
  await inspector
    .locator("li")
    .filter({ hasText: "Event 0 ·" })
    .getByRole("button", { name: "Play from here" })
    .click();
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(12.3);
  const position = await player.evaluate((audio: HTMLAudioElement) => {
    audio.pause();
    return audio.currentTime;
  });
  expect(position).toBeGreaterThanOrEqual(12.3);
  expect(position).toBeLessThan(13);
  seekTimestamp = 30000;
  await inspector.getByRole("button", { name: "Refresh record" }).click();
  await expect(inspector.getByText("Event 0 · 30000 ms from session.started")).toBeVisible();
  await inspector
    .locator("li")
    .filter({ hasText: "Event 0 ·" })
    .getByRole("button", { name: "Play from here" })
    .click();
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(20);
  const clampedPosition = await player.evaluate((audio: HTMLAudioElement) => {
    audio.pause();
    return audio.currentTime;
  });
  expect(clampedPosition).toBeLessThan(21);
  await page.screenshot({ path: "test-results/session-inspector.png", fullPage: true });
  const original = structuredClone(records.get("attempt-1"));
  const previousTracks = await page.evaluate(() => window.sproutTest.tracks.length);
  await inspector.getByRole("button", { name: "Retry this lesson" }).click();
  await expect(page.locator('[data-scene="hello-duck"]')).toBeVisible();
  expect(creates).toEqual([{}, { retryOf: "attempt-1" }]);
  expect(records.get("attempt-2")?.session._id).not.toBe("attempt-1");
  expect(records.get("attempt-1")).toEqual(original);
  expect(await page.evaluate(() => window.sproutTest.recordingsStarted)).toBe(2);
  expect(
    await page.evaluate(() => window.sproutTest.tracks.slice(0, 2).every(track => track.readyState === "ended")),
  ).toBe(true);
  expect(await page.evaluate(() => window.sproutTest.tracks.length)).toBeGreaterThan(previousTracks);
  await page.getByRole("button", { name: "End lesson" }).click();
  await expect(inspector.getByText("Retry of attempt-1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start a new lesson" }).click();
  await expect(page.locator('[data-scene="hello-duck"]')).toBeVisible();
  expect(creates).toEqual([{}, { retryOf: "attempt-1" }, {}]);
  expect(records.get("attempt-1")).toEqual(original);
  await page.getByRole("button", { name: "End lesson" }).click();
});

test("failed durable creation leaves diagnostics available and offers no retry", async ({ page }) => {
  await mockLive(page);
  await page.route("**/api/mutation", route => route.fulfill({ json: { status: "error", errorMessage: "offline" } }));
  await begin(page);
  await page.getByRole("button", { name: "End lesson" }).click();
  await expect(page.getByText("Durable session record unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry this lesson" })).toHaveCount(0);
  await page.getByText("Parent testing notes", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Download attempt diagnostics" })).toBeVisible();
});

test("fragmented stale output and pending replacement cannot extend the original recovery budget", async ({ page }) => {
  await mockLive(page, false, true);
  await mockEvaluate(page, 0.95);
  await page.clock.install();
  await begin(page);
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
  await say(page, "One!");
  await emit(page, { type: "session.output_transcript.delta", delta: "Old duck guidance", start_ms: 100, end_ms: 300 });
  await page.clock.runFor(1800);
  await page.clock.runFor(100);
  await expect(page.locator('[data-scene="duck-friends"]')).toBeVisible();
  for (let i = 0; i < 17; i++) {
    await emit(page, {
      type: "session.output_transcript.delta",
      delta: " stale praise",
      start_ms: 500 + i * 800,
      end_ms: 800 + i * 800,
    });
    await page.clock.runFor(700);
    expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(true);
  }
  expect((await sentContent(page)).filter(text => text.includes("2 ducks"))).toHaveLength(0);
  expect(await page.evaluate(() => window.sproutTest.peerCount)).toBe(2);
  await page.clock.runFor(1300);
  await expect(page.getByRole("alert").filter({ hasText: "could not safely resume" })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.srcObject === null && audio.paused),
  ).toBe(true);
  const before = (await commands(page)).length;
  await emit(page, { type: "session.instructions.appended", client_event_id: "late" });
  await emit(page, { type: "session.output_transcript.delta", delta: "late success", start_ms: 20000, end_ms: 20500 });
  await page.clock.runFor(5000);
  expect(await commands(page)).toHaveLength(before);
});

test("a revised STAY remains muted and sends only the context for the committed displayed scene", async ({ page }) => {
  await mockLive(page);
  await page.clock.install();
  let evaluations = 0;
  await page.route("**/api/evaluate", route =>
    route.fulfill({ json: { probability: evaluations++ === 0 ? 0 : 0.95, model: "jev-test" } }),
  );
  await begin(page);
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
  await say(page, "Five");
  await emit(page, { type: "session.output_transcript.delta", delta: "stale correction", start_ms: 100, end_ms: 300 });
  await page.clock.runFor(1800);
  await expect.poll(() => evaluations).toBe(1);
  await page.clock.runFor(100);
  await say(page, " no one", 500);
  await emit(page, {
    type: "session.output_transcript.delta",
    delta: "late stale correction",
    start_ms: 1500,
    end_ms: 1800,
  });
  await page.clock.runFor(1800);
  await expect.poll(() => evaluations).toBe(2);
  await page.clock.runFor(100);
  await expect(page.locator('[data-scene="duck-friends"]')).toBeVisible();
  expect(await releases(page)).toEqual([]);
  expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(true);
  await page.clock.runFor(1000);
  await expect.poll(async () => (await sentContent(page)).filter(text => text.includes("2 ducks")).length).toBe(1);
  expect(await releases(page)).toEqual([]);
  const ordered = await page.evaluate(
    () =>
      Number(window.sproutTest.commands.find(command => String(command.content ?? "").includes("2 ducks"))?.at) >=
      window.sproutTest.shownAt["duck-friends"],
  );
  expect(ordered).toBe(true);
  await page.getByRole("button", { name: "End lesson" }).click();
});

test("failed outcome steering tears down playback while the gate is blocked", async ({ page }) => {
  await mockLive(page);
  await page.clock.install();
  await begin(page);
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
  await page.evaluate(() => {
    const originalPush = window.sproutTest.commands.push.bind(window.sproutTest.commands);
    window.sproutTest.commands.push = (...commands) => {
      if (commands.some(command => String(command.content ?? "").includes("has not changed")))
        throw new Error("steering failed");
      return originalPush(...commands);
    };
  });
  await say(page, "Five");
  await page.clock.runFor(1800);
  await page.clock.runFor(300);
  await expect(page.getByRole("alert").filter({ hasText: "voice connection was lost" })).toBeVisible();
  expect(await tracksStopped(page)).toBe(true);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.srcObject === null && audio.paused),
  ).toBe(true);
});
