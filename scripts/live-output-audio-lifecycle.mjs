/** Billed investigation of raw GPT-Live WebRTC events; no LessonSession/Jev.
 * Start the configured local app first. No credentials are read or exported.
 * BASE_URL=http://127.0.0.1:3000 node scripts/live-output-audio-lifecycle.mjs
 */
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { setupSyntheticMicrophone } from "./live/microphone.mjs";
import { createSimulatedChild } from "./live/child.mjs";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.LIVE_OUT ?? `test-results/output-audio-lifecycle/${Date.now()}`;
const result = { date: new Date().toISOString(), baseURL, clock: "browser.performance.now", prompts: [] };
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
let cleanup;
let child;
console.log("BILLED: one real GPT-Live-1 WebRTC session, two synthetic spoken prompts; raw events saved locally.");
try {
  cleanup = await setupSyntheticMicrophone(page);
  await page.route("**/audio-lifecycle-probe/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (name === "index") {
      await route.fulfill({
        contentType: "text/html",
        body: `<button>Start</button><audio></audio><script type="module">
          import { BrowserTransport } from './browser-transport';
          window.Transport = BrowserTransport;
        </script>`,
      });
      return;
    }
    const source = await readFile(path.join(process.cwd(), "lib", name.endsWith(".mjs") ? name : `${name}.ts`), "utf8");
    await route.fulfill({
      contentType: "text/javascript",
      body: ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText,
    });
  });
  await page.goto(`${baseURL}/audio-lifecycle-probe/index`);
  await page.waitForFunction("typeof window.Transport === 'function'");
  await page.evaluate(() => {
    window.raw = [];
    window.events = [];
    window.failures = [];
    window.__liveLog = [];
    window.__liveNow = () => performance.now();
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) {
        super(...args);
        window.peer = this;
      }
    };
    window.transport = new window.Transport(document.querySelector("audio"));
    window.transport.setRawServerEventSink(event => window.raw.push(event));
    document.querySelector("button").onclick = () => {
      window.starting = window.transport
        .start(
          event => window.events.push({ at: performance.now(), ...event }),
          message => window.failures.push(message),
        )
        .catch(() => window.failures.push("Transport startup failed"));
    };
  });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    "window.events.some(event => event.type === 'session.started') || window.failures.length",
    null,
    { timeout: 35000 },
  );
  await page.evaluate(() => window.starting);
  if (await page.evaluate(() => window.failures.length)) throw new Error("Live transport startup failed");
  result.model = await page.evaluate(
    () => JSON.parse(window.raw.find(event => JSON.parse(event.data).type === "session.started").data).session.model,
  );
  if (result.model !== "gpt-live-1") throw new Error("Provider did not confirm gpt-live-1");
  if (!(await page.evaluate(() => window.transport.openInput(() => {}))))
    throw new Error("Microphone input did not open");
  child = createSimulatedChild({ page });
  for (const text of [
    "Hi Sprout! Please say hello and tell me what we're counting.",
    "Can you tell me a little about ducks?",
  ]) {
    const at = await page.evaluate(() => performance.now());
    result.prompts.push({ text, at, observationMs: 20000 });
    await child.say(text);
    // A bounded collection window, never a playback-completion proxy.
    await page.waitForTimeout(20000);
    console.log(`Collected raw server events after synthetic prompt ${result.prompts.length}.`);
  }
  result.media = await page.evaluate(async () => {
    const stats = [...(await window.peer.getStats()).values()];
    const audio = document.querySelector("audio");
    return {
      sourceId: window.transport.activeSourceId,
      connectionState: window.peer.connectionState,
      playbackAttached: !!audio.srcObject,
      paused: audio.paused,
      muted: audio.muted,
      inbound: stats
        .filter(stat => stat.type === "inbound-rtp" && stat.kind === "audio")
        .map(stat => ({
          bytesReceived: stat.bytesReceived,
          packetsReceived: stat.packetsReceived,
          totalSamplesReceived: stat.totalSamplesReceived,
        })),
    };
  });
  await page.evaluate(() => window.transport.send({ type: "session.close", event_id: "audio-lifecycle-probe-close" }));
  await page.waitForFunction("window.events.some(event => event.type === 'session.closed')", null, { timeout: 5000 });
} catch {
  // Never export arbitrary provider/HTTP error bodies or credentials.
  result.failure = "Probe did not complete; inspect the locally captured events.";
  process.exitCode = 1;
} finally {
  const captured = await page
    .evaluate(() => ({
      raw: window.raw ?? [],
      events: window.events ?? [],
      failures: window.failures ?? [],
      child: window.__liveLog ?? [],
    }))
    .catch(() => ({ raw: [], events: [], failures: [], child: [] }));
  Object.assign(result, captured);
  const types = {};
  const lifecycle = [];
  for (const message of captured.raw) {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      continue;
    }
    types[event.type] = (types[event.type] ?? 0) + 1;
    if (["output_audio_buffer.started", "output_audio_buffer.stopped"].includes(event.type)) lifecycle.push(message);
  }
  result.summary = {
    types,
    lifecycle,
    activeMediaObservations: captured.events.filter(
      event => event.type === "output.activity" && event.state === "active",
    ).length,
  };
  await page.evaluate(() => window.transport?.close()).catch(() => {});
  await child?.close().catch(() => {});
  await cleanup?.().catch(() => {});
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      { model: result.model, failure: result.failure, ...result.summary, artifact: path.join(output, "results.json") },
      null,
      2,
    ),
  );
}
