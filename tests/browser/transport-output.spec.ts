import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// A local provider peer exercises actual RTP, decoded output, and Web Audio.
// No billed providers or recording machinery are involved.
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
    const source = await readFile(path.join(process.cwd(), "lib", `${name}.ts`), "utf8");
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
    window.events = []; window.failures = []; window.providers = [];
    window.context = new AudioContext();
    window.microphone = window.context.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => window.microphone.stream.clone();
    window.acceptOffer = async sdp => {
      const peer = window.provider = new RTCPeerConnection();
      window.tone = window.context.createOscillator();
      window.level = window.context.createGain(); window.level.gain.value = 0.2;
      const destination = window.context.createMediaStreamDestination();
      window.tone.connect(window.level); window.level.connect(destination); window.tone.start();
      window.providers.push({ peer, level: window.level, tone: window.tone, destination });
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      peer.ondatachannel = event => { window.channel = event.channel; window.providers.find(source => source.peer === peer).channel = event.channel; };
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

test("real tutor output observes active, quiet, resumed, unavailable, and teardown states", async ({ page }) => {
  await fixture(page);
  expect(await page.evaluate("document.querySelector('audio').muted")).toBe(false);
  await page.evaluate("window.level.gain.value = 0");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("quiet");
  await page.evaluate("window.level.gain.value = 0.2");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("active");
  await page.evaluate("window.transport.current.observer.context.suspend()");
  await expect.poll(async () => (await states(page)).at(-1)).toBe("unavailable");
  await page.evaluate(
    "window.transport.close(); window.providers.forEach(source => {source.peer.close(); source.tone.stop()}); window.context.close()",
  );
  const count = (await states(page)).length;
  await page.waitForTimeout(150);
  expect(await states(page)).toHaveLength(count);
  expect(
    await page.evaluate("document.querySelector('audio').srcObject === null && document.querySelector('audio').paused"),
  ).toBe(true);
  expect(await page.evaluate("window.failures")).toEqual([]);
});
