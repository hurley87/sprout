import { test, expect, type Page } from "@playwright/test";
import { transportFixture } from "../helpers/transport-browser-fixture";
import { acknowledgmentFor } from "../../lib/acknowledgment-catalog";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any -- The Playwright page installs a dynamic test harness. */
declare global {
  interface Window {
    LessonSession: any;
    acknowledgmentFor: any;
    channel: any;
    commands: any[];
    context: AudioContext;
    evaluations: any[];
    providers: any[];
    restoreOutputClock: any;
    sceneAt: any;
    session: any;
    snapshots: any[];
    timeline: any[];
    transport: any;
  }
}

async function fixture(page: Page, confirm = true) {
  await transportFixture(page);
  await page.evaluate(`(async()=>{
   window.snapshots=[];window.timeline=[];window.commands=[];window.evaluations=[];
   document.body.insertAdjacentHTML('beforeend','<div id="scene"></div>');
   // The fixture has already exercised transport startup against real local RTP.
   // Attach the production controller to that connection; all later finite media,
   // source preparation/promotion, microphone fences and recording remain real.
   window.transport.start=async function(onEvent,onFailure){this.onEvent=onEvent;this.onFailure=onFailure;};
   const send=window.transport.send.bind(window.transport);
   window.transport.send=command=>{window.commands.push({source:window.transport.activeSourceId,command,at:performance.now()});send(command);};
   const recorder={create:async()=> 'synthetic',activate:async()=>{},append:async()=>{},
     appendTimeline:async(key,atMs,event)=>window.timeline.push({key,atMs,event}),
     finalize:async()=>{},markIncomplete:async()=>{},attachRecording:async()=>{}};
   window.session=new window.LessonSession(window.transport,async request=>{window.evaluations.push(request);return {status:'evaluated',probability:1,model:'synthetic',latencyMs:0};},snapshot=>{
     window.snapshots.push({...snapshot,at:performance.now()});
     const element=document.querySelector('#scene');element.dataset.scene=window.sceneAt(snapshot.sceneIndex).id;element.dataset.displayToken=snapshot.displayToken;
     if(${confirm} && snapshot.status!=='ended'){
       const index=snapshot.sceneIndex,token=snapshot.displayToken;
       requestAnimationFrame(()=>requestAnimationFrame(()=>window.session.displayed(index,token)));
     }
   },undefined,recorder);
   await window.session.start();window.channel.send(JSON.stringify({type:'session.started'}));
 })()`);
  await expect.poll(() => page.evaluate("window.session.snapshot.status")).toBe("active");
  if (!confirm) await page.evaluate("window.session.displayed(0,window.session.snapshot.displayToken)");
}
async function answer(page: Page, text = "One", offset = 1000) {
  await page.evaluate(
    ({ text, offset }) => {
      const w = window as unknown as { providers: { channel: RTCDataChannel }[] };
      w.providers.at(-1)!.channel.send(
        JSON.stringify({
          type: "session.input_transcript.delta",
          delta: text,
          start_ms: offset,
          end_ms: offset + 100,
        }),
      );
    },
    { text, offset },
  );
}
async function playback(page: Page, state: string, sceneIndex?: number) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ sceneIndex }) => {
            const events = window.timeline
              .filter(
                row =>
                  row.event.type === "local_playback" &&
                  (sceneIndex === undefined || row.event.identity.evaluatedSceneIndex === sceneIndex),
              )
              .map(row => row.event);
            const start = events.findLastIndex(event => event.state === "requested");
            return events.slice(start < 0 ? 0 : start).map(event => event.state);
          },
          { state, sceneIndex },
        ),
      { timeout: 15_000 },
    )
    .toContain(state);
}
async function ready(page: Page, providerCount = 2, priorQuestionCount = 0) {
  await expect.poll(() => page.evaluate("window.providers.length")).toBe(providerCount);
  await expect.poll(() => page.evaluate("window.providers.at(-1).channel?.readyState")).toBe("open");
  await page.evaluate("window.providers.at(-1).channel.send(JSON.stringify({type:'session.started'}))");
  await expect
    .poll(() => page.evaluate("window.commands.filter(e=>e.command.content?.includes('Ask only')).length"))
    .toBe(priorQuestionCount + 1);
}
async function cleanup(page: Page) {
  await page.evaluate(
    "window.session.dispose();window.providers.forEach(source=>{source.peer.close();source.tone.stop();});window.context.close()",
  );
}

test("actual spoken asset completes on old display, output fence precedes commit, confirmed display precedes fresh-source question and recording includes the clip", async ({
  page,
}) => {
  await fixture(page);
  await answer(page);
  await playback(page, "started");
  await expect(page.locator("#scene")).toHaveAttribute("data-scene", "hello-duck");
  await playback(page, "media_ended");
  await playback(page, "completed");
  await expect(page.locator("#scene")).toHaveAttribute("data-scene", "duck-friends");
  await ready(page);
  const facts = await page.evaluate(`(()=>{
  const events=window.session.events.filter(e=>e.type==='acknowledgment.playback').map(e=>e.detail);
  const commit=window.session.events.find(e=>e.type==='advance.committed');
  const display=window.session.events.find(e=>e.type==='advance.displayed');
  const command=window.commands.find(e=>e.command.content?.includes('Ask only'));
  const all=window.session.events;
  const completedOrder=all.findIndex(e=>e.type==='acknowledgment.playback'&&e.detail.state==='completed');
  const commitOrder=all.findIndex(e=>e.type==='advance.committed');
  const displayOrder=all.findIndex(e=>e.type==='advance.displayed');
  const questionOrder=all.findIndex(e=>e.type==='command.sent'&&e.detail.content?.includes('Ask only'));
  return {events,completedOrder,commitOrder,displayOrder,questionOrder,commitAt:commit.at,displayAt:display.at,commandSource:command.source,questionCommands:window.commands.filter(e=>e.command.content?.includes('Ask only')).length,
   oldSnapshots:window.snapshots.filter(s=>s.choreographyPhase==='ack_playing'||s.choreographyPhase==='ack_draining').map(s=>s.sceneIndex)};
 })()`);
  expect(facts).toMatchObject({ commandSource: 2, questionCommands: 1 });
  const order = facts as { completedOrder: number; commitOrder: number; displayOrder: number; questionOrder: number };
  expect(order.completedOrder).toBeGreaterThanOrEqual(0);
  expect(order.completedOrder).toBeLessThan(order.commitOrder);
  expect(order.commitOrder).toBeLessThan(order.displayOrder);
  expect(order.displayOrder).toBeLessThan(order.questionOrder);
  expect((facts as { oldSnapshots: number[] }).oldSnapshots.every(index => index === 0)).toBe(true);
  const result = (
    facts as { events: { state: string; renderFence: number; outputTimestamp: { contextTime: number } }[] }
  ).events.at(-1)!;
  expect(result.state).toBe("completed");
  expect(result.outputTimestamp.contextTime).toBeGreaterThanOrEqual(result.renderFence);
  const record = await page.evaluate(`(async()=>{
  window.session.end('parent_stop');await window.session.recordingSettled();
  const recording=await window.transport.recording();const buffer=await window.context.decodeAudioData(await recording.blob.arrayBuffer());
  const pcm=buffer.getChannelData(0);return {duration:buffer.duration,rms:Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length),timeline:window.timeline.filter(x=>x.event.type==='local_playback').map(x=>({atMs:x.atMs,...x.event}))};
 })()`);
  expect(record).toMatchObject({ rms: expect.any(Number) });
  expect((record as { rms: number }).rms).toBeGreaterThan(0.01);
  const clip = (
    record as { timeline: { state: string; text: string; identity: { correlationKey: string } }[] }
  ).timeline.at(-1)!;
  expect(clip).toMatchObject({ state: "completed" });
  expect(clip.text).toBe(acknowledgmentFor(0, clip.identity.correlationKey).text);
  await cleanup(page);
});

test("four-scene production-controller chain records each selected finite clip and confirms display before each fresh-source question", async ({
  page,
}, testInfo) => {
  await fixture(page);
  const answerText = ["One", "Two", "Three"];
  // FNV-1a parity inputs below are fixed from the immutable answer key shape
  // (scene|revision|start:text|source); these keys exercise both catalog families.
  const offsets = [1000, 1001, 1001];
  const trace: unknown[] = [];
  for (let i = 0; i < answerText.length; i++) {
    const oldScene = ["hello-duck", "duck-friends", "butterfly-garden"][i];
    const newScene = ["duck-friends", "butterfly-garden", "picnic"][i];
    const priorQuestionCount = i;
    await answer(page, answerText[i], offsets[i]);
    await playback(page, "started", i);
    await expect(page.locator("#scene")).toHaveAttribute("data-scene", oldScene);
    await playback(page, "media_ended", i);
    await playback(page, "completed", i);
    await expect(page.locator("#scene")).toHaveAttribute("data-scene", newScene);
    await ready(page, i + 2, priorQuestionCount);
    const stage = await page.evaluate(() => {
      const events: any[] = window.session.events;
      const playback = events.filter(e => e.type === "acknowledgment.playback").map(e => e.detail);
      const latest = playback.at(-1);
      const commit = events.findLast(e => e.type === "advance.committed");
      const display = events.findLast(e => e.type === "advance.displayed");
      const command = window.commands.findLast(e => e.command.content?.includes("Ask only"));
      const scene = document.querySelector("#scene")?.getAttribute("data-scene");
      const visibleToken = document.querySelector("#scene")?.getAttribute("data-display-token");
      const completedIndex = events.findLastIndex(
        e => e.type === "acknowledgment.playback" && e.detail.state === "completed",
      );
      const commitIndex = events.findLastIndex(e => e.type === "advance.committed");
      const displayIndex = events.findLastIndex(e => e.type === "advance.displayed");
      const questionIndex = events.findLastIndex(
        e => e.type === "command.sent" && e.detail.content?.includes("Ask only"),
      );
      const displayDetail = display?.detail;
      const pageOrigin = {
        pagePerformanceNow: performance.now(),
        wallNow: Date.now(),
        sessionCreatedAt: window.session.createdAt,
      };
      return {
        pageOrigin,
        scene,
        visibleToken,
        playbackAttemptId: latest?.identity.playbackAttemptId,
        assetId: latest?.assetId,
        mediaDuration: latest?.duration,
        outputFence: latest?.renderFence,
        outputTimestamp: latest?.outputTimestamp,
        commitAtMs: commit?.at,
        displayAtMs: display?.at,
        questionAtPerformanceMs: command?.at,
        completedIndex,
        commitIndex,
        displayIndex,
        questionIndex,
        questionSource: command?.source,
        ordering: events.map(e => (e.type === "acknowledgment.playback" ? `playback:${e.detail.state}` : e.type)),
        displayDetail,
      };
    });
    expect(stage.scene).toBe(newScene);
    expect(stage.questionSource).toBeGreaterThan(1);
    expect(stage.playbackAttemptId).toBeTruthy();
    expect(stage.mediaDuration).toBeGreaterThan(0);
    expect(stage.outputTimestamp.contextTime).toBeGreaterThanOrEqual(stage.outputFence);
    expect(stage.visibleToken).toBeTruthy();
    expect(stage.completedIndex).toBeGreaterThanOrEqual(0);
    expect(stage.completedIndex).toBeLessThan(stage.commitIndex);
    expect(stage.commitIndex).toBeLessThan(stage.displayIndex);
    expect(stage.displayIndex).toBeLessThan(stage.questionIndex);
    expect(stage.questionAtPerformanceMs).toBeGreaterThan(0);
    trace.push(stage);
  }

  const capture = await page.evaluate(async () => {
    window.session.end("parent_stop");
    await window.session.recordingSettled();
    const recording = await window.transport.recording();
    if (!recording) throw new Error("No browser transport recording was produced");
    const bytes = new Uint8Array(await recording.blob.arrayBuffer());
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    const audioContext = window.context;
    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    const captureStartedAt = (window.transport as unknown as { captureStartedAt: number }).captureStartedAt;
    const acknowledgmentResources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter(entry => entry.name.includes("/audio/acknowledgments/"))
      .map(entry => ({
        url: new URL(entry.name).pathname,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        duration: entry.duration,
        encodedBodySize: entry.encodedBodySize,
        transferSize: entry.transferSize,
      }));
    const clips = window.timeline
      .filter(x => x.event.type === "local_playback")
      .map(x => ({
        sessionAtMs: x.atMs,
        ...x.event,
      }));
    const correlations = await Promise.all(
      clips
        .filter(c => c.state === "completed")
        .map(async clip => {
          const select = window.acknowledgmentFor as unknown as (
            scene: number,
            key: string,
          ) => { id: string; url: string; sha256: string };
          const selected = select(clip.identity.evaluatedSceneIndex, clip.identity.correlationKey);
          const asset = await audioContext.decodeAudioData(await (await fetch(selected.url)).arrayBuffer());
          const recordingPcm = buffer.getChannelData(0),
            assetPcm = asset.getChannelData(0);
          const started = clips.find(
            event => event.identity.playbackAttemptId === clip.identity.playbackAttemptId && event.state === "started",
          );
          const mediaEnded = clips.find(
            event =>
              event.identity.playbackAttemptId === clip.identity.playbackAttemptId && event.state === "media_ended",
          );
          if (!started || !mediaEnded)
            throw new Error(`Missing trusted start/end for ${clip.identity.playbackAttemptId}`);
          const step = Math.max(1, Math.floor(buffer.sampleRate * 0.001));
          const windowSamples = Math.max(1, Math.floor(buffer.sampleRate * 0.02));
          const frameMs = (step / buffer.sampleRate) * 1000;
          const count = Math.min(
            Math.floor((assetPcm.length - windowSamples) / step),
            Math.floor((asset.duration * 1000 - 20) / frameMs),
          );
          const expected = Math.round((started.observedAt - captureStartedAt) / 1000 / (frameMs / 1000));
          const envelope = (pcm: Float32Array, frames: number, windowSamples: number, offsetFrames: number) => {
            const values = [];
            for (let i = 0; i < frames; i++) {
              let energy = 0;
              for (let j = 0; j < windowSamples; j++) {
                const sample = pcm[(offsetFrames + i) * step + j] ?? 0;
                energy += sample * sample;
              }
              values.push(Math.sqrt(energy / windowSamples));
            }
            return values;
          };
          const reference = envelope(assetPcm, count, windowSamples, 0);
          const peak = Math.max(...reference);
          const finalAudibleFrame = reference.findLastIndex(value => value >= peak * 0.1);
          if (finalAudibleFrame < 0) throw new Error(`Catalog asset has no audible PCM window: ${selected.id}`);
          const finalWindowLength = Math.min(finalAudibleFrame + 1, Math.ceil(200 / frameMs));
          const finalWindowStart = finalAudibleFrame - finalWindowLength + 1;
          const scoreWindow = (a: number[], b: number[], start: number, length: number) => {
            let dot = 0,
              xx = 0,
              yy = 0,
              sx = 0,
              sy = 0;
            for (let i = start; i < start + length; i++) {
              const x = a[i],
                y = b[i];
              dot += x * y;
              xx += x * x;
              yy += y * y;
              sx += x;
              sy += y;
            }
            const denom = Math.sqrt((xx - (sx * sx) / length) * (yy - (sy * sy) / length));
            return denom ? (dot - (sx * sy) / length) / denom : 0;
          };
          let best = { score: -1, offsetFrames: 0 };
          for (let shift = -500; shift <= 500; shift += 20) {
            const offset = expected + shift;
            if (offset < 0 || (offset + count - 1) * step + windowSamples >= recordingPcm.length) continue;
            const observed = envelope(recordingPcm, count, windowSamples, offset);
            const score = scoreWindow(reference, observed, 0, count);
            if (score > best.score) best = { score, offsetFrames: offset };
          }
          const coarseBest = best.offsetFrames;
          for (let offset = Math.max(0, coarseBest - 20); offset <= coarseBest + 20; offset++) {
            if ((offset + count - 1) * step + windowSamples >= recordingPcm.length) continue;
            const observed = envelope(recordingPcm, count, windowSamples, offset);
            const score = scoreWindow(reference, observed, 0, count);
            if (score > best.score) best = { score, offsetFrames: offset };
          }
          const offsetFrames = best.offsetFrames;
          const matched = envelope(recordingPcm, count, windowSamples, offsetFrames);
          const negativeControl = matched.slice();
          negativeControl.fill(0, finalWindowStart, finalWindowStart + finalWindowLength);
          return {
            assetId: selected.id,
            expectedHash: selected.sha256,
            actualHash: clip.assetSha256,
            fullClipRmsEnvelopeCorrelation: best.score,
            finalAudibleWindowCorrelation: scoreWindow(reference, matched, finalWindowStart, finalWindowLength),
            negativeControlFinalAudibleWindowCorrelation: scoreWindow(
              reference,
              negativeControl,
              finalWindowStart,
              finalWindowLength,
            ),
            finalAudibleWindowStartMs: finalWindowStart * frameMs,
            finalAudibleWindowDurationMs: finalWindowLength * frameMs,
            recordingOffsetMs: best.offsetFrames * frameMs,
            assetDurationMs: asset.duration * 1000,
            mediaDurationMs: clip.duration * 1000,
            startedAtPerformanceMs: started.observedAt,
            mediaEndedAtPerformanceMs: mediaEnded.observedAt,
            completedAtPerformanceMs: clip.observedAt,
            recorderStartedAtPerformanceMs: captureStartedAt,
            windowFrames: count,
            frameMs,
            attemptId: clip.identity.playbackAttemptId,
            evaluatedSceneIndex: clip.identity.evaluatedSceneIndex,
            sessionAtMs: clip.sessionAtMs,
          };
        }),
    );
    return {
      mimeType: recording.mimeType,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      captureStartedAt,
      acknowledgmentResources,
      recordingBase64: btoa(binary),
      clips,
      correlations,
      events: window.session.events,
    };
  });
  const relevant = capture.clips.filter(c => c.state === "completed");
  const out = path.resolve(process.cwd(), "test-results/issue-47/chromium-four-scene");
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "session-recording.webm"), Buffer.from(capture.recordingBase64, "base64"));
  await writeFile(
    path.join(out, "scene-playback-trace.json"),
    JSON.stringify(
      {
        note: "Synthetic WebRTC provider and silent child input; production BrowserTransport, finite catalog assets, LessonSession, display-token DOM confirmation, and MediaRecorder route. This is not live tutor voice evidence.",
        parentRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        duration: capture.duration,
        sampleRate: capture.sampleRate,
        captureStartedAt: capture.captureStartedAt,
        acknowledgmentResources: capture.acknowledgmentResources,
        clips: relevant,
        correlations: capture.correlations,
        stages: trace,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("per-clip-audio-correlation.json", {
    body: JSON.stringify(capture.correlations, null, 2),
    contentType: "application/json",
  });
  console.log(
    "Per-clip audio correlation:",
    JSON.stringify(
      capture.correlations.map(c => ({
        assetId: c.assetId,
        fullClip: c.fullClipRmsEnvelopeCorrelation,
        finalWindow: c.finalAudibleWindowCorrelation,
        negativeControl: c.negativeControlFinalAudibleWindowCorrelation,
      })),
    ),
  );
  expect(relevant).toHaveLength(3);
  expect(capture.correlations).toHaveLength(3);
  expect(
    capture.correlations.every(
      c =>
        c.actualHash === c.expectedHash &&
        c.fullClipRmsEnvelopeCorrelation > 0.95 &&
        c.finalAudibleWindowCorrelation > 0.9 &&
        c.negativeControlFinalAudibleWindowCorrelation < 0.2,
    ),
  ).toBe(true);
  expect(new Set(capture.acknowledgmentResources.map(resource => resource.url)).size).toBe(10);
  const families = new Set(capture.correlations.map(c => (c.assetId.includes("ack-v2") ? "alternate" : "baseline")));
  expect(families).toEqual(new Set(["baseline", "alternate"]));
  expect(
    capture.correlations.every(
      c => c.assetDurationMs > 0 && c.mediaDurationMs > 0 && c.windowFrames * c.frameMs >= c.mediaDurationMs - 25,
    ),
  ).toBe(true);
  await cleanup(page);
});

for (const phase of ["started", "media_ended"])
  test(`real finite ${phase} cancellation and retained callbacks never advance; correction owns old displayed group`, async ({
    page,
  }) => {
    await fixture(page);
    if (phase === "media_ended")
      await page.evaluate(`(() => {
  // Hold the observed output clock, while actual media and recording run.
  // A browser round trip cannot otherwise reliably hit the one-frame drain.
  const context=window.transport.context;
  window.restoreOutputClock=context.getOutputTimestamp.bind(context);
  context.getOutputTimestamp=()=>({contextTime:0,performanceTime:performance.now()});
 })()`);
    await answer(page);
    await playback(page, phase);
    await answer(page, " no two", 1100);
    await expect.poll(() => page.evaluate("window.evaluations.length")).toBe(2);
    expect(await page.evaluate("window.evaluations.at(-1).sceneIndex")).toBe(0);
    if (phase === "media_ended")
      await page.evaluate("window.transport.context.getOutputTimestamp=window.restoreOutputClock");
    expect(
      await page.evaluate(
        "window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='interrupted').length+window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='superseded').length",
      ),
    ).toBe(1);
    await cleanup(page);
  });

test("stale same-index display token cannot start B; retained transition correction waits for current confirmation and receives clarification plus one pending question", async ({
  page,
}) => {
  await fixture(page, false);
  await answer(page);
  await playback(page, "completed");
  await page.evaluate("window.session.displayed(1,'retired-attempt:same-index')");
  expect(await page.evaluate("window.providers.length")).toBe(1);
  await answer(page, "no two", 7000);
  await page.evaluate("window.session.displayed(1,window.session.snapshot.displayToken)");
  await ready(page);
  expect(await page.evaluate("window.evaluations.length")).toBe(1);
  expect(
    await page.evaluate("window.commands.filter(x=>x.command.content?.includes('Neutrally clarify')).length"),
  ).toBe(1);
  await cleanup(page);
});

test("stop during actual acknowledgment leaves one stopped terminal and no scene or question", async ({ page }) => {
  await fixture(page);
  await answer(page);
  await playback(page, "started");
  await page.evaluate("window.session.end('parent_stop')");
  expect(await page.evaluate("window.session.snapshot.sceneIndex")).toBe(0);
  expect(
    await page.evaluate(
      "window.session.events.filter(e=>e.type==='acknowledgment.playback'&&e.detail.state==='stopped').length",
    ),
  ).toBe(1);
  expect(await page.evaluate("window.providers.length")).toBe(1);
  await cleanup(page);
});
