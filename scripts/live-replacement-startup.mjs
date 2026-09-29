/** Targeted billed experiment: one initial session plus three seeded replacements.
 * Uses the configured local app; never loads or exports credentials.
 * BASE_URL=http://127.0.0.1:3000 node scripts/live-replacement-startup.mjs
 */
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.LIVE_OUT ?? "test-results/replacement-startup";
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const results = { date: new Date().toISOString(), baseURL, clock: "browser.performance.now", samples: [] };
try {
  await page.route("**/replacement-measure/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (name === "index") {
      await route.fulfill({
        contentType: "text/html",
        body: `<button>Start</button><audio muted></audio><script type="module">
        import { BrowserTransport } from './browser-transport';
        import { replacementSessionInput } from './lesson';
        window.Transport = BrowserTransport;
        window.replacementSessionInput = replacementSessionInput;
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
  await page.goto(`${baseURL}/replacement-measure/index`);
  await page.waitForFunction("typeof window.Transport === 'function'");
  await page.evaluate(() => {
    window.diagnostics = [];
    window.peers = [];
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) {
        super(...args);
        window.peers.push(this);
      }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        const sourceNumber = window.peers.indexOf(this) + 1;
        channel.addEventListener("message", ({ data }) => {
          const event = JSON.parse(data);
          // Only synthetic context and selected non-sensitive fields are recorded.
          if (event.type === "session.started")
            window.diagnostics.push({
              sourceNumber,
              at: performance.now(),
              type: event.type,
              input: event.session?.input ?? null,
            });
          if (event.type === "session.output_transcript.delta")
            window.diagnostics.push({ sourceNumber, at: performance.now(), type: event.type, delta: event.delta });
          if (event.type === "error")
            window.diagnostics.push({ sourceNumber, at: performance.now(), type: event.type, code: event.error?.code });
        });
        return channel;
      }
    };
    window.audioContext = new AudioContext();
    const silence = window.audioContext.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => silence.stream.clone();
    window.transport = new window.Transport(document.querySelector("audio"));
    window.transport.setOutputBlocked(true);
    window.lessonEvents = [];
    document.querySelector("button").onclick = () => {
      window.starting = window.transport.start(
        event => window.lessonEvents.push(event),
        error => {
          window.failure = error;
        },
      );
    };
  });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    "window.diagnostics.some(event => event.sourceNumber === 1 && event.type === 'session.started') || window.failure",
    null,
    { timeout: 35_000 },
  );
  await page.evaluate(() => window.starting);
  if (await page.evaluate(() => window.failure)) throw new Error("Initial voice session failed");
  const seeds = [
    { sceneIndex: 2, decision: "ADVANCE", childUtterance: "Two" },
    { sceneIndex: 2, decision: "STAY", childUtterance: "Five" },
    { sceneIndex: 2, decision: "UNAVAILABLE", childUtterance: "Three" },
  ];
  for (let index = 0; index < seeds.length; index++) {
    const sample = await page.evaluate(
      async ({ seed, probe }) => {
        const authorityBefore = window.transport.activeSourceId;
        const id = await window.transport.prepareReplacement(seed);
        const result = {
          seed,
          timing: window.transport.replacementTiming,
          authorityBefore,
          authorityAfterPreparation: window.transport.activeSourceId,
          pendingDetached: document.querySelector("audio").srcObject !== window.transport.pending.remote,
          muted: document.querySelector("audio").muted,
          seedReceiptConfirmed:
            JSON.stringify(
              window.diagnostics.find(event => event.sourceNumber === id && event.type === "session.started")?.input,
            ) === JSON.stringify(window.replacementSessionInput(seed)),
        };
        if (!result.seedReceiptConfirmed) throw new Error("Provider did not confirm generated startup input");
        if (result.authorityBefore !== result.authorityAfterPreparation || !result.pendingDetached || !result.muted)
          throw new Error("Preparation isolation failed");
        if (probe) {
          if (!window.transport.activateSource(id)) throw new Error("Probe promotion failed");
          // Test-only context probe after qualification, never part of startup or gates.
          window.transport.send({
            type: "session.instructions.append",
            event_id: "replacement-context-probe",
            delegation_id: null,
            content:
              "For a parent diagnostic only, say the name of the objects currently displayed, without saying their count or judging the child's answer. Then remain quiet.",
          });
        } else window.transport.retireSource(id);
        return result;
      },
      { seed: seeds[index], probe: index === seeds.length - 1 },
    );
    results.samples.push(sample);
    console.log(JSON.stringify(sample));
  }
  await page
    .waitForFunction(
      "window.diagnostics.some(event => event.sourceNumber === 4 && event.type === 'session.output_transcript.delta' && /butterfl/i.test(event.delta))",
      null,
      { timeout: 20_000 },
    )
    .catch(() => {});
  // Allow a bounded follow-up fragment to complete the diagnostic sentence.
  await page.waitForTimeout(2000);
  results.diagnostics = await page.evaluate(() => window.diagnostics);
  results.contextProbe = results.diagnostics
    .filter(event => event.sourceNumber === 4 && event.type === "session.output_transcript.delta")
    .map(event => event.delta)
    .join("");
  results.currentSceneObserved = /butterfl/i.test(results.contextProbe);
  console.log(
    JSON.stringify({ contextProbe: results.contextProbe, currentSceneObserved: results.currentSceneObserved }),
  );
} catch (error) {
  results.failure = error instanceof Error ? error.message : "Experiment failed";
  process.exitCode = 1;
  console.error(results.failure);
} finally {
  await page
    .evaluate(() => {
      window.transport?.close();
      window.peers?.forEach(peer => peer.close());
      window.audioContext?.close();
    })
    .catch(() => {});
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
}
