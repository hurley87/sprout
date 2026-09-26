import { test, expect, type Page, type Route } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setupSyntheticMicrophone } from "../../scripts/live/microphone.mjs";
import { createSimulatedChild } from "../../scripts/live/child.mjs";
import { runLiveSession } from "../../scripts/live/runner.mjs";

// Short deterministic PCM tone: exercises decodeAudioData and actual Web Audio rendering.
function wav(seconds = 0.15) {
  const samples = Math.round(48000 * seconds);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin((i * Math.PI) / 60) * 12000), 44 + i * 2);
  return bytes;
}

async function evaluate<T = unknown>(page: Page, expression: string): Promise<T> {
  return page.evaluate<T>(`(${expression})()`);
}

// String evaluation keeps harness-only globals out of production Window types.
const micState = `async () => {
  const first = await navigator.mediaDevices.getUserMedia({ audio: true });
  const second = await navigator.mediaDevices.getUserMedia({ audio: true });
  window.testTrack = first.getAudioTracks()[0];
  window.testPeer = new RTCPeerConnection();
  window.testPeer.addTrack(window.testTrack, first);
  return { sameStream: first === second, sameTrack: window.testTrack === second.getAudioTracks()[0], state: window.testTrack.readyState };
}`;

test("runner installs microphone before page scripts and Start", async () => {
  let cleaned = false;
  await runLiveSession({
    baseUrl: "http://127.0.0.1:3100",
    browserArgs: ["--autoplay-policy=no-user-gesture-required"],
    setupPage: async (page: Page) => {
      await page.route("**/*", (route: Route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<script>
        window.capturedAtStartup = navigator.mediaDevices.getUserMedia({audio:true});
        </script><button onclick="window.started=!!window.__liveMic">Start counting together</button>`,
        }),
      );
      const cleanup = await setupSyntheticMicrophone(page);
      return async () => {
        await cleanup();
        cleaned = true;
      };
    },
    drive: async ({ page }: { page: Page }) => {
      expect(
        await evaluate(
          page,
          `async () => {
        const stream = await window.capturedAtStartup;
        return window.started && stream === await navigator.mediaDevices.getUserMedia({audio:true});
      }`,
        ),
      ).toBe(true);
    },
    collect: async () => null,
  });
  expect(cleaned).toBe(true);
});

test("child calls serialize playback on the same live microphone and WebRTC sender", async ({ page }) => {
  await setupSyntheticMicrophone(page);
  await page.goto("/");
  await page.getByRole("heading").first().click(); // real gesture resumes AudioContext
  await evaluate(page, `() => { window.__liveLog = []; window.__liveNow = () => performance.now(); }`);
  expect(await evaluate(page, micState)).toEqual({ sameStream: true, sameTrack: true, state: "live" });
  let synthesized = 0;
  const child = createSimulatedChild({
    page,
    synthesize: async (_text, path) => {
      synthesized++;
      await writeFile(path, wav());
    },
  });
  const first = child.say("One!");
  const second = child.say("Two!");
  await first;
  expect(await evaluate(page, `() => window.__liveLog.filter(e => e.action === 'playback-end').length`)).toBe(1);
  await second;
  const result = await evaluate<{
    actions: string[];
    starts: string[];
    durations: number[];
    senderSame: boolean;
    state: string;
  }>(
    page,
    `() => ({
    actions: window.__liveLog.filter(e => e.action.startsWith('playback')).map(e => e.action),
    starts: window.__liveLog.filter(e => e.action === 'playback-start').map(e => e.trackId),
    durations: window.__liveLog.filter(e => e.action === 'playback-end').map((end, i) => end.at - window.__liveLog.filter(e => e.action === 'playback-start')[i].at),
    senderSame: window.testPeer.getSenders()[0].track === window.testTrack,
    state: window.testTrack.readyState,
  })`,
  );
  expect(synthesized).toBe(2);
  expect(result.actions).toEqual(["playback-start", "playback-end", "playback-start", "playback-end"]);
  expect(new Set(result.starts).size).toBe(1);
  expect(result.durations.every((ms: number) => ms >= 100)).toBe(true);
  expect(result.senderSame).toBe(true);
  expect(result.state).toBe("live");
  await child.close();
  expect(await evaluate(page, `() => window.testTrack.readyState`)).toBe("ended");
  await expect(child.say("Three!")).rejects.toThrow("closed");
  await evaluate(page, `() => window.testPeer.close()`);
});

test("cleanup rejects active and queued speech and synthesis failure can be retried", async ({ page }) => {
  await setupSyntheticMicrophone(page);
  await page.goto("/");
  await page.getByRole("heading").first().click();
  await evaluate(page, `() => { window.__liveLog = []; window.__liveNow = () => performance.now(); }`);
  let fail = true;
  const child = createSimulatedChild({
    page,
    synthesize: async (_text, path) => {
      if (fail) {
        fail = false;
        throw new Error("TTS failed");
      }
      await writeFile(path, wav(2));
    },
  });
  await expect(child.say("One!")).rejects.toThrow("TTS failed");
  const active = child.say("Two!");
  const queued = child.say("Three!");
  const rejected = Promise.all([expect(active).rejects.toThrow("closed"), expect(queued).rejects.toThrow("closed")]);
  await page.waitForFunction(`window.__liveLog.some(e => e.action === 'playback-start')`);
  await child.close();
  await rejected;
  expect(await evaluate(page, `() => window.__liveLog.filter(e => e.action === 'playback-start').length`)).toBe(1);
});
