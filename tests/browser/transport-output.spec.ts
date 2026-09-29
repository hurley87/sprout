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
        import { ResponseSourceContract } from './response-source-contract';
        window.Transport = BrowserTransport;
        window.SourceContract = ResponseSourceContract;
      </script>`,
      });
      return;
    }
    const source = await readFile(
      path.join(
        process.cwd(),
        name === "response-source-contract" ? "tests/helpers" : "lib",
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
    const silence = window.context.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => silence.stream.clone();
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
    window.transport.current.observer.context.suspend();
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

test("source contract: retired A keeps generating upstream media but stays detached; only authoritative B is permitted", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(`(async () => {
    window.audioA = document.querySelector('audio');
    window.streamA = window.audioA.srcObject;
    window.lateObserverA = window.transport.current.observer.emit;
    window.transport.startRecording();
    // Witness A's decoded PCM before retirement. A zero-gain sink keeps
    // the observation graph rendering without sound.
    window.witnessStream = window.streamA.clone();
    window.witness = window.context.createMediaStreamSource(window.witnessStream);
    window.analyser = window.context.createAnalyser();
    window.witness.connect(window.analyser);
    window.witnessSink = window.context.createGain(); window.witnessSink.gain.value = 0;
    window.analyser.connect(window.witnessSink); window.witnessSink.connect(window.context.destination);
    window.pcmRms = () => {
      const pcm = new Float32Array(window.analyser.fftSize);
      window.analyser.getFloatTimeDomainData(pcm);
      return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
    };
    window.idA = window.transport.activeSourceId;
    window.contract = new window.SourceContract();
    window.contract.add('A', {
      block: blocked => window.transport.setOutputBlocked(blocked),
      stop: () => window.transport.retireSource(window.idA),
    });
    window.contract.ready('A');
    window.contract.begin('A', 'old-answer', 15000, () => window.failures.push('budget expired'));
    window.contract.activate('A');
    // A is authoritative but blocked: real remote PCM must remain silent.
  })()`);
  await expect.poll(() => page.evaluate<number>("window.pcmRms()")).toBeGreaterThan(0.01);
  expect(await page.evaluate("window.audioA.muted && !window.audioA.paused")).toBe(true);
  await page.evaluate(`(async () => {
    window.idB = await window.transport.prepareReplacement();
    window.contract.add('B', {
      block: blocked => {
        if (window.transport.activeSourceId === window.idB) window.transport.setOutputBlocked(blocked);
      },
      stop: () => window.transport.retireSource(window.idB),
    });
    window.contract.begin('B', 'new-answer', 15000, () => window.failures.push('budget expired'));
  })()`);
  await expect.poll(() => page.evaluate("window.transport.pending.activity.state")).toBe("active");
  expect(
    await page.evaluate(
      "window.audioA.srcObject === window.streamA && window.audioA.muted && !window.contract.eligible('B')",
    ),
  ).toBe(true);
  await page.evaluate("window.providers[0].level.gain.value = 0");
  await expect.poll(() => page.evaluate<number>("window.pcmRms()")).toBeLessThan(0.001);
  await expect.poll(async () => (await states(page)).at(-1)).toBe("quiet");
  await page.waitForTimeout(2700); // Quiet beyond the unchanged caption gap.
  await page.evaluate(`(() => {
    window.contract.ready('B');
    window.contract.activate('B');
  })()`);
  expect(await page.evaluate("window.audioA.srcObject === null && window.audioA.paused && window.audioA.muted")).toBe(
    true,
  );
  expect(await page.evaluate("window.contract.trace.slice(-3)")).toEqual(["ready:B", "retired:A", "authority:B"]);
  // Retirement stops A's receiving playback track. Witness the provider's
  // upstream PCM directly: provider media can continue despite detachment.
  await page.evaluate(`(() => {
    window.witness.disconnect();
    window.witness = window.context.createMediaStreamSource(window.providers[0].destination.stream);
    window.witness.connect(window.analyser);
    window.providers[0].level.gain.value = 0.2;
  })()`);
  await expect.poll(() => page.evaluate<number>("window.pcmRms()")).toBeGreaterThan(0.01);
  await page.evaluate(`(() => {
    window.contract.ready('A'); window.contract.activate('A'); window.contract.permit('old-answer');
    // Even an accidentally late global-unmute callback cannot restore A's
    // actual stopped playback track. The upstream provider witness still has PCM.
    window.transport.setOutputBlocked(false);
  })()`);
  expect(
    await page.evaluate("window.audioA.srcObject === null && window.audioA.paused && !window.contract.eligible('A')"),
  ).toBe(true);
  expect(await page.evaluate("window.audioA.muted")).toBe(true);
  expect(await page.evaluate("window.providers[0].peer.connectionState")).toBe("connected");
  await page.evaluate(`(() => {
    window.beforeLate = window.events.length;
    window.lateObserverA({type: 'output.activity', state: 'quiet'});
    window.lateObserverA({type: 'output.activity', state: 'active'});
    for (const type of ['session.output_transcript.delta', 'session.closed', 'error']) {
      window.providers[0].channel.send(JSON.stringify({type, delta: 'late A', start_ms: 0, end_ms: 1}));
    }
  })()`);
  await page.waitForTimeout(150);
  expect(await page.evaluate("window.events.length === window.beforeLate")).toBe(true);
  await page.evaluate("window.transport.startRecording()");
  // Promotion attaches only B and is still blocked, even after a stale unmute.
  expect(await page.evaluate("window.transport.activateSource(window.idB)")).toBe(true);
  await expect.poll(() => page.evaluate("!window.audioA.paused")).toBe(true);
  expect(await page.evaluate("window.audioA.muted && window.audioA.srcObject !== window.streamA")).toBe(true);
  await page.evaluate("window.contract.permit('new-answer')");
  expect(await page.evaluate("!window.audioA.muted && window.contract.eligible('B')")).toBe(true);
  await page.waitForTimeout(400);
  const recordingRms = await page.evaluate<{ blocked: number; permitted: number }>(`(async () => {
    window.clientPeers = [...window.transport.connections.values()].map(source => source.peer);
    window.contract.end(); window.transport.close();
    window.providers.forEach(source => { source.peer.close(); source.tone.stop(); });
    window.witness.disconnect(); window.analyser.disconnect(); window.witnessSink.disconnect(); window.witnessStream.getTracks().forEach(track => track.stop());
    const recording = await window.transport.recording();
    const buffer = await window.context.decodeAudioData(await recording.blob.arrayBuffer());
    const pcm = buffer.getChannelData(0);
    const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    await window.context.close();
    return { blocked: rms(pcm.slice(0, buffer.sampleRate * 0.3)), permitted: rms(pcm.slice(-buffer.sampleRate * 0.15)) };
  })()`);
  expect(recordingRms.blocked).toBeLessThan(0.001);
  expect(recordingRms.permitted).toBeGreaterThan(0.01);
  expect(
    await page.evaluate(
      "window.clientPeers.length === 2 && window.clientPeers.every(peer => peer.connectionState === 'closed')",
    ),
  ).toBe(true);
  expect(await page.evaluate("window.audioA.srcObject === null && window.audioA.paused")).toBe(true);
  expect(await page.evaluate("window.failures")).toEqual([]);
});
