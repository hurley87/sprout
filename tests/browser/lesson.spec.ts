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

async function mockLive(page: Page, pendingMic = false) {
  await page.route("**/api/live", route =>
    route.fulfill({ json: { session: { id: "test" }, transport: { sdp: "test" } } }),
  );
  // No lesson reaches the real evaluation service; tests that care override this.
  await mockEvaluate(page, 0);
  await page.addInitScript(
    ({ pendingMic }) => {
      const state: TestState = {
        commands: [],
        shownAt: {},
        tracks: [],
        closed: false,
        emit: () => {},
        disconnect: () => {},
      };
      window.sproutTest = state;
      // Provider mock has a continuous fake microphone waveform, not utterances.
      // Exercise the transcript fallback here; microphone VAD is covered by session tests.
      Object.defineProperty(window, "AudioContext", {
        value: class {
          constructor() {
            throw new Error("synthetic microphone");
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
          state.emit = event => this.channel.onmessage?.({ data: JSON.stringify(event) });
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
          state.emit({ type: "session.started" });
        }
        close() {
          state.closed = true;
          this.connectionState = "closed";
          this.onconnectionstatechange?.();
        }
      }
      window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
    },
    { pendingMic },
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
  expect(errors).toEqual([]);
});

test("a correct count waits for Sprout's substantive old-scene turn to finish", async ({ page }) => {
  await mockLive(page);
  let evaluations = 0;
  await page.route("**/api/evaluate", route => {
    evaluations++;
    return route.fulfill({ json: { probability: 0.95, model: "jev-test" } });
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
  await expect(page.locator('[data-scene="duck-friends"]')).toBeVisible();
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
