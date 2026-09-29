/** Billed, bounded commit-4 probe: real GPT-Live + Jev through LessonSession.
 * Child transcript/VAD is synthetic; A's output is real. Continuous microphone
 * exists ONLY in this harness to keep outbound RTP running, never in the app.
 * The stale case deliberately requests long output before blocking A.
 */
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.LIVE_OUT ?? "test-results/integrated-replacement";
const categories = process.argv.slice(2);
if (categories.some(category => !["normal", "stale"].includes(category))) throw new Error("Select normal and/or stale");
const selectedCategories = categories.length ? categories : ["normal", "stale"];
const results = { date: new Date().toISOString(), baseURL, clock: "browser.performance.now", samples: [] };
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream"] });
console.log(
  `BILLED: ${selectedCategories.join(", ")} category probe; real Live/Jev, synthetic child transcript and experiment RTP input.`,
);
try {
  for (const category of selectedCategories) {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    const sample = {
      category,
      startedAt: new Date().toISOString(),
      limitations:
        "Synthetic child transcript/VAD; experiment-only low continuous microphone. Not an end-to-end spoken-child latency sample.",
    };
    results.samples.push(sample);
    try {
      await page.route("**/gate-measure/**", async route => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if (name === "index") {
          await route.fulfill({
            contentType: "text/html",
            body: `<button>Start</button><div data-scene></div><audio></audio><script type="module">
            import { BrowserTransport } from './browser-transport';
            import { LessonSession } from './session';
            import { fetchEvaluateAnswer } from './answer';
            import { sceneAt, OBJECTS } from './lesson';
            import { replacementMicrophone, outboundMicrophoneRtp } from './replacement-input.mjs';
            Object.assign(window, { BrowserTransport, LessonSession, fetchEvaluateAnswer, sceneAt, OBJECTS, replacementMicrophone, outboundMicrophoneRtp });
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
      await page.goto(`${baseURL}/gate-measure/index`);
      await page.waitForFunction("typeof window.LessonSession === 'function'");
      await page.evaluate(() => {
        window.raw = [];
        window.instructions = [];
        window.media = [];
        window.failures = [];
        const Peer = window.RTCPeerConnection;
        window.peers = [];
        window.RTCPeerConnection = class extends Peer {
          constructor(...args) {
            super(...args);
            window.peers.push(this);
          }
          createDataChannel(...args) {
            const channel = super.createDataChannel(...args);
            const source = window.peers.indexOf(this) + 1;
            channel.addEventListener("message", ({ data }) => {
              const event = JSON.parse(data);
              if (
                ["session.started", "session.output_transcript.delta", "session.closed", "error"].includes(event.type)
              )
                window.raw.push({
                  at: performance.now(),
                  source,
                  type: event.type,
                  delta: event.delta,
                  code: event.error?.code,
                });
            });
            return channel;
          }
        };
        window.audioContext = new AudioContext();
        window.microphone = window.replacementMicrophone(window.audioContext, "continuous");
        navigator.mediaDevices.getUserMedia = async () => window.microphone.stream.clone();
        window.transport = new window.BrowserTransport(document.querySelector("audio"));
        const send = window.transport.send.bind(window.transport);
        window.transport.send = command => {
          window.instructions.push({
            at: performance.now(),
            source: window.transport.activeSourceId,
            blocked: document.querySelector("audio").muted,
            ...command,
          });
          send(command);
        };
        const start = window.transport.start.bind(window.transport);
        window.transport.start = (receive, failure) =>
          start(
            event => {
              if (event.type === "output.activity")
                window.media.push({ at: performance.now(), source: window.transport.activeSourceId, ...event });
              receive(event);
            },
            message => {
              window.failures.push(message);
              failure(message);
            },
          );
        window.session = new window.LessonSession(window.transport, window.fetchEvaluateAnswer, snapshot => {
          window.sceneIndex = snapshot.sceneIndex;
          const scene = window.sceneAt(snapshot.sceneIndex);
          document.querySelector("[data-scene]").textContent = window.OBJECTS[scene.object].emoji.repeat(
            scene.quantity,
          );
          requestAnimationFrame(() => requestAnimationFrame(() => window.session.displayed(snapshot.sceneIndex)));
        });
        document.querySelector("button").onclick = async () => {
          await window.audioContext.resume();
          await window.session.start();
        };
      });
      await page.getByRole("button", { name: "Start" }).click();
      await page.waitForFunction("window.session.snapshot.status === 'active' || window.failures.length", null, {
        timeout: 35000,
      });
      if (category === "normal")
        await page.waitForFunction(
          "window.raw.some(event => event.type === 'session.output_transcript.delta') || window.failures.length",
          null,
          { timeout: 20000 },
        );
      // Normal: wait for greeting to finish. Stale: wait briefly, then prompt
      // long output even if the provider did not emit its initial greeting.
      if (category === "normal")
        await page.waitForFunction(
          "performance.now() - (window.raw.filter(event => event.type === 'session.output_transcript.delta').at(-1)?.at ?? Infinity) > 3000 || window.failures.length",
          null,
          { timeout: 25000 },
        );
      else await page.waitForTimeout(2000);
      if (category === "stale") {
        await page.evaluate(() => {
          window.longRequestedAt = performance.now();
          window.transport.send({
            type: "session.instructions.append",
            event_id: "experiment-long-output",
            delegation_id: null,
            content:
              "For this transport experiment, count out loud from one to one hundred, saying a short complete sentence about each number. Continue through all one hundred without asking a question, pausing for a reply, or saying goodbye.",
          });
        });
        await page.waitForFunction(
          "window.raw.some(event => event.type === 'session.output_transcript.delta' && event.at > window.longRequestedAt) || window.failures.length",
          null,
          { timeout: 20000 },
        );
      }
      await page.evaluate(() => {
        window.answerAt = performance.now();
        window.a = window.transport.current;
        window.session.receive({ type: "microphone.speech_started" });
        window.session.receive({ type: "transcript", speaker: "child", delta: "One", startMs: 10000, endMs: 10500 });
        window.session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
      });
      await page.waitForFunction(
        "window.session.events.some(event => event.type === 'answer.response_gate_released') || window.session.snapshot.status === 'ended'",
        null,
        { timeout: 17000 },
      );
      await page.evaluate(async () => {
        window.rtpBefore = await window.outboundMicrophoneRtp(window.transport.current.peer, "release");
      });
      await page.waitForFunction(
        "window.raw.some(event => event.type === 'session.output_transcript.delta' && event.at > window.instructions.at(-1).at && event.source === window.transport.activeSourceId) || window.failures.length",
        null,
        { timeout: 20000 },
      );
      await page.waitForTimeout(2500);
      Object.assign(
        sample,
        await page.evaluate(async () => {
          const events = window.session.events;
          const origin = window.session.createdAt - performance.timeOrigin;
          const first = type => events.find(event => event.type === type);
          const at = type => (first(type) ? first(type).at + origin : null);
          const outcome = window.instructions.find(
            event =>
              event.at > window.answerAt &&
              event.type === "session.instructions.append" &&
              event.event_id !== "experiment-long-output",
          );
          const source = window.transport.activeSourceId;
          const transcript = window.raw.find(
            event =>
              event.type === "session.output_transcript.delta" &&
              event.source === source &&
              event.at > (outcome?.at ?? Infinity),
          );
          const media = window.media.find(
            event => event.source === source && event.state === "active" && event.at > (outcome?.at ?? Infinity),
          );
          const safeAt = Math.max(at("answer.evaluated") ?? 0, at("advance.displayed") ?? 0);
          const elapsed = (end, start) => (end === null || start === null ? null : end - start);
          const rtpAfter = await window.outboundMicrophoneRtp(window.transport.current.peer, "observation_end");
          return {
            answerAt: window.answerAt,
            safeAt,
            triggerAt: at("replacement.triggered"),
            readyAt: at("replacement.ready"),
            promotedAt: at("replacement.promoted"),
            instructionAt: outcome?.at ?? null,
            firstTranscriptAt: transcript?.at ?? null,
            firstMediaAt: media?.at ?? null,
            timingMs: {
              answerToSafe: safeAt - window.answerAt,
              safeToTrigger: elapsed(at("replacement.triggered"), safeAt),
              triggerToReady: elapsed(at("replacement.ready"), at("replacement.triggered")),
              safeToInstruction: elapsed(outcome?.at ?? null, safeAt),
              instructionToFirstTranscript: elapsed(transcript?.at ?? null, outcome?.at ?? null),
              instructionToFirstMedia: elapsed(media?.at ?? null, outcome?.at ?? null),
              answerToFirstTranscript: elapsed(transcript?.at ?? null, window.answerAt),
            },
            trigger: first("replacement.triggered")?.detail ?? null,
            promoted: first("replacement.promoted")?.detail ?? null,
            release: first("answer.response_gate_released")?.detail ?? null,
            replacementCount: events.filter(event => event.type === "replacement.triggered").length,
            oldARetired: window.a.retired,
            oldAPeer: window.a.peer.connectionState,
            oldAChannel: window.a.channel.readyState,
            staleAEventsAfterPromotion: window.raw.filter(
              event =>
                event.source === 1 &&
                event.type === "session.output_transcript.delta" &&
                event.at > (at("replacement.promoted") ?? Infinity),
            ),
            aHiddenFragments: events.filter(event => event.type === "answer.response_gate_deadline_updated").length,
            outputSentBlocked: outcome?.blocked,
            outcomeSource: outcome?.source,
            currentSceneIndex: window.sceneIndex,
            responseTranscript: window.raw
              .filter(
                event =>
                  event.source === source &&
                  event.type === "session.output_transcript.delta" &&
                  event.at > (outcome?.at ?? Infinity),
              )
              .map(event => event.delta)
              .join(""),
            rtpBefore: window.rtpBefore,
            rtpAfter,
            rtpIncreasing: rtpAfter.packetsSent > window.rtpBefore.packetsSent,
            transportTiming: window.transport.replacementTiming ?? null,
            events,
            raw: window.raw,
            media: window.media,
            instructions: window.instructions,
            failures: window.failures,
          };
        }),
      );
      if (category === "normal" && sample.replacementCount !== 0)
        throw new Error("Normal sample unexpectedly replaced source");
      if (category === "stale" && sample.release?.reason !== "replacement_source")
        throw new Error("Stale case did not reproduce source handoff");
      if (sample.currentSceneIndex !== 1 || !sample.rtpIncreasing || !sample.responseTranscript)
        throw new Error("Response/state/RTP qualification failed");
      if (
        category === "stale" &&
        (!sample.oldARetired ||
          sample.staleAEventsAfterPromotion.length ||
          !sample.outputSentBlocked ||
          sample.outcomeSource !== 2)
      )
        throw new Error("Source isolation failed");
      sample.status = "passed";
    } catch (error) {
      sample.status = "failed";
      sample.failure = error.message;
      process.exitCode = 1;
      sample.evidence = await page
        .evaluate(() => ({
          events: window.session?.events,
          raw: window.raw,
          media: window.media,
          instructions: window.instructions,
          failures: window.failures,
        }))
        .catch(() => null);
    } finally {
      console.log(
        JSON.stringify({
          category,
          status: sample.status,
          failure: sample.failure,
          timingMs: sample.timingMs,
          trigger: sample.trigger,
          promoted: sample.promoted,
          responseTranscript: sample.responseTranscript,
        }),
      );
      await page
        .evaluate(() => {
          window.session?.dispose();
          window.transport?.close();
          window.microphone?.close();
          window.audioContext?.close();
        })
        .catch(() => {});
      await context.close();
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    }
  }
} finally {
  await browser.close();
}
