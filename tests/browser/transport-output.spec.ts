import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// Serve the real transport modules as ESM. Only the provider is replaced by a
// local WebRTC peer: actual RTP, jitter/decoder buffering, HTMLAudioElement,
// Web Audio observation and recording all run in Chromium. No billed services.
async function fixture(page: Page, microphoneMode: "silent" | "continuous" = "silent") {
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
    window.microphone = window.replacementMicrophone(window.context, ${JSON.stringify(microphoneMode)});
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

test("source contract: retirement closes A permanently; connected B alone can be promoted and permitted", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(`(async () => {
    window.audioA = document.querySelector('audio');
    window.streamA = window.audioA.srcObject;
    window.sourceA = window.transport.current;
    window.lateObserverA = window.sourceA.observer.emit;
    window.lateMessageA = window.sourceA.channel.onmessage;
    window.lateCloseA = window.sourceA.channel.onclose;
    window.lateErrorA = window.sourceA.channel.onerror;
    window.lateConnectionA = window.sourceA.peer.onconnectionstatechange;
    window.lateTrackCallbackA = window.sourceA.peer.ontrack;
    window.lateTrackA = window.providers[0].destination.stream.getAudioTracks()[0].clone();
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
    window.replacementReady = false;
    window.preparingB = window.transport.prepareReplacement({ sceneIndex: 2, decision: 'ADVANCE', childUtterance: 'Two' }).then(id => { window.replacementReady = true; window.idB = id; });
    window.sourceB = window.transport.pending;
    window.clientPeers = [window.sourceA.peer, window.sourceB.peer];
  })()`);
  await expect.poll(() => page.evaluate("window.sourceB.channel.readyState")).toBe("open");
  expect(await page.evaluate("window.sourceB.peer.remoteDescription.type")).toBe("answer");
  await expect.poll(() => page.evaluate("window.sourceB.activity.state")).toBe("active");
  expect(await page.evaluate("window.audioA.srcObject !== window.sourceB.remote")).toBe(true);
  expect(await page.evaluate("window.replacementReady || window.sourceB.ready")).toBe(false);
  expect(
    await page.evaluate(
      "window.transport.activeSourceId === window.idA && !window.sourceA.retired && window.audioA.srcObject === window.streamA && window.audioA.muted",
    ),
  ).toBe(true);
  await page.evaluate(`(() => {
    window.providers[0].channel.send(JSON.stringify({type: 'session.started'}));
    window.providers[1].channel.send(JSON.stringify({type: 'session.output_transcript.delta', delta: 'hidden B', start_ms: 0, end_ms: 1}));
  })()`);
  await expect.poll(() => page.evaluate("window.events.some(event => event.type === 'session.started')")).toBe(true);
  expect(await page.evaluate("window.replacementReady")).toBe(false);
  await page.evaluate(`(async () => {
    window.providers[1].channel.send(JSON.stringify({type: 'session.started'}));
    await window.preparingB;
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
  expect(
    await page.evaluate("window.events.some(event => event.type === 'transcript' && event.delta === 'hidden B')"),
  ).toBe(false);
  expect(await page.evaluate("window.transport.activeSourceId === window.idA && !window.sourceA.retired")).toBe(true);
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
  expect(
    await page.evaluate(
      "window.sourceA.retired && window.sourceA.observer.closed && window.sourceA.peer.connectionState === 'closed'",
    ),
  ).toBe(true);
  await expect.poll(() => page.evaluate("window.sourceA.channel.readyState")).toBe("closed");
  expect(await page.evaluate("window.streamA.getTracks().every(track => track.readyState === 'ended')")).toBe(true);
  expect(
    await page.evaluate(
      "window.sourceB.peer.connectionState === 'connected' && window.sourceB.channel.readyState === 'open'",
    ),
  ).toBe(true);
  await page.evaluate(`(() => {
    window.contract.ready('A'); window.contract.activate('A'); window.contract.permit('old-answer');
    // Even an accidentally late global-unmute callback cannot restore A's
    // actual stopped playback track or closed peer.
    window.transport.setOutputBlocked(false);
  })()`);
  expect(
    await page.evaluate("window.audioA.srcObject === null && window.audioA.paused && !window.contract.eligible('A')"),
  ).toBe(true);
  expect(await page.evaluate("window.audioA.muted")).toBe(true);
  await page.evaluate(`(() => {
    window.beforeLate = window.events.length;
    window.lateObserverA({type: 'output.activity', state: 'quiet'});
    window.lateObserverA({type: 'output.activity', state: 'active'});
    window.lateCloseA(); window.lateErrorA(); window.lateConnectionA();
    window.lateTrackCallbackA({track: window.lateTrackA});
    window.transport.retireSource(window.idA);
    window.cannotReactivateA = !window.transport.activateSource(window.idA);
    for (const type of ['session.output_transcript.delta', 'session.closed', 'error']) {
      window.lateMessageA({data: JSON.stringify({type, delta: 'late A', start_ms: 0, end_ms: 1})});
    }
  })()`);
  await page.waitForTimeout(150);
  expect(await page.evaluate("window.events.length === window.beforeLate")).toBe(true);
  expect(
    await page.evaluate(
      "window.cannotReactivateA && window.audioA.srcObject === null && window.audioA.paused && window.lateTrackA.readyState === 'ended'",
    ),
  ).toBe(true);
  await page.evaluate("window.transport.startRecording()");
  // Promotion attaches only B and is still blocked, even after a stale unmute.
  expect(await page.evaluate("window.transport.activateSource(window.idB)")).toBe(true);
  await expect.poll(() => page.evaluate("!window.audioA.paused")).toBe(true);
  expect(await page.evaluate("window.audioA.muted && window.audioA.srcObject !== window.streamA")).toBe(true);
  await page.evaluate("window.contract.permit('new-answer')");
  expect(await page.evaluate("!window.audioA.muted && window.contract.eligible('B')")).toBe(true);
  await page.waitForTimeout(400);
  const recordingRms = await page.evaluate<{ blocked: number; permitted: number }>(`(async () => {
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

test("teardown while real B has SDP and an open channel but no started closes both peers", async ({ page }) => {
  await fixture(page);
  await page.evaluate(`(() => {
    window.sourceA = window.transport.current;
    window.prepareResult = null;
    window.preparing = window.transport.prepareReplacement({sceneIndex: 2, decision: 'ADVANCE', childUtterance: 'Two'}).then(() => { window.prepareResult = 'unexpected success'; }, error => { window.prepareResult = error.message; });
    window.sourceB = window.transport.pending;
  })()`);
  await expect.poll(() => page.evaluate("window.sourceB.channel.readyState")).toBe("open");
  expect(await page.evaluate("window.prepareResult")).toBeNull();
  await page.evaluate("window.transport.stopMedia(); window.transport.close()");
  await expect.poll(() => page.evaluate("window.prepareResult")).toContain("setup ended");
  expect(
    await page.evaluate(
      "[window.sourceA, window.sourceB].every(source => source.peer.connectionState === 'closed' && source.retired)",
    ),
  ).toBe(true);
  await page.evaluate(`(() => {
    window.sourceB.channel.onmessage({data: JSON.stringify({type: 'session.started'})});
    window.providers.forEach(source => { source.peer.close(); source.tone.stop(); });
    window.context.close();
  })()`);
  expect(await page.evaluate("window.sourceB.ready")).toBe(false);
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("promoted B receives the production ADVANCE instruction while blocked, then permits playback", async ({
  page,
}) => {
  await fixture(page);
  expect(await page.evaluate("window.context.state")).toBe("running");
  await page.evaluate(`(() => {
    window.idA = window.transport.activeSourceId;
    window.preparing = window.transport.prepareReplacement({sceneIndex: 2, decision: 'ADVANCE', childUtterance: 'Two'}).then(id => { window.idB = id; });
  })()`);
  await expect.poll(() => page.evaluate("window.providers[1]?.channel?.readyState")).toBe("open");
  await page.evaluate(`(async () => {
    window.commandsA = []; window.commandsB = [];
    window.providers[0].channel.onmessage = ({data}) => window.commandsA.push(JSON.parse(data));
    window.providers[1].channel.onmessage = ({data}) => {
      const command = JSON.parse(data); window.commandsB.push(command);
      window.providers[1].channel.send(JSON.stringify({type: 'session.instructions.appended', client_event_id: command.event_id}));
    };
    window.providers[1].channel.send(JSON.stringify({type: 'session.started'}));
    await window.preparing;
    if (!window.transport.activateSource(window.idB)) throw new Error('Promotion failed');
    window.blockedAtSend = document.querySelector('audio').muted;
    window.transport.send({type: 'session.instructions.append', event_id: 'authoritative-advance', delegation_id: null, content: window.advanceContext(window.sceneAt(2))});
  })()`);
  await expect.poll(() => page.evaluate("window.commandsB.length")).toBe(1);
  expect(await page.evaluate("window.commandsA")).toEqual([]);
  expect(await page.evaluate("window.blockedAtSend")).toBe(true);
  expect(await page.evaluate("window.commandsB[0]")).toEqual({
    type: "session.instructions.append",
    event_id: "authoritative-advance",
    delegation_id: null,
    content: await page.evaluate<string>("window.advanceContext(window.sceneAt(2))"),
  });
  await expect
    .poll(() =>
      page.evaluate(
        "window.events.some(event => event.type === 'context.appended' && event.clientEventId === 'authoritative-advance')",
      ),
    )
    .toBe(true);
  expect(await page.evaluate("document.querySelector('audio').muted")).toBe(true);
  await page.evaluate("window.transport.setOutputBlocked(false)");
  await expect.poll(() => page.evaluate("!document.querySelector('audio').paused")).toBe(true);
  expect(
    await page.evaluate(
      "!document.querySelector('audio').muted && document.querySelector('audio').srcObject === window.transport.current.remote",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      "window.transport.activeSourceId === window.idB && window.transport.current.peer.connectionState === 'connected'",
    ),
  ).toBe(true);
  await page.evaluate(
    "window.transport.close(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); window.context.close()",
  );
  expect(await page.evaluate("window.failures")).toEqual([]);
});

test("continuous experiment microphone has low nonzero PCM and real outbound audio RTP", async ({ page }) => {
  await fixture(page, "continuous");
  const inputRms = await page.evaluate<number>(`(async () => {
    const source = window.context.createMediaStreamSource(window.microphone.stream);
    const analyser = window.context.createAnalyser();
    const sink = window.context.createGain(); sink.gain.value = 0;
    source.connect(analyser); analyser.connect(sink); sink.connect(window.context.destination);
    await new Promise(resolve => setTimeout(resolve, 100));
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    source.disconnect(); analyser.disconnect(); sink.disconnect();
    return rms;
  })()`);
  expect(inputRms).toBeGreaterThan(0.0001);
  expect(inputRms).toBeLessThan(0.002);
  await page.evaluate(`(async () => {
    window.rtpBefore = await window.outboundMicrophoneRtp(window.transport.current.peer, 'before');
  })()`);
  await expect
    .poll(() =>
      page.evaluate<boolean>(`(async () => {
    window.rtpAfter = await window.outboundMicrophoneRtp(window.transport.current.peer, 'after');
    return window.rtpAfter.packetsSent > window.rtpBefore.packetsSent && window.rtpAfter.bytesSent > window.rtpBefore.bytesSent;
  })()`),
    )
    .toBe(true);
  expect(await page.evaluate("window.rtpAfter.reports.every(report => Number.isFinite(report.timestamp))")).toBe(true);
  expect(await page.evaluate("window.context.state")).toBe("running");
  await page.evaluate(
    "window.transport.close(); window.microphone.close(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); window.context.close()",
  );
  expect(await page.evaluate("window.failures")).toEqual([]);
});

// Exercise the production LessonSession -> BrowserTransport handoff, including
// provider callbacks, real peers and the recording/playback mix.
test("integrated stale ADVANCE retires A and instructs B before permission", async ({ page }) => {
  await fixture(page);
  await page.evaluate(`(() => {
    window.sourceA = window.transport.current;
    window.lateA = window.sourceA.channel.onmessage;
    window.commandsA = []; window.commandsB = []; window.sendState = [];
    window.providers[0].channel.onmessage = ({data}) => window.commandsA.push(JSON.parse(data));
    window.session = new window.LessonSession(window.transport, async () => ({status: 'evaluated', probability: 1, model: 'test', latencyMs: 1}), snapshot => {
      if (snapshot.sceneIndex === 1) setTimeout(() => window.session.displayed(1), 0);
    });
    window.transport.onEvent = event => { window.events.push(event); window.session.receive(event); };
    window.session.receive({type: 'session.started'}); window.session.displayed(0);
    const send = window.transport.send.bind(window.transport);
    window.transport.send = command => { window.sendState.push({ source: window.transport.activeSourceId, blocked: document.querySelector('audio').muted, content: command.content }); send(command); };
    window.session.receive({type: 'microphone.speech_started'});
    window.session.receive({type: 'transcript', speaker: 'child', delta: 'One', startMs: 1000, endMs: 1100});
    window.session.receive({type: 'microphone.speech_stopped', quietMs: 900});
    window.hidden = setInterval(() => window.providers[0].channel.send(JSON.stringify({type: 'session.output_transcript.delta', delta: 'old scene ', start_ms: 0, end_ms: 100})), 100);
    window.transport.startRecording();
  })()`);
  await expect.poll(() => page.evaluate("Boolean(window.transport.pending)"), { timeout: 8000 }).toBe(true);
  await expect.poll(() => page.evaluate("window.providers[1]?.channel?.readyState")).toBe("open");
  expect(await page.evaluate("window.session.snapshot.sceneIndex")).toBe(1);
  expect(await page.evaluate("document.querySelector('audio').muted")).toBe(true);
  await page.evaluate(`(() => {
    window.sourceB = window.transport.pending;
    window.providers[1].channel.onmessage = ({data}) => window.commandsB.push(JSON.parse(data));
    window.providers[1].channel.send(JSON.stringify({type: 'session.started'}));
  })()`);
  await expect.poll(() => page.evaluate("window.transport.activeSourceId")).toBe(2);
  await expect.poll(() => page.evaluate("window.commandsB.length")).toBe(1);
  expect(await page.evaluate("window.sendState")).toEqual([
    { source: 2, blocked: true, content: await page.evaluate("window.advanceContext(window.sceneAt(1))") },
  ]);
  expect(
    await page.evaluate(
      "window.commandsA.filter(command => command.content === window.advanceContext(window.sceneAt(1)))",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      "window.sourceA.retired && window.sourceA.peer.connectionState === 'closed' && window.sourceA.channel.readyState === 'closed'",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      "window.session.events.filter(event => event.type === 'answer.response_gate_released').map(event => event.detail.reason)",
    ),
  ).toEqual(["replacement_source"]);
  await page.evaluate(`(() => {
    clearInterval(window.hidden);
    window.beforeLate = window.events.length;
    window.lateA({data: JSON.stringify({type: 'session.output_transcript.delta', delta: 'late A', start_ms: 0, end_ms: 1})});
    window.lateA({data: JSON.stringify({type: 'session.input_transcript.delta', delta: 'Nine', start_ms: 0, end_ms: 1})});
    window.providers[0].level.gain.value = 0.8;
  })()`);
  expect(await page.evaluate("window.events.length === window.beforeLate")).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        "!document.querySelector('audio').muted && window.transport.playbackReady && window.transport.remoteGain.gain.value === 1",
      ),
    )
    .toBe(true);
  await page.waitForTimeout(300);
  const rms = await page.evaluate<{ blocked: number; permitted: number }>(`(async () => {
    window.transport.stopMedia(); const recording = await window.transport.recording();
    const decoded = await window.context.decodeAudioData(await recording.blob.arrayBuffer());
    const pcm = decoded.getChannelData(0); const rate = decoded.sampleRate;
    const rms = samples => Math.sqrt(samples.reduce((sum, x) => sum + x*x, 0) / samples.length);
    return {blocked: rms(pcm.slice(rate * 0.3, rate)), permitted: rms(pcm.slice(-rate * 0.15))};
  })()`);
  expect(rms.blocked).toBeLessThan(0.001);
  expect(rms.permitted).toBeGreaterThan(0.01);
  await page.evaluate(
    "window.transport.close(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); window.context.close()",
  );
});

for (const activity of ["transcript", "microphone.activity_started"] as const) {
  test(`integrated ${activity} cancels preparing B and closes its peer`, async ({ page }) => {
    await fixture(page);
    await page.evaluate(`(() => {
      window.session = new window.LessonSession(window.transport, async () => ({status: 'evaluated', probability: 1, model: 'test', latencyMs: 1}), snapshot => {
        if (snapshot.sceneIndex === 1) setTimeout(() => window.session.displayed(1), 0);
      });
      window.transport.onEvent = event => window.session.receive(event);
      window.session.receive({type: 'session.started'}); window.session.displayed(0);
      window.session.receive({type: 'microphone.speech_started'});
      window.session.receive({type: 'transcript', speaker: 'child', delta: 'One', startMs: 1000, endMs: 1100});
      window.session.receive({type: 'microphone.speech_stopped', quietMs: 900});
      window.hidden = setInterval(() => window.providers[0].channel.send(JSON.stringify({type: 'session.output_transcript.delta', delta: 'old ', start_ms: 0, end_ms: 100})), 100);
    })()`);
    await expect
      .poll(() => page.evaluate("window.transport.pending?.channel?.readyState"), { timeout: 8000 })
      .toBe("open");
    await page.evaluate(`(() => {
      window.sourceB = window.transport.pending; window.lateB = window.sourceB.channel.onmessage;
      window.session.receive(${activity === "transcript" ? "{type: 'transcript', speaker: 'child', delta: 'Two', startMs: 4000, endMs: 4100}" : "{type: 'microphone.activity_started'}"});
      window.lateB({data: JSON.stringify({type: 'session.started'})}); clearInterval(window.hidden);
    })()`);
    expect(
      await page.evaluate(
        "window.sourceB.retired && window.sourceB.peer.connectionState === 'closed' && window.sourceB.channel.readyState === 'closed'",
      ),
    ).toBe(true);
    expect(await page.evaluate("window.transport.activeSourceId")).toBe(1);
    expect(await page.evaluate("document.querySelector('audio').muted")).toBe(true);
    expect(await page.evaluate("window.session.events.some(event => event.type === 'replacement.promoted')")).toBe(
      false,
    );
    await page.evaluate(
      "window.session.dispose(); window.providers.forEach(source => { source.peer.close(); source.tone.stop(); }); window.context.close()",
    );
  });
}
