/** Targeted billed experiment: one initial session plus one seeded ADVANCE replacement.
 * REPLACEMENT_MICROPHONE=silent|continuous selects the input control (default: continuous).
 * Uses the configured local app; never loads or exports credentials.
 * BASE_URL=http://127.0.0.1:3000 node scripts/live-replacement-startup.mjs
 */
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { REPLACEMENT_STARTUP_SEED } from "./live/replacement-startup-seed.mjs";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const microphoneMode = process.env.REPLACEMENT_MICROPHONE ?? "continuous";
if (!["silent", "continuous"].includes(microphoneMode)) throw new Error("Invalid REPLACEMENT_MICROPHONE");
const output = process.env.LIVE_OUT ?? `test-results/replacement-timeline/${microphoneMode}`;
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const results = {
  date: new Date().toISOString(),
  baseURL,
  clock: "browser.performance.now",
  microphoneMode,
  samples: [],
};
try {
  await page.route("**/replacement-measure/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (name === "index") {
      await route.fulfill({
        contentType: "text/html",
        body: `<button>Start</button><div data-scene></div><audio muted></audio><script type="module">
        import { BrowserTransport } from './browser-transport';
        import { replacementMicrophone, outboundMicrophoneRtp, microphoneRtpDeltas } from './replacement-input.mjs';
        window.replacementMicrophone = replacementMicrophone; window.outboundMicrophoneRtp = outboundMicrophoneRtp; window.microphoneRtpDeltas = microphoneRtpDeltas;
        import { replacementSessionInput, evaluationResultContext, sceneAt, OBJECTS } from './lesson';
        window.Transport = BrowserTransport;
        window.replacementSessionInput = replacementSessionInput;
        window.evaluationResultContext = evaluationResultContext;
        window.sceneAt = sceneAt;
        window.showScene = index => {
          window.sceneIndex = index;
          const scene = sceneAt(index);
          document.querySelector('[data-scene]').dataset.scene = scene.id;
          document.querySelector('[data-scene]').textContent = OBJECTS[scene.object].emoji.repeat(scene.quantity);
        };
      </script>`,
      });
      return;
    }
    const source = await readFile(
      path.join(
        process.cwd(),
        name === "replacement-input.mjs" ? "scripts/live" : "lib",
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
  await page.goto(`${baseURL}/replacement-measure/index`);
  await page.waitForFunction("typeof window.Transport === 'function'");
  await page.evaluate(mode => {
    window.diagnostics = [];
    window.showScene(1);
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
          if (event.type === "session.instructions.appended")
            window.diagnostics.push({
              sourceNumber,
              at: performance.now(),
              type: event.type,
              clientEventId: event.client_event_id,
              startMs: event.start_ms,
              endMs: event.end_ms,
            });
          if (event.type === "session.closed")
            window.diagnostics.push({ sourceNumber, at: performance.now(), type: event.type });
          if (event.type === "error")
            window.diagnostics.push({ sourceNumber, at: performance.now(), type: event.type, code: event.error?.code });
        });
        const send = channel.send.bind(channel);
        channel.send = raw => {
          const command = JSON.parse(raw);
          send(raw);
          if (command.type === "session.instructions.append")
            window.diagnostics.push({
              sourceNumber,
              at: performance.now(),
              type: "outcome.instruction_sent",
              eventId: command.event_id,
              content: command.content,
            });
        };
        return channel;
      }
    };
    window.audioContext = new AudioContext();
    window.microphoneContextBeforeStart = window.audioContext.state;
    window.microphone = window.replacementMicrophone(window.audioContext, mode);
    navigator.mediaDevices.getUserMedia = async () => window.microphone.stream.clone();
    window.transport = new window.Transport(document.querySelector("audio"));
    window.transport.setOutputBlocked(true);
    window.lessonEvents = [];
    document.querySelector("button").onclick = async () => {
      // The synthetic microphone needs a running graph to deliver continuous RTP.
      // Resume it in the user gesture, just as the provider-free fixture does.
      await window.audioContext.resume();
      if (window.audioContext.state !== "running") {
        window.failure = "Synthetic microphone context did not start";
        return;
      }
      window.starting = window.transport.start(
        event => {
          window.lessonEvents.push(event);
          if (event.type === "output.activity")
            window.diagnostics.push({ sourceNumber: window.transport.activeSourceId, at: performance.now(), ...event });
        },
        error => {
          window.failure = error;
        },
      );
    };
  }, microphoneMode);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    "window.diagnostics.some(event => event.sourceNumber === 1 && event.type === 'session.started') || window.failure",
    null,
    { timeout: 35_000 },
  );
  await page.evaluate(() => window.starting);
  if (await page.evaluate(() => window.failure)) throw new Error("Initial voice session failed");
  const sample = await page.evaluate(async seed => {
    // Model the authoritative display change already completed by the app.
    window.showScene(seed.sceneIndex);
    const authorityBefore = window.transport.activeSourceId;
    const id = await window.transport.prepareReplacement(seed);
    const source = window.transport.pending;
    window.replacement = source;
    window.rtpSnapshots = [await window.outboundMicrophoneRtp(source.peer, "ready")];
    const result = {
      seed,
      microphone: {
        mode: window.microphone.mode,
        frequencyHz: window.microphone.frequencyHz,
        amplitude: window.microphone.amplitude,
      },
      microphoneContextBeforeStart: window.microphoneContextBeforeStart,
      microphoneContextDuringSample: window.audioContext.state,
      previousScene: window.sceneAt(1),
      currentScene: window.sceneAt(window.sceneIndex),
      timing: window.transport.replacementTiming,
      authorityBefore,
      authorityAfterPreparation: window.transport.activeSourceId,
      readyBeforePromotion: source.ready,
      outputActivityAtReady: source.activity.state,
      pendingDetached: document.querySelector("audio").srcObject !== source.remote,
      mutedBeforePromotion: document.querySelector("audio").muted,
      seedReceiptConfirmed:
        JSON.stringify(
          window.diagnostics.find(event => event.sourceNumber === id && event.type === "session.started")?.input,
        ) === JSON.stringify(window.replacementSessionInput(seed)),
    };
    window.sample = result;
    if (!result.seedReceiptConfirmed) throw new Error("Provider did not confirm generated startup input");
    if (
      authorityBefore !== result.authorityAfterPreparation ||
      !result.pendingDetached ||
      !result.mutedBeforePromotion ||
      !source.ready
    )
      throw new Error("Preparation isolation failed");
    if (!window.transport.activateSource(id)) throw new Error("Replacement promotion failed");
    result.promotedAt = performance.now();
    window.rtpSnapshots.push(await window.outboundMicrophoneRtp(source.peer, "promoted"));
    result.blockedAfterPromotion = document.querySelector("audio").muted;
    result.aRetiredAfterPromotion = !window.peers[0] || window.peers[0].connectionState === "closed";
    if (!result.blockedAfterPromotion || !result.aRetiredAfterPromotion) throw new Error("Promotion isolation failed");
    result.instruction = window.evaluationResultContext({
      evaluatedAnswer: seed.childUtterance,
      evaluatedScene: window.sceneAt(seed.evaluatedSceneIndex),
      transcriptRevision: seed.transcriptRevision,
      answerVersion: seed.answerVersion,
      meaning: "met_advancement_criterion",
      action: seed.decision,
      displayedScene: window.sceneAt(seed.sceneIndex),
    });
    result.instructionEventId = "replacement-authoritative-advance";
    window.transport.send({
      type: "session.instructions.append",
      event_id: result.instructionEventId,
      delegation_id: null,
      content: result.instruction,
    });
    result.instructionSentAt = window.diagnostics.find(
      event => event.sourceNumber === id && event.eventId === result.instructionEventId,
    ).at;
    window.transport.setOutputBlocked(false);
    result.outputPermittedAt = performance.now();
    return result;
  }, REPLACEMENT_STARTUP_SEED);
  results.samples.push(sample);
  console.log(JSON.stringify(sample));
  // Fixed bounded observation collects ACK, transcript and decoded-media evidence,
  // including connection/authority state when no response arrives.
  await page.waitForTimeout(1000);
  await page.evaluate(async () =>
    window.rtpSnapshots.push(await window.outboundMicrophoneRtp(window.replacement.peer, "after_instruction_1s")),
  );
  await page.waitForTimeout(19_000);
  const observation = await page.evaluate(async () => {
    window.rtpSnapshots.push(await window.outboundMicrophoneRtp(window.replacement.peer, "observation_end"));
    const source = window.replacement;
    const sample = window.sample;
    const events = window.diagnostics.filter(event => event.sourceNumber === source.id);
    const sentAt = sample.instructionSentAt;
    const ack = events.find(
      event => event.type === "session.instructions.appended" && event.clientEventId === sample.instructionEventId,
    );
    const transcript = events.filter(event => event.type === "session.output_transcript.delta" && event.at >= sentAt);
    const firstTranscript = transcript[0];
    const firstMedia = events.find(event => event.type === "output.activity" && event.state === "active");
    const elapsed = (end, start) => (end === undefined ? null : end - start);
    return {
      observationEndedAt: performance.now(),
      rtpSnapshots: window.rtpSnapshots,
      rtpDeltas: window.microphoneRtpDeltas(window.rtpSnapshots),
      rtpIncreasingAfterReady:
        window.rtpSnapshots.every(snapshot => snapshot.packetsSent !== null && snapshot.bytesSent !== null) &&
        window.rtpSnapshots.at(-1).packetsSent > window.rtpSnapshots[0].packetsSent &&
        window.rtpSnapshots.at(-1).bytesSent > window.rtpSnapshots[0].bytesSent,
      rtpIncreasingAfterPromotion:
        window.rtpSnapshots.every(snapshot => snapshot.packetsSent !== null && snapshot.bytesSent !== null) &&
        window.rtpSnapshots.at(-1).packetsSent > window.rtpSnapshots[1].packetsSent &&
        window.rtpSnapshots.at(-1).bytesSent > window.rtpSnapshots[1].bytesSent,
      matchingAppendAckAt: ack?.at ?? null,
      firstOutputTranscriptAt: firstTranscript?.at ?? null,
      firstOutputMediaActiveAt: firstMedia?.at ?? null,
      timings: {
        readyToInstructionSentMs: sentAt - sample.timing.replacement_ready_at,
        instructionSentToAppendAckMs: elapsed(ack?.at, sentAt),
        instructionSentToFirstTranscriptMs: elapsed(firstTranscript?.at, sentAt),
        readyToFirstTranscriptMs: elapsed(firstTranscript?.at, sample.timing.replacement_ready_at),
        outputPermittedToFirstTranscriptMs: elapsed(firstTranscript?.at, sample.outputPermittedAt),
        outputPermittedToFirstMediaActiveMs: elapsed(firstMedia?.at, sample.outputPermittedAt),
      },
      transcript: transcript.map(event => event.delta).join(""),
      outputTranscriptsBeforeInstruction: events.filter(
        event => event.type === "session.output_transcript.delta" && event.at < sentAt,
      ),
      responded: transcript.length > 0,
      currentSceneReferenced: /butterfl/i.test(transcript.map(event => event.delta).join("")),
      previousSceneReferenced: /duck/i.test(transcript.map(event => event.delta).join("")),
      finalState: {
        channel: source.channel.readyState,
        peer: source.peer.connectionState,
        outputActivity: source.activity.state,
        authoritative: window.transport.activeSourceId === source.id,
        permitted: !document.querySelector("audio").muted && !window.transport.outputBlocked,
        playbackAttached: document.querySelector("audio").srcObject === source.remote,
        playbackPaused: document.querySelector("audio").paused,
        displayedSceneIndex: window.sceneIndex,
        displayedSceneId: document.querySelector("[data-scene]").dataset.scene,
        providerErrors: events.filter(event => event.type === "error"),
        providerClosures: events.filter(event => event.type === "session.closed"),
        transportFailure: window.failure ?? null,
      },
    };
  });
  results.observation = observation;
  results.diagnostics = await page.evaluate(() => window.diagnostics);
  console.log(JSON.stringify(observation));
  if (microphoneMode === "continuous" && !observation.rtpIncreasingAfterPromotion) {
    results.failure = "Continuous experiment microphone did not send increasing outbound RTP";
    process.exitCode = 1;
  }
  if (!observation.responded) {
    results.failure ??= "No replacement output transcript in the 20-second observation window";
    process.exitCode = 1;
  }
} catch (error) {
  results.failure = error instanceof Error ? error.message : "Experiment failed";
  process.exitCode = 1;
  console.error(results.failure);
} finally {
  results.diagnostics ??= await page.evaluate(() => window.diagnostics).catch(() => []);
  await page
    .evaluate(() => {
      window.transport?.close();
      window.peers?.forEach(peer => peer.close());
      window.microphone?.close();
      window.audioContext?.close();
    })
    .catch(() => {});
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
}
