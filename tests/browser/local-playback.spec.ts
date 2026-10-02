import { test, expect, type Page } from "@playwright/test";
import { transportFixture } from "../helpers/transport-browser-fixture";

async function fixture(page: Page) {
  await transportFixture(page);
  await page.evaluate(`(async () => {
    window.channel.send(JSON.stringify({type: 'session.started'}));
    window.tone.frequency.value = 880;
    window.playbackEvents = []; window.voices = [];
    window.transport.onVoiceActivity = activity => window.voices.push(activity);
    window.transport.setPlaybackEventSink(event => window.playbackEvents.push(event));
    // Test-only instrumentation observes the otherwise private element and retains
    // callbacks. Playback, hash/decode, graph, recorder and output fence are real.
    const OriginalAudio = window.Audio;
    window.Audio = function() {
      const audio = new OriginalAudio(); window.clip = audio;
      const add = audio.addEventListener.bind(audio);
      window.callbacks = {};
      audio.addEventListener = (name, callback, options) => {
        window.callbacks[name] = callback;
        if (name === 'ended') add(name, event => { window.trustedEnd = event; }, options);
        return add(name, callback, options);
      };
      return audio;
    };
    const rate = 24000, samples = rate * 0.9;
    const bytes = new ArrayBuffer(44 + samples * 2), wav = new DataView(bytes);
    const ascii = (offset, value) => [...value].forEach((char, i) => wav.setUint8(offset + i, char.charCodeAt(0)));
    ascii(0, 'RIFF'); wav.setUint32(4, bytes.byteLength - 8, true);
    ascii(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    ascii(36, 'data'); wav.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) {
      const t = i / rate;
      wav.setInt16(44 + i * 2, Math.round((t >= 0.3 && t < 0.55 ? 0 : 0.2 * Math.sin(2 * Math.PI * 440 * t)) * 32767), true);
    }
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    window.request = {
      identity: {sessionAttemptId: 'synthetic-session', originSourceId: 1, owningSourceId: 1, evaluatedSceneIndex: 0,
        transcriptRevision: 1, answerVersion: 'one:v1', correlationKey: 'eval:1', choreographyEpoch: 1, playbackAttemptId: 'ack:1',
        responseIdentity: {provenance: 'application_evaluation', fragmentKeys: ['canonical:fragment:1'], sourceStatus: 'known', evaluatedScene: {sceneId: 'one-duck', displayedAtMs: 20}}},
      asset: {id: 'test-only-finite-wav', sha256, mimeType: 'audio/wav', url: URL.createObjectURL(new Blob([bytes], {type: 'audio/wav'}))}
    };
  })()`);
  await expect.poll(() => page.evaluate("window.transport.current.sessionStarted")).toBe(true);
  await page.evaluate("window.transport.startRecording(performance.now()); window.transport.discardOutput()");
}

async function play(page: Page) {
  await page.evaluate(
    "window.handle = window.transport.playAcknowledgment(window.request); void window.handle.result.then(event => window.result = event)",
  );
  await expect.poll(() => page.evaluate("window.playbackEvents.some(event => event.state === 'started')")).toBe(true);
}

async function recording(page: Page) {
  return await page.evaluate<{
    local: number;
    stale: number;
    internalSilence: number;
    tail: number;
    signalSpan: number;
    finalTone: number;
  }>(`(async () => {
    window.transport.stopMedia();
    const recording = await window.transport.recording();
    const decoded = await window.context.decodeAudioData(await recording.blob.arrayBuffer());
    const pcm = decoded.getChannelData(0), rate = decoded.sampleRate;
    const amplitude = frequency => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < pcm.length; i++) { const phase = 2 * Math.PI * frequency * i / rate; real += pcm[i] * Math.cos(phase); imaginary += pcm[i] * Math.sin(phase); }
      return 2 * Math.hypot(real, imaginary) / pcm.length;
    };
    const windows = [];
    for (let i = 0; i + rate * 0.02 < pcm.length; i += Math.floor(rate * 0.02)) {
      const part = pcm.slice(i, i + rate * 0.02); windows.push(Math.sqrt(part.reduce((sum, x) => sum + x*x, 0) / part.length));
    }
    const first = windows.findIndex(x => x > 0.03), last = windows.findLastIndex(x => x > 0.03);
    let longest = 0, run = 0;
    for (const value of windows.slice(first, last + 1)) { run = value < 0.003 ? run + 1 : 0; longest = Math.max(longest, run); }
    window.transport.close(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); await window.context.close();
    return {local: amplitude(440), stale: amplitude(880), internalSilence: longest * 0.02, signalSpan: (last - first + 1) * 0.02, finalTone: Math.max(...windows.slice(Math.max(first, last - 7), last + 1)), tail: Math.max(...windows.slice(Math.floor(windows.length * 0.65)))};
  })()`);
}

async function cleanup(page: Page) {
  await page.evaluate(
    "window.transport.close(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); window.context.close()",
  );
}

test("production finite playback ends naturally, drains output and records local PCM with internal silence, excluding stale RTP", async ({
  page,
}) => {
  await fixture(page);
  await play(page);
  await expect.poll(() => page.evaluate("window.result?.state")).toBe("completed");
  const events =
    await page.evaluate<{ state: string; renderFence?: number; outputTimestamp?: { contextTime: number } }[]>(
      "window.playbackEvents",
    );
  expect(events.map(event => event.state)).toEqual(["requested", "ready", "started", "media_ended", "completed"]);
  expect(events.at(-1)!.outputTimestamp!.contextTime).toBeGreaterThanOrEqual(events.at(-1)!.renderFence!);
  expect(await page.evaluate("window.trustedEnd.isTrusted")).toBe(true);
  expect(await page.evaluate("window.voices.includes('speaking') && window.voices.at(-1) === 'listening'")).toBe(true);
  expect(
    await page.evaluate(
      "window.transport.mic.getAudioTracks()[0].readyState === 'live' && !!window.transport.turnDetector",
    ),
  ).toBe(true);
  await page.evaluate(`(() => {
    window.callbacks.ended(window.trustedEnd); window.callbacks.ended(window.trustedEnd);
    window.transport.setOutputBlocked(false);
    window.channel.send(JSON.stringify({type: 'local.playback', state: 'completed', identity: window.request.identity}));
  })()`);
  expect(await page.evaluate("window.playbackEvents.filter(event => event.state === 'completed').length")).toBe(1);
  expect(
    await page.evaluate(
      "document.querySelector('audio').muted && document.querySelector('audio').srcObject === null && window.transport.remoteGain.gain.value === 0",
    ),
  ).toBe(true);
  const pcm = await recording(page);
  expect(pcm.local).toBeGreaterThan(0.015);
  expect(pcm.stale).toBeLessThan(0.001);
  expect(pcm.internalSilence).toBeGreaterThanOrEqual(0.16);
  expect(pcm.signalSpan).toBeGreaterThan(0.78);
  expect(pcm.signalSpan).toBeLessThan(1.04);
  expect(pcm.finalTone).toBeGreaterThan(0.05);
});

const failures = {
  interrupted: "window.handle.cancel('interrupted')",
  stopped: "window.transport.stopMedia()",
  closed: "window.transport.close()",
  source_retired: "window.transport.retireSource(1)",
  suspended: "window.transport.context.suspend()",
  paused: "window.clip.pause()",
  muted: "window.clip.muted = true",
  volume: "window.clip.volume = 0.5",
  rate: "window.clip.playbackRate = 1.2",
  seek: "window.clip.currentTime = 0.65",
  resource: "window.clip.src = 'blob:unusable'",
  error: "window.clip.dispatchEvent(new Event('error'))",
  sink: "window.transport.context.dispatchEvent(new Event('sinkchange'))",
  recording_route: "window.transport.mix.stream.getAudioTracks()[0].stop()",
  recorder_error: "window.transport.mediaRecorder.dispatchEvent(new Event('error'))",
  recorder_stop: "window.transport.mediaRecorder.stop()",
  provider_error: "window.channel.send(JSON.stringify({type:'error', error:{code:'synthetic'}}))",
  provider_closed: "window.channel.send(JSON.stringify({type:'session.closed'}))",
  peer_closed: "window.transport.current.peer.close()",
  unavailable_clock: "window.transport.context.getOutputTimestamp = undefined",
  zero_clock: "window.transport.context.getOutputTimestamp = () => ({contextTime: 0, performanceTime: 0})",
  stalled_clock:
    "window.transport.context.getOutputTimestamp = () => ({contextTime: window.transport.context.currentTime, performanceTime: 1})",
} as const;

for (const [scenario, stimulus] of Object.entries(failures)) {
  test(`production playback ${scenario} cannot later complete`, async ({ page }) => {
    await fixture(page);
    await play(page);
    await expect.poll(() => page.evaluate("window.clip.currentTime"), { intervals: [20] }).toBeGreaterThan(0.2);
    await page.evaluate("window.retainedEnd = window.callbacks.ended");
    await page.evaluate(stimulus);
    await expect
      .poll(() => page.evaluate("window.result?.state"), { timeout: 5000 })
      .toBe(
        scenario === "interrupted"
          ? "interrupted"
          : scenario === "stopped" || scenario === "closed"
            ? "stopped"
            : scenario === "source_retired"
              ? "source_retired"
              : "failed",
      );
    await page.evaluate(
      "window.retainedEnd({isTrusted: true}); window.retainedEnd({isTrusted: true}); window.clip.dispatchEvent(new Event('ended'))",
    );
    expect(await page.evaluate("window.playbackEvents.some(event => event.state === 'completed')")).toBe(false);
    expect(await page.evaluate("window.clip.paused && window.clip.getAttribute('src') === null")).toBe(true);
    if (["recording_route", "recorder_error", "recorder_stop", "suspended"].includes(scenario)) {
      expect(await page.evaluate("!!window.transport.captureError")).toBe(true);
      expect(
        await page.evaluate(
          "(async () => {window.transport.stopMedia(); try {await window.transport.recording(); return false;} catch {return true;}})()",
        ),
      ).toBe(true);
    }
    await cleanup(page);
  });
}

test("interruption during output drain remains cancelled despite a naturally ended recorded clip", async ({ page }) => {
  await fixture(page);
  await page.evaluate("window.transport.context.getOutputTimestamp = () => ({contextTime: 0, performanceTime: 0})");
  await play(page);
  await expect
    .poll(() => page.evaluate("window.playbackEvents.some(event => event.state === 'media_ended')"))
    .toBe(true);
  await page.evaluate("window.handle.cancel('interrupted')");
  await expect.poll(() => page.evaluate("window.result?.state")).toBe("interrupted");
  const pcm = await recording(page);
  expect(pcm.local).toBeGreaterThan(0.015);
  expect(pcm.stale).toBeLessThan(0.001);
});

test("mid-play interruption records the initial clip then silence, excluding stale provider and resumed local audio", async ({
  page,
}) => {
  await fixture(page);
  await play(page);
  await expect.poll(() => page.evaluate("window.clip.currentTime"), { intervals: [20] }).toBeGreaterThan(0.18);
  await page.evaluate(`(() => {
    window.retainedEnd = window.callbacks.ended;
    window.handle.cancel('interrupted');
    window.retainedEnd({isTrusted: true}); window.clip.dispatchEvent(new Event('ended'));
    window.transport.setOutputBlocked(false);
  })()`);
  await expect.poll(() => page.evaluate("window.result?.state")).toBe("interrupted");
  // Observation window only: the recorder must capture any late/resumed output.
  // This delay cannot authorize completion; that token is already cancelled.
  await page.waitForTimeout(500);
  const pcm = await recording(page);
  expect(pcm.local).toBeGreaterThan(0.01);
  expect(pcm.stale).toBeLessThan(0.001);
  expect(pcm.tail).toBeLessThan(0.003);
  expect(pcm.signalSpan).toBeLessThan(0.4);
  expect(await page.evaluate("window.playbackEvents.some(event => event.state === 'completed')")).toBe(false);
});

test("reentrant supersession installs the newest attempt without leaving an orphaned clip", async ({ page }) => {
  await fixture(page);
  await play(page);
  await page.evaluate(`(() => {
    window.transport.setPlaybackEventSink(event => {
      window.playbackEvents.push(event);
      if (event.state === 'superseded' && event.identity.playbackAttemptId === 'ack:1') {
        const request = structuredClone(window.request); request.identity.playbackAttemptId = 'ack:3';
        window.newest = window.transport.playAcknowledgment(request);
        window.newest.result.then(event => window.result3 = event);
      }
    });
    const request = structuredClone(window.request); request.identity.playbackAttemptId = 'ack:2';
    window.middle = window.transport.playAcknowledgment(request);
    window.middle.result.then(event => window.result2 = event);
  })()`);
  await expect.poll(() => page.evaluate("window.result3?.state")).toBe("completed");
  expect(await page.evaluate("window.result2.state")).toBe("superseded");
  expect(
    await page.evaluate(
      "window.playbackEvents.filter(event => event.state === 'completed').map(event => event.identity.playbackAttemptId)",
    ),
  ).toEqual(["ack:3"]);
  expect(
    await page.evaluate(
      "window.playbackEvents.some(event => event.state === 'started' && event.identity.playbackAttemptId === 'ack:2')",
    ),
  ).toBe(false);
  await cleanup(page);
});

test("microphone RTP and local VAD continue during a finite clip", async ({ page }) => {
  await fixture(page);
  await page.evaluate(`(async () => {
    window.transport.openInput(() => {});
    window.inputBefore = await window.outboundMicrophoneRtp(window.transport.current.peer, 'before');
  })()`);
  await play(page);
  await page.evaluate(`(() => {
    window.childTone = window.context.createOscillator(); window.childTone.frequency.value = 220;
    window.childGain = window.context.createGain(); window.childGain.gain.value = 0.15;
    window.childTone.connect(window.childGain); window.childGain.connect(window.microphoneDestination); window.childTone.start();
  })()`);
  await expect
    .poll(() => page.evaluate("window.events.some(event => event.type === 'microphone.activity_started')"), {
      intervals: [20],
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate("window.events.some(event => event.type === 'microphone.speech_started')"), {
      intervals: [20],
    })
    .toBe(true);
  expect(await page.evaluate("window.clip.currentTime > 0 && window.clip.currentTime < window.clip.duration")).toBe(
    true,
  );
  expect(
    await page.evaluate(
      "(async () => (await window.outboundMicrophoneRtp(window.transport.current.peer, 'during')).bytesSent > window.inputBefore.bytesSent)()",
    ),
  ).toBe(true);
  await page.evaluate("window.childTone.stop(); window.handle.cancel('interrupted')");
  await cleanup(page);
});

test("overlapping attempts supersede the old owner; duplicate/retained callbacks cannot revive it", async ({
  page,
}) => {
  await fixture(page);
  await play(page);
  await page.evaluate(`(() => {
    window.oldEnd = window.callbacks.ended; window.oldHandle = window.handle;
    window.request.identity.playbackAttemptId = 'ack:2'; window.request.identity.choreographyEpoch = 2;
    window.handle = window.transport.playAcknowledgment(window.request); window.handle.result.then(event => window.result2 = event);
    window.oldHandle.cancel(); window.oldEnd({isTrusted: true});
  })()`);
  await expect.poll(() => page.evaluate("window.result2?.state")).toBe("completed");
  expect(await page.evaluate("window.result.state")).toBe("superseded");
  expect(
    await page.evaluate(
      "window.playbackEvents.filter(event => event.state === 'completed').map(event => event.identity.playbackAttemptId)",
    ),
  ).toEqual(["ack:2"]);
  expect(await page.evaluate("window.playbackEvents[0].identity.choreographyEpoch")).toBe(1);
  expect(
    await page.evaluate(
      "(() => {try {window.transport.playAcknowledgment(window.request); return false;} catch {return true;}})()",
    ),
  ).toBe(true);
  await cleanup(page);
});

test("actual source activation retires the clip owner before attaching replacement output", async ({ page }) => {
  await fixture(page);
  await page.evaluate("window.transport.context.getOutputTimestamp = () => ({contextTime: 0, performanceTime: 0})");
  await play(page);
  await page.evaluate(`(async () => {
    const seed = {sceneIndex: 0, evaluatedSceneIndex: 0, decision: 'STAY', childUtterance: 'One', transcriptRevision: 1, answerVersion: 'one:v1'};
    window.preparation = window.transport.prepareReplacement(seed);
  })()`);
  await expect.poll(() => page.evaluate("window.providers[1]?.channel?.readyState")).toBe("open");
  await page.evaluate("window.providers[1].channel.send(JSON.stringify({type:'session.started'}))");
  await page.evaluate("window.preparation.then(id => window.transport.activateSource(id))");
  await expect.poll(() => page.evaluate("window.result?.state")).toBe("source_retired");
  expect(await page.evaluate("window.transport.activeSourceId")).toBe(2);
  expect(await page.evaluate("window.playbackEvents.some(event => event.state === 'completed')")).toBe(false);
  await cleanup(page);
});

for (const stage of ["fetch", "decode", "hash", "invalid"] as const) {
  test(`asset ${stage} failure/cancellation cannot start or complete production playback`, async ({ page }) => {
    await fixture(page);
    await page.evaluate(`(async () => {
      window.assetStarted = false;
      ${stage === "fetch" ? "window.fetch = (url, options) => new Promise(resolve => { window.assetStarted = true; window.fetchSignal = options.signal; window.resolveAsset = resolve; });" : stage === "decode" ? "window.transport.context.decodeAudioData = () => new Promise(resolve => { window.assetStarted = true; window.resolveDecode = resolve; });" : stage === "hash" ? "window.request.asset.sha256 = '0'.repeat(64); window.assetStarted = true;" : "const invalid = new TextEncoder().encode('invalid'); window.request.asset.url = URL.createObjectURL(new Blob([invalid])); window.request.asset.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', invalid)), x => x.toString(16).padStart(2, '0')).join(''); window.assetStarted = true;"}
      window.handle = window.transport.playAcknowledgment(window.request); window.handle.result.then(event => window.result = event);
    })()`);
    await expect.poll(() => page.evaluate("window.assetStarted")).toBe(true);
    if (stage === "fetch" || stage === "decode") {
      await page.evaluate("window.handle.cancel('stopped')");
      await page.evaluate(
        stage === "fetch"
          ? "window.resolveAsset({ok: true, arrayBuffer: async () => new ArrayBuffer(10)})"
          : "window.resolveDecode({duration: 0.9})",
      );
      await expect.poll(() => page.evaluate("window.result?.state")).toBe("stopped");
      if (stage === "fetch") expect(await page.evaluate("window.fetchSignal.aborted")).toBe(true);
    } else await expect.poll(() => page.evaluate("window.result?.state")).toBe("failed");
    expect(
      await page.evaluate(
        "window.playbackEvents.some(event => ['ready', 'started', 'completed'].includes(event.state))",
      ),
    ).toBe(false);
    await cleanup(page);
  });
}
