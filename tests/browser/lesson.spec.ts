import { test, expect, type Page } from "@playwright/test";

type TestState = {
  emit: (event: object) => void;
  disconnect: () => void;
  commands: Record<string, unknown>[];
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
async function mockLive(page: Page, pendingMic = false) {
  await page.route("**/api/live", route =>
    route.fulfill({ json: { session: { id: "test" }, transport: { sdp: "test" } } }),
  );
  await page.addInitScript(
    ({ pendingMic }) => {
      const state: TestState = { commands: [], tracks: [], closed: false, emit: () => {}, disconnect: () => {} };
      window.sproutTest = state;
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
          send: (raw: string) => state.commands.push(JSON.parse(raw)),
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
const commands = (page: Page) => page.evaluate(() => window.sproutTest.commands);
const sentContent = async (page: Page) => (await commands(page)).map(command => String(command.content ?? ""));
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
  await begin(page);
  await expect(page.getByRole("heading")).toHaveCount(0);
  await emit(page, { type: "session.delegation.created", delegation: { id: "scene2", target: "client" } });
  await expect(page.locator('[data-scene="duck-friends"] > span')).toHaveCount(2);
  await expect.poll(async () => (await commands(page)).some(command => command.delegation_id === "scene2")).toBe(true);
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("connection was lost");
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("OPENAI_API_KEY");
  expect(await tracksStopped(page)).toBe(true);
});
