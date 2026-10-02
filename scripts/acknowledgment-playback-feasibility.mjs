// Issue #47 docs evidence only. No production modules, microphone, server or API.
// Run: node scripts/acknowledgment-playback-feasibility.mjs [output.json]
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const startedAtUtc = new Date().toISOString();
const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of [
    "complete",
    "final_scene",
    "interrupted",
    "superseded",
    "stopped",
    "source_retired",
    "suspended",
    "failed",
    "muted",
    "rate_changed",
    "seeked",
  ]) {
    const page = await browser.newPage();
    // All network requests are forbidden; the only resource is an in-memory WAV.
    await page.route("**/*", route => route.abort());
    await page.setContent("<button>Start synthetic playback</button><p id='scene'>one duck</p>");
    await page.evaluate(scenario => {
      document.querySelector("button").onclick = async () => {
        try {
          const context = new AudioContext();
          await context.resume();
          const mix = context.createMediaStreamDestination();
          const recorder = new MediaRecorder(mix.stream, { mimeType: "audio/webm;codecs=opus" });
          const chunks = [];
          recorder.ondataavailable = event => chunks.push(event.data);
          const events = [];
          const at = () => Math.round(performance.now() * 1000) / 1000;
          const log = (type, detail = {}) => events.push({ type, atMs: at(), ...detail });
          const state = { active: true, source: 1, epoch: 1, phase: "playing", commits: 0, questions: 0 };
          const token = { source: 1, epoch: 1, answer: "scene-0:revision-1:1000:One", playback: "ack-1" };
          const audio = new Audio();
          audio.loop = false;
          const local = context.createMediaElementSource(audio);
          const localGain = context.createGain();
          local.connect(localGain);
          localGain.connect(context.destination);
          localGain.connect(mix);
          // Continuous old-provider media remains blocked in BOTH destinations.
          const stale = context.createOscillator();
          stale.frequency.value = 880;
          const blocked = context.createGain();
          blocked.gain.value = 0;
          stale.connect(blocked);
          blocked.connect(context.destination);
          blocked.connect(mix);
          stale.start();
          const rate = 24000;
          const duration = 0.9;
          const samples = Math.round(rate * duration);
          const bytes = new ArrayBuffer(44 + samples * 2);
          const wav = new DataView(bytes);
          const ascii = (offset, value) =>
            [...value].forEach((char, index) => wav.setUint8(offset + index, char.charCodeAt(0)));
          ascii(0, "RIFF");
          wav.setUint32(4, bytes.byteLength - 8, true);
          ascii(8, "WAVEfmt ");
          wav.setUint32(16, 16, true);
          wav.setUint16(20, 1, true);
          wav.setUint16(22, 1, true);
          wav.setUint32(24, rate, true);
          wav.setUint32(28, rate * 2, true);
          wav.setUint16(32, 2, true);
          wav.setUint16(34, 16, true);
          ascii(36, "data");
          wav.setUint32(40, samples * 2, true);
          for (let i = 0; i < samples; i++) {
            const time = i / rate;
            // Internal silence disproves using a quiet interval as completion.
            const value = time >= 0.3 && time < 0.55 ? 0 : 0.2 * Math.sin(2 * Math.PI * 440 * time);
            wav.setInt16(44 + i * 2, Math.round(value * 32767), true);
          }
          const url = URL.createObjectURL(
            new Blob([scenario === "failed" ? "invalid WAV" : bytes], { type: "audio/wav" }),
          );
          audio.src = url;
          let finish;
          const terminal = new Promise(resolve => {
            finish = resolve;
          });
          let terminalReason;
          const cancel = reason => {
            if (terminalReason) return;
            // Invalidate authority before pausing or clearing resources.
            state.epoch++;
            state.phase = reason;
            terminalReason = reason;
            localGain.gain.value = 0;
            audio.pause();
            log(reason, { mediaTime: audio.currentTime });
            finish();
          };
          const complete = async (event, callbackOrigin = event.isTrusted ? "browser" : "dispatched_simulation") => {
            const authorized =
              event.isTrusted &&
              state.active &&
              state.source === token.source &&
              state.epoch === token.epoch &&
              state.phase === "playing" &&
              audio.ended &&
              context.state === "running" &&
              !audio.muted &&
              audio.volume === 1 &&
              localGain.gain.value === 1 &&
              audio.playbackRate === 1 &&
              !audio.seeking &&
              !audio.error &&
              audio.currentTime === audio.duration;
            log("ended_callback", {
              callbackOrigin,
              trusted: event.isTrusted,
              authorized,
              mediaTime: audio.currentTime,
              duration: audio.duration,
            });
            if (!authorized) return;
            state.phase = "draining";
            // Conservative browser output-clock fence, not a guessed drain sleep.
            // getOutputTimestamp estimates device rendering; this is NOT physical hearing proof.
            const renderFence = context.currentTime;
            log("media_ended", { renderFence, outputTimestamp: context.getOutputTimestamp() });
            let outputTimestamp;
            do {
              await new Promise(resolve => requestAnimationFrame(resolve));
              if (
                terminalReason ||
                state.epoch !== token.epoch ||
                !state.active ||
                state.source !== token.source ||
                context.state !== "running"
              )
                return;
              outputTimestamp = context.getOutputTimestamp();
            } while (!outputTimestamp.contextTime || outputTimestamp.contextTime < renderFence);
            log("output_clock_fence_passed", { renderFence, outputTimestamp });
            terminalReason = "completed";
            state.phase = "completed";
            log("playback_completed", { scene: document.querySelector("#scene").textContent });
            if (scenario !== "final_scene") {
              state.commits++;
              log("scene_committed");
              document.querySelector("#scene").textContent = "two ducks";
              // A separate display acknowledgment, not the scene assignment itself.
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  log("scene_display_confirmed");
                  state.questions++;
                  log("question_authorized");
                  finish();
                }),
              );
            } else finish();
          };
          audio.addEventListener("ended", complete);
          audio.addEventListener("error", () => cancel("failed"));
          audio.addEventListener("volumechange", () => {
            if (audio.muted || audio.volume !== 1) cancel("muted");
          });
          audio.addEventListener("ratechange", () => {
            if (audio.playbackRate !== 1) cancel("rate_changed");
          });
          audio.addEventListener("seeking", () => cancel("seeked"));
          context.onstatechange = () => {
            if (context.state !== "running") cancel("suspended");
          };
          recorder.start();
          log("asset_ready", { duration, token });
          // These tempting substitutes do not call complete or commit.
          log("transcript_arrived");
          log("context_appended");
          try {
            await audio.play();
            log("play_started", { mediaTime: audio.currentTime });
          } catch {
            cancel("failed");
          }
          let trigger;
          if (!["complete", "final_scene", "failed"].includes(scenario)) {
            // Test stimulus at media position, avoiding short-recorder startup races.
            // It can CANCEL only; it is never a completion predicate.
            const stimulate = async () => {
              if (terminalReason) return;
              if (audio.currentTime < 0.2) {
                trigger = requestAnimationFrame(stimulate);
                return;
              }
              if (scenario === "source_retired") state.source = 2;
              if (scenario === "stopped") state.active = false;
              if (scenario === "suspended") await context.suspend();
              else if (scenario === "muted") audio.muted = true;
              else if (scenario === "rate_changed") audio.playbackRate = 2;
              else if (scenario === "seeked") audio.currentTime = 0.8;
              else cancel(scenario);
            };
            trigger = requestAnimationFrame(stimulate);
          }
          const timeout = setTimeout(() => cancel("timeout"), 5000);
          await terminal;
          clearTimeout(timeout);
          cancelAnimationFrame(trigger);
          // Simulate retained/duplicate callbacks directly; the browser didn't emit these.
          complete({ isTrusted: true }, "retained_simulation");
          audio.dispatchEvent(new Event("ended"));
          localGain.gain.value = 0;
          audio.pause();
          local.disconnect();
          stale.stop();
          blocked.disconnect();
          context.onstatechange = null;
          if (context.state !== "running") await context.resume();
          const recorded = new Promise(resolve => {
            recorder.onstop = resolve;
          });
          recorder.stop();
          await recorded;
          const blob = new Blob(chunks, { type: recorder.mimeType });
          // Immediate media failure can end before MediaRecorder has one packet.
          let decoded = null;
          if (scenario !== "failed") {
            try {
              decoded = await context.decodeAudioData(await blob.arrayBuffer());
            } catch (error) {
              throw new Error(JSON.stringify({ error: String(error), bytes: blob.size, events }));
            }
          }
          const pcm = decoded?.getChannelData(0);
          const amplitude = frequency => {
            if (!decoded || !pcm) return null;
            let real = 0,
              imaginary = 0;
            // First 150 ms after a short codec/startup margin is before the gap/cancel.
            const first = Math.round(decoded.sampleRate * 0.025);
            const last = Math.min(pcm.length, Math.round(decoded.sampleRate * 0.175));
            for (let i = first; i < last; i++) {
              const angle = (2 * Math.PI * frequency * i) / decoded.sampleRate;
              real += pcm[i] * Math.cos(angle);
              imaginary += pcm[i] * Math.sin(angle);
            }
            return (2 * Math.hypot(real, imaginary)) / (last - first);
          };
          const rms = (fromSeconds, toSeconds) => {
            if (!decoded || !pcm || decoded.duration < toSeconds) return null;
            const segment = pcm.slice(
              Math.round(fromSeconds * decoded.sampleRate),
              Math.round(toSeconds * decoded.sampleRate),
            );
            return Math.sqrt(segment.reduce((sum, sample) => sum + sample * sample, 0) / segment.length);
          };
          const recording = {
            bytes: blob.size,
            durationMs: decoded ? decoded.duration * 1000 : null,
            local440Amplitude: amplitude(440),
            stale880Amplitude: amplitude(880),
            internalSilenceRms: rms(0.4, 0.5),
            finalToneRms: rms(0.7, 0.8),
          };
          URL.revokeObjectURL(url);
          audio.removeAttribute("src");
          audio.load();
          await context.close();
          window.result = { scenario, terminalReason, state, events, recording };
        } catch (error) {
          window.error = `${scenario}: ${String(error)}`;
        }
      };
    }, scenario);
    await page.getByRole("button").click();
    await page.waitForFunction(() => window.result || window.error, undefined, { timeout: 10000 });
    const result = await page.evaluate(() => {
      if (window.error) throw new Error(window.error);
      return window.result;
    });
    const success = ["complete", "final_scene"].includes(scenario);
    assert.equal(result.terminalReason, success ? "completed" : scenario);
    assert.equal(result.state.commits, scenario === "complete" ? 1 : 0);
    assert.equal(result.state.questions, scenario === "complete" ? 1 : 0);
    assert.equal(result.events.filter(event => event.type === "playback_completed").length, success ? 1 : 0);
    if (success) {
      const naturalEnd = result.events.find(event => event.type === "ended_callback" && event.authorized);
      assert.equal(naturalEnd.mediaTime, 0.9);
      const drain = result.events.find(event => event.type === "output_clock_fence_passed");
      assert.ok(drain.outputTimestamp.contextTime >= drain.renderFence);
      assert.equal(result.events.find(event => event.type === "playback_completed").scene, "one duck");
      assert.ok(result.recording.durationMs >= 900);
      assert.ok(result.recording.internalSilenceRms < 0.005);
      assert.ok(result.recording.finalToneRms > 0.05);
    }
    if (scenario !== "failed") assert.ok(result.recording.local440Amplitude > 0.05);
    if (scenario !== "failed") assert.ok(result.recording.stale880Amplitude < 0.005);
    if (scenario === "complete") {
      const types = result.events.map(event => event.type);
      assert.ok(types.indexOf("playback_completed") < types.indexOf("scene_committed"));
      assert.ok(types.indexOf("scene_committed") < types.indexOf("scene_display_confirmed"));
      assert.ok(types.indexOf("scene_display_confirmed") < types.indexOf("question_authorized"));
    }
    results.push(result);
    await page.close();
  }
  const report = {
    experiment: "issue-47-finite-media-v1",
    startedAtUtc,
    fixtureSha256: createHash("sha256")
      .update(await readFile(new URL(import.meta.url)))
      .digest("hex"),
    browser: browser.version(),
    fixtureOnly: true,
    clock: "browser.performance.now per page",
    results,
  };
  const output = process.argv[2] ?? "test-results/issue-47-playback/synthetic.json";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, browser: report.browser, scenarios: results.length, passed: true }));
} finally {
  await browser.close();
}
