import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// Serve the real transport modules as ESM. Only the provider is replaced by a
// local WebRTC peer: actual RTP, jitter/decoder buffering, HTMLAudioElement,
// Web Audio observation and recording all run in Chromium. No billed services.
async function fixture(page: Page) {
  await page.route("**/transport-fixture/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
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
  await page.route("**/api/live", async route => {
    const answer = await page.evaluate(async sdp => {
      // String evaluation isolates fixture globals from production Window types.
      return await (window as unknown as { acceptOffer: (sdp: string) => Promise<string> }).acceptOffer(sdp);
    }, route.request().postDataJSON().sdp);
    await route.fulfill({ json: { transport: { sdp: answer } } });
  });
  await page.goto("/transport-fixture/index");
  await expect.poll(() => page.evaluate("typeof window.Transport")).toBe("function");
  await page.evaluate(`(() => {
    window.events = []; window.failures = [];
    window.context = new AudioContext();
    const silence = window.context.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => silence.stream;
    window.acceptOffer = async sdp => {
      const peer = window.provider = new RTCPeerConnection();
      window.tone = window.context.createOscillator();
      window.level = window.context.createGain(); window.level.gain.value = 0.2;
      const destination = window.context.createMediaStreamDestination();
      window.tone.connect(window.level); window.level.connect(destination); window.tone.start();
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      peer.ondatachannel = event => { window.channel = event.channel; };
      await peer.setRemoteDescription({ type: 'offer', sdp });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
        peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); });
      });
      return peer.localDescription.sdp;
    };
    document.querySelector('button').onclick = async () => {
      await window.context.resume();
      window.transport = new window.Transport(document.querySelector('audio'));
      window.transport.setOutputBlocked(true);
      await window.transport.start(event => window.events.push(event), error => window.failures.push(error));
    };
  })()`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect
    .poll(() =>
      page.evaluate("window.events.some(event => event.type === 'output.activity' && event.state === 'active')"),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate("!document.querySelector('audio').paused")).toBe(true);
}

const states = (page: Page) =>
  page.evaluate<string[]>("window.events.filter(event => event.type === 'output.activity').map(event => event.state)");

test("real WebRTC media continues while muted; quiet and steering cannot isolate a resumed source", async ({
  page,
}) => {
  await fixture(page);
  expect(await page.evaluate("document.querySelector('audio').muted")).toBe(true);
  await page.evaluate(`(() => {
    window.originalStream = document.querySelector('audio').srcObject;
    window.level.gain.value = 0;
    window.channel.send(JSON.stringify({type: 'session.instructions.appended', client_event_id: 'steer'}));
    for (let i = 0; i < 17; i++) window.channel.send(JSON.stringify({type: 'session.output_transcript.delta', event_id: 'fragment-' + i, delta: 'old scene', start_ms: i * 100, end_ms: i * 100 + 50}));
  })()`);
  await expect.poll(() => states(page)).toContain("quiet");
  await expect.poll(() => page.evaluate("window.events.filter(event => event.type === 'transcript').length")).toBe(17);
  // A pause longer than the legacy caption gap is still the SAME remote source.
  await page.waitForTimeout(2700);
  expect(await page.evaluate("document.querySelector('audio').muted")).toBe(true);
  await page.evaluate("window.level.gain.value = 0.2");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("active");
  expect(await page.evaluate("document.querySelector('audio').srcObject === window.originalStream")).toBe(true);
  // Transport investigation: reopening has no clearing/isolation side effect.
  await page.evaluate("window.transport.setOutputBlocked(false)");
  expect(
    await page.evaluate(
      "document.querySelector('audio').srcObject === window.originalStream && !document.querySelector('audio').muted && !document.querySelector('audio').paused",
    ),
  ).toBe(true);
  await page.evaluate(
    "window.transport.stopMedia(); window.transport.close(); window.provider.close(); window.context.close()",
  );
  const count = (await states(page)).length;
  await page.waitForTimeout(150);
  expect(await states(page)).toHaveLength(count);
  expect(
    await page.evaluate("document.querySelector('audio').srcObject === null && document.querySelector('audio').paused"),
  ).toBe(true);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("blocked resumed media stays out of actual recording PCM and teardown detaches the track", async ({ page }) => {
  await fixture(page);
  await page.evaluate("window.transport.startRecording()");
  await page.waitForTimeout(300);
  await page.evaluate("window.level.gain.value = 0");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("quiet");
  await page.evaluate("window.level.gain.value = 0.2");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("active");
  await page.waitForTimeout(300);
  const rms = await page.evaluate<number>(`(async () => {
    window.transport.close(); window.provider.close();
    const recording = await window.transport.recording();
    const buffer = await window.context.decodeAudioData(await recording.blob.arrayBuffer());
    let power = 0; const samples = buffer.getChannelData(0);
    for (const sample of samples) power += sample * sample;
    await window.context.close();
    return Math.sqrt(power / samples.length);
  })()`);
  expect(rms).toBeLessThan(0.001);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("permitted remote PCM is recorded; a suspended observer reports unavailable", async ({ page }) => {
  await fixture(page);
  await page.evaluate(`(() => {
    window.transport.setOutputBlocked(false);
    window.transport.startRecording();
    window.transport.outputObserver.context.suspend();
  })()`);
  await expect.poll(async () => (await states(page)).at(-1)).toBe("unavailable");
  await page.waitForTimeout(400);
  const rms = await page.evaluate<number>(`(async () => {
    window.transport.close(); window.provider.close();
    const recording = await window.transport.recording();
    const buffer = await window.context.decodeAudioData(await recording.blob.arrayBuffer());
    let power = 0; const samples = buffer.getChannelData(0);
    for (const sample of samples) power += sample * sample;
    await window.context.close();
    return Math.sqrt(power / samples.length);
  })()`);
  expect(rms).toBeGreaterThan(0.01);
  expect(await page.evaluate("window.failures")).toEqual([]);
});
