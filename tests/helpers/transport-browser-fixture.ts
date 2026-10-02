import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// Serve the real transport modules as ESM. Only the provider is replaced by a
// local WebRTC peer: actual RTP, jitter/decoder buffering, HTMLAudioElement,
// Web Audio observation and recording all run in Chromium. No billed services.
export async function transportFixture(page: Page, microphoneMode: "silent" | "continuous" = "silent") {
  await page.route("**/transport-fixture/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (name === "index") {
      await route.fulfill({
        contentType: "text/html",
        body: `<button>Start</button><audio></audio><script type="module">
        import { BrowserTransport } from './browser-transport';
        import { LessonSession } from './session'; window.LessonSession = LessonSession;
        import { replacementMicrophone, outboundMicrophoneRtp } from './replacement-input.mjs';
        window.replacementMicrophone = replacementMicrophone; window.outboundMicrophoneRtp = outboundMicrophoneRtp;
        import { ResponseSourceContract } from './response-source-contract';
        import { advanceContext, sceneAt } from './lesson';
        window.advanceContext = advanceContext; window.sceneAt = sceneAt;
        window.Transport = BrowserTransport;
        window.SourceContract = ResponseSourceContract;
      </script>`,
      });
      return;
    }
    const source = await readFile(
      path.join(
        process.cwd(),
        name === "response-source-contract"
          ? "tests/helpers"
          : name === "replacement-input.mjs"
            ? "scripts/live"
            : "lib",
        name.endsWith(".mjs") ? name : `${name}.ts`,
      ),
      "utf8",
    );
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
    // Expose only the synthetic microphone destination to browser tests so
    // they can supply input while actual transport playback is running.
    const createDestination = window.context.createMediaStreamDestination.bind(window.context);
    window.context.createMediaStreamDestination = () => window.microphoneDestination = createDestination();
    window.microphone = window.replacementMicrophone(window.context, ${JSON.stringify(microphoneMode)});
    window.context.createMediaStreamDestination = createDestination;
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
