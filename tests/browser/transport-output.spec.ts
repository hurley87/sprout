import { installOutboundAudio, outboundPlaybackEvidence, type AudioWindow } from "../helpers/outbound-audio";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { installTranscriptWire, type WireWindow } from "../helpers/transcript-wire";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

// A local provider peer exercises actual RTP, decoded output, and Web Audio.
// No billed providers or recording machinery are involved.
async function fixture(page: Page, observeWire = false) {
  if (observeWire) {
    await installOutboundAudio(page);
    await installTranscriptWire(page);
  }
  const microphone = await installSyntheticMicrophone(page);
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
      window.transport = new window.Transport(document.querySelector('audio'), true);
      window.measurements = [];
      window.transport.setMicrophoneDiagnosticSink(event => window.measurements.push(event));
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
  await expect.poll(async () => (await microphone.state()).contextState).toBe("running");
  return microphone;
}

test.afterEach(async ({ page }) => {
  await page.evaluate(`(async () => {
    window.transport?.close();
    if (window.remoteElement) { window.remoteElement.pause(); window.remoteElement.srcObject = null; }
    window.providers?.forEach(source => {
      source.peer.close(); source.tone.stop();
      source.destination.stream.getTracks().forEach(track => track.stop());
    });
    if (window.context && window.context.state !== "closed") await window.context.close();
    await window.syntheticMicrophone?.dispose();
  })()`);
});

const states = (page: Page) =>
  page.evaluate<string[]>("window.events.filter(event => event.type === 'output.activity').map(event => event.state)");

test("real tutor output observes active, quiet, resumed, unavailable, and teardown states", async ({ page }) => {
  const microphone = await fixture(page);
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
  await microphone.dispose();
  const count = (await states(page)).length;
  await page.waitForTimeout(150);
  expect(await states(page)).toHaveLength(count);
  expect(
    await page.evaluate("document.querySelector('audio').srcObject === null && document.querySelector('audio').paused"),
  ).toBe(true);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

const microphoneEvents = (page: Page) =>
  page.evaluate<string[]>(
    "window.events.filter(event => event.type.startsWith('microphone.')).map(event => event.type)",
  );

test("answer fixtures reach the remote WebRTC peer after the production input fence opens", async ({ page }, info) => {
  test.setTimeout(45_000); // Eight real-time clips plus production VAD quiet windows.
  const microphone = await fixture(page);
  await page.evaluate(`(async () => {
    window.remoteElement = new Audio();
    window.remoteElement.srcObject = new MediaStream(window.provider.getReceivers().map(r => r.track));
    await window.remoteElement.play();
  })()`);
  const received = () =>
    page.evaluate<{ energy: number; duration: number }>(`(async () => {
    const stats = [...(await window.provider.getStats()).values()];
    const audio = stats.find(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio');
    return { energy: audio?.totalAudioEnergy ?? 0, duration: audio?.totalSamplesDuration ?? 0 };
  })()`);
  await microphone.loadSpeech("one");
  const mutedBefore = await received();
  await microphone.waitForPlayback((await microphone.playSpeech("one")).id);
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.speech_stopped");
  const mutedAfter = await received();
  expect(mutedAfter.energy - mutedBefore.energy).toBeLessThan(0.00001);
  await page.evaluate("window.transport.openInput(() => {})");
  const measurements = [];
  for (const name of [
    "one",
    "two",
    "three",
    "answer-one",
    "answer-two",
    "answer-three",
    "answer-three-ducks",
    "self-correction",
  ] as const) {
    await microphone.loadSpeech(name);
    const eventOffset = (await microphoneEvents(page)).length;
    const before = await received();
    const playback = await microphone.playSpeech(name);
    await microphone.waitForPlayback(playback.id);
    await expect.poll(async () => (await received()).energy - before.energy).toBeGreaterThan(0.0001);
    await expect
      .poll(async () => (await microphoneEvents(page)).slice(eventOffset))
      .toContain("microphone.speech_stopped");
    const turns = (await microphoneEvents(page)).slice(eventOffset);
    expect(turns.filter(type => type === "microphone.speech_started")).toHaveLength(1);
    expect(turns.filter(type => type === "microphone.speech_stopped")).toHaveLength(1);
    const after = await received();
    measurements.push({ name, before, after });
    expect(after.duration - before.duration).toBeGreaterThan(playback.durationSeconds * 0.7);
    expect(after.energy - before.energy).toBeGreaterThan(0.0001);
  }
  await info.attach("remote-answer-audio.json", {
    body: JSON.stringify(measurements),
    contentType: "application/json",
  });
});

test("synthetic speech reaches the production microphone detector and silence settles it", async ({ page }) => {
  const microphone = await fixture(page);
  const duration = await microphone.loadSpeech("counting");
  expect(duration).toBeGreaterThan(1);
  expect((await microphone.state()).requests).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        "window.measurements.some(event => event.type === 'microphone.detector_window' && event.detail.rmsMax < 0.001)",
      ),
    )
    .toBe(true);
  expect(await microphoneEvents(page)).toEqual([]);
  const playback = await microphone.playSpeech("counting");
  const start = Date.now();
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.speech_started");
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  expect(Date.now() - start).toBeGreaterThan(duration * 1000 - 200);
  await microphone.silence();
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.speech_stopped");
  expect(
    await page.evaluate(
      "window.measurements.some(event => event.type === 'microphone.detector_window' && event.detail.aboveThresholdFrames > 0 && event.detail.rmsMax > event.detail.threshold)",
    ),
  ).toBe(true);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("seeded noise, cancellation, and teardown use real browser audio", async ({ page }) => {
  const microphone = await fixture(page);
  await microphone.loadSpeech("counting");
  await page.evaluate(`(() => {
      window.noiseSamples = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) {
        window.noiseSamples.push([...this.buffer.getChannelData(0)]);
        return start.apply(this, args);
      };
    })()`);
  const burst = await microphone.noise({ seed: 30, durationMs: 40 });
  expect(await microphone.waitForPlayback(burst.id)).toBe("ended");
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.activity_discarded");
  expect(await microphoneEvents(page)).not.toContain("microphone.speech_started");
  const repeat = await microphone.noise({ seed: 30, durationMs: 40 });
  await microphone.waitForPlayback(repeat.id);
  const samples = await page.evaluate<number[][]>("window.noiseSamples");
  expect(samples[0]).toEqual(samples[1]);
  expect(samples[0].some(sample => Math.abs(sample) > 0.1)).toBe(true);
  await expect
    .poll(async () => (await microphoneEvents(page)).filter(type => type === "microphone.activity_discarded").length)
    .toBe(2);
  const speech = await microphone.playSpeech("counting");
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.speech_started");
  await microphone.cancel();
  expect(await microphone.waitForPlayback(speech.id)).toBe("cancelled");
  expect((await microphone.state()).activeSources).toBe(0);
  await expect.poll(() => microphoneEvents(page)).toContain("microphone.speech_stopped");
  const pending = await microphone.noise({ seed: 30, durationMs: 1000 });
  await page.evaluate("window.originalMicrophoneReplacement = navigator.mediaDevices.getUserMedia");
  await microphone.dispose();
  expect(await microphone.waitForPlayback(pending.id)).toBe("cancelled");
  expect(await page.evaluate("navigator.mediaDevices.getUserMedia !== window.originalMicrophoneReplacement")).toBe(
    true,
  );
  const state = await microphone.state();
  expect(state.contextState).toBe("closed");
  expect(state.trackStates).toEqual(["ended", "ended"]);
  expect(state.activeSources).toBe(0);
  expect(state.disposed).toBe(true);
  await microphone.dispose();
  await expect(microphone.noise({ seed: 30 })).rejects.toThrow("disposed");
  await page.evaluate("window.transport.close()");
  const count = (await microphoneEvents(page)).length;
  await page.waitForTimeout(300);
  expect(await microphoneEvents(page)).toHaveLength(count);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("idle synthetic microphone advances the outgoing WebRTC audio clock before speech and after cancellation", async ({
  page,
}, info) => {
  const microphone = await fixture(page);
  await page.evaluate("window.transport.openInput(() => {})");
  const samples = () =>
    page.evaluate<{ duration: number; packets: number }>(`(async () => {
    const stats = [...(await window.transport.current.peer.getStats()).values()];
    return {
      duration: stats.find(stat => stat.type === 'media-source' && stat.kind === 'audio')?.totalSamplesDuration ?? 0,
      packets: stats.find(stat => stat.type === 'outbound-rtp' && stat.kind === 'audio')?.packetsSent ?? 0,
    };
  })()`);
  const before = await samples();
  await page.waitForTimeout(1000);
  const idle = await samples();
  await info.attach("idle-audio-clock.json", {
    body: JSON.stringify({ before, idle }),
    contentType: "application/json",
  });
  expect(idle.duration - before.duration).toBeGreaterThan(0.5);
  expect(idle.packets - before.packets).toBeGreaterThan(10);
  expect(await microphoneEvents(page)).toEqual([]);
  await microphone.loadSpeech("counting");
  const playback = await microphone.playSpeech("counting");
  await page.waitForTimeout(100);
  await microphone.cancel();
  expect(await microphone.waitForPlayback(playback.id)).toBe("cancelled");
  const cancelled = await samples();
  await page.waitForTimeout(1000);
  const after = await samples();
  expect(after.duration - cancelled.duration).toBeGreaterThan(0.5);
  expect(after.packets - cancelled.packets).toBeGreaterThan(10);
});

test("wire diagnostics precede production parsing on real local WebRTC without changing delivered events", async ({
  page,
}) => {
  const microphone = await fixture(page, true);
  await page.evaluate(() => {
    const host = window as unknown as WireWindow & { events: unknown[] };
    Object.defineProperty(host, "sproutLessonObservation", {
      configurable: true,
      value: {
        read: () => ({
          nowMs: 42,
          cursor: { runtimeId: "local-wire", offset: host.events.length },
          snapshot: { runtime: { visitId: 3, childTurnId: 2, nodeId: "count-3-butterflies", transcriptRevision: 0 } },
        }),
      },
    });
  });
  await expect.poll(() => page.evaluate("window.channel?.readyState")).toBe("open");
  const before = await page.evaluate<number>("window.events.length");
  await page.evaluate(`(() => {
    const channel = window.channel;
    channel.send(JSON.stringify({type: 'session.input_transcript.delta', delta: 'PRIVATE_WORDS', start_ms: 10, end_ms: 20, event_id: 'PRIVATE_ID'}));
    channel.send(JSON.stringify({type: 'session.input_transcript.delta', delta: null, start_ms: 10, end_ms: 20}));
    channel.send(JSON.stringify({type: 'session.input_transcript.done', transcript: 'PRIVATE_WORDS'}));
  })()`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as WireWindow).sproutTranscriptWire!.read().records.filter(r => r.runtimeId === "local-wire").length,
      ),
    )
    .toBe(3);
  const capture = await page.evaluate(() => (window as WireWindow).sproutTranscriptWire!.read());
  const rows = capture.records.filter(r => r.runtimeId === "local-wire");
  expect(rows.map(r => r.disposition)).toEqual(["parser-transcript", "parser-discard", "unrecognized-transcript"]);
  expect(rows[0]).toMatchObject({ atMs: 42, channelId: 1, visitId: 3, childTurnId: 2, journalOffset: before });
  expect(rows[1].journalOffset).toBe(before + 1);
  expect(await page.evaluate<number>("window.events.filter(e => e.type === 'transcript').length")).toBe(1);
  expect(await page.evaluate<string>("window.events.find(e => e.type === 'transcript').delta")).toBe("PRIVATE_WORDS");
  expect(JSON.stringify(capture)).not.toMatch(/PRIVATE_WORDS|PRIVATE_ID/);
  await page.evaluate(() => (window as WireWindow).sproutTranscriptWire!.dispose());
  await page.evaluate(
    "window.channel.send(JSON.stringify({type: 'session.input_transcript.delta', delta: 'more', start_ms: 20, end_ms: 30}))",
  );
  await expect.poll(() => page.evaluate<number>("window.events.filter(e => e.type === 'transcript').length")).toBe(2);
  expect(await page.evaluate(() => (window as WireWindow).sproutTranscriptWire!.read().frames)).toBe(capture.frames);
  await microphone.dispose();
});

test("outbound counters bracket full fixture playback and keep closed/restarted peers separate", async ({
  page,
}, info) => {
  const microphone = await fixture(page, true);
  await page.evaluate("window.transport.openInput(() => {})");
  await microphone.loadSpeech("hesitant-three");
  const playback = await microphone.playSpeech("hesitant-three");
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  const capture = await page.evaluate(() => (window as AudioWindow).sproutOutboundAudio!.read());
  const evidence = outboundPlaybackEvidence(capture);
  expect(evidence[0]).toMatchObject({ fixture: "hesitant-three", result: "ended" });
  expect(evidence[0].deltas.some(delta => delta.packetsSent! > 0 && delta.bytesSent! > 0)).toBe(true);
  expect(capture.records[0].peers[0].tracks[0]).toMatchObject({ enabled: true, readyState: "live" });
  expect(JSON.stringify(capture)).not.toMatch(/candidate|address|deviceId|ssrc|codec|transportId/i);
  await page.evaluate("window.transport.close()");
  const cancelled = await microphone.playSpeech("hesitant-three");
  await microphone.cancel();
  expect(await microphone.waitForPlayback(cancelled.id)).toBe("cancelled");
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate("window.providers.length")).toBe(2);
  await page.evaluate("window.transport.openInput(() => {})");
  await microphone.loadSpeech("uh");
  const restarted = await microphone.playSpeech("uh");
  await microphone.waitForPlayback(restarted.id);
  const final = await page.evaluate(() => (window as AudioWindow).sproutOutboundAudio!.read());
  expect(final.records.at(-1)!.peers.map(peer => peer.peerId)).toEqual([1, 2]);
  expect(final.records.at(-1)!.peers[0].connectionState).toBe("closed");
  await info.attach("outbound-counters.json", {
    body: JSON.stringify({ capture: final, evidence: outboundPlaybackEvidence(final) }),
    contentType: "application/json",
  });
});
