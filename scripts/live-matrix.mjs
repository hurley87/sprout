/**
 * Runs scripted voice scenarios against the REAL GPT-Live-1 session (billed per
 * second) and writes readable timelines to test-results/live-matrix/.
 *
 * Speech is macOS `say` text-to-speech mixed by ffmpeg and fed to Chromium as a
 * fake microphone. It is adult synthetic speech on a fixed timeline that cannot
 * react to Sprout, so it probes model control behavior, not preschool speech.
 *
 * Usage: start `npm run dev`, then `npm run test:live [scenario ...] [--repeat N]`.
 * BASE_URL defaults to http://127.0.0.1:3000; LIVE_OUT overrides the output directory.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.LIVE_OUT ?? "test-results/live-matrix";

/** [secondsAfterStart, text]. `stop: "none"` lets the app or child end the lesson. */
const SCENARIOS = {
  turn_end_experiment: {
    seconds: 115,
    lines: [
      [11, "One!"],
      [20, "Yeah."],
      [28, "One"],
      [30, "two ducks."],
      [43, "Two... no, three."],
      [55, "I don't know."],
      [65, "Five."],
      [76, "One, two, three."],
      [88, "Wait, I am still counting."],
      [97, "One, two, three."],
    ],
  },
  turn_end_debug: {
    seconds: 82,
    lines: [
      [11, "One!"],
      [20, "Yeah."],
      [28, "One"],
      [30, "two ducks."],
      [43, "Two... no, three."],
      [55, "I don't know."],
      [65, "Five."],
      [74, "One, two, three."],
    ],
  },
  quick_answer: {
    seconds: 50,
    lines: [
      [11, "One!"],
      [24, "Two!"],
      [38, "Three!"],
    ],
  },
  progression: {
    seconds: 90,
    lines: [
      [11, "One!"],
      [22, "Yes! More ducks!"],
      [35, "One, two. Two ducks!"],
      [50, "Okay!"],
      [62, "One... two... three!"],
      [75, "Three butterflies!"],
    ],
  },
  self_correction: {
    seconds: 55,
    lines: [
      [11, "Um... two? No, wait. One! One duck."],
      [26, "Yeah!"],
      [38, "Three... no. Two!"],
    ],
  },
  long_pause: {
    seconds: 75,
    lines: [
      [11, "Ummm..."],
      [50, "One?"],
    ],
  },
  off_topic: {
    seconds: 65,
    lines: [
      [11, "I have a dinosaur! His name is Rex!"],
      [28, "Can you tell me a story about space rockets?"],
      [46, "One duck."],
    ],
  },
  interruption: {
    seconds: 45,
    lines: [
      [3.5, "Wait wait! I want to tell you something! I have a duck at home!"],
      [22, "One!"],
    ],
  },
  incorrect_then_supported: {
    seconds: 60,
    lines: [
      [11, "Five!"],
      [25, "Umm... I dont know."],
      [42, "One!"],
    ],
  },
  // Scenarios below were added for the issue #3 Jev experiment.
  correct_once: {
    seconds: 45,
    lines: [[11, "One!"]],
  },
  correct_phrasing_a: { seconds: 45, lines: [[11, "One duck."]] },
  correct_phrasing_b: { seconds: 45, lines: [[11, "There's one!"]] },
  correct_phrasing_c: { seconds: 45, lines: [[11, "Just one."]] },
  correct_phrasing_d: { seconds: 45, lines: [[11, "I count one!"]] },
  incorrect_count: {
    seconds: 50,
    lines: [[11, "Five!"]],
  },
  dont_know: {
    seconds: 50,
    lines: [[11, "Umm... I dont know."]],
  },
  /** The revision arrives inside the same utterance, so only "One" is judged. */
  self_corrected_to_right: {
    seconds: 50,
    lines: [[11, "Two? No, wait. One!"]],
  },
  /** The reverse: a correct answer the child immediately takes back. */
  self_corrected_to_wrong: {
    seconds: 50,
    lines: [[11, "One! No, three."]],
  },
  explicit_stop: {
    seconds: 45,
    stop: "none",
    lines: [
      [11, "One!"],
      [22, "I am all done. I want to stop now."],
    ],
  },
  time_limit: {
    seconds: 375,
    stop: "none",
    lines: [
      [11, "One!"],
      [25, "More!"],
      [40, "One, two!"],
      [60, "Yes!"],
      [75, "One, two, three."],
      [95, "Three butterflies!"],
      [120, "Okay!"],
      [140, "One, two, three strawberries."],
      [170, "More please!"],
      [200, "One, two, three, four."],
      [240, "Yes!"],
      [268, "One, two, three, four, five!"],
      [285, "Can we count more?"],
      [305, "I want to play more!"],
      [325, "One more please!"],
    ],
  },
};

function buildMicTrack(dir, { seconds, lines }) {
  const inputs = [];
  const delayed = lines.map(([at, text], i) => {
    const clip = `${dir}/line${i}.aiff`;
    execFileSync("say", ["-v", "Samantha", "-r", "150", "-o", clip, text]);
    inputs.push("-i", clip);
    return `[${i + 1}:a]aresample=48000,adelay=${Math.round(at * 1000)}:all=1[a${i}]`;
  });
  const wav = `${dir}/mic.wav`;
  const mix = `${delayed.join(";")};[0:a]${lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${lines.length + 1}:duration=first:normalize=0[out]`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-t",
    String(seconds + 5),
    "-i",
    "anullsrc=r=48000:cl=mono",
    ...inputs,
    "-filter_complex",
    mix,
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    wav,
  ]);
  return wav;
}

/** Records data-channel events, displayed scenes, and every answer evaluation. */
function recordLiveTraffic() {
  const log = [];
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  window.__liveLog = log;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (!url.includes("/api/evaluate")) return nativeFetch(input, init);
    const asked = at();
    const response = await nativeFetch(input, init);
    const answer = await response
      .clone()
      .json()
      .catch(() => null);
    log.push({ at: at(), dir: "evaluate", askedAt: asked, request: JSON.parse(init.body), answer });
    return response;
  };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      channel.addEventListener("message", ({ data }) => {
        try {
          log.push({ at: at(), dir: "in", ...JSON.parse(data) });
        } catch {
          /* not JSON */
        }
      });
      const send = channel.send.bind(channel);
      channel.send = raw => {
        log.push({ at: at(), dir: "out", ...JSON.parse(raw) });
        send(raw);
      };
      return channel;
    }
  };
  new MutationObserver(() => {
    const scene = document.querySelector("[data-scene]")?.getAttribute("data-scene") ?? null;
    if (log.findLast(e => e.dir === "scene")?.scene !== scene) log.push({ at: at(), dir: "scene", scene });
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

/** Merges transcript deltas into speaker turns (provider clock) between app events (page clock). */
function timeline(name, scenario, log) {
  const rows = [];
  let turn = null;
  const flush = () => {
    if (turn) rows.push(`${(turn.start / 1000).toFixed(1).padStart(6)}s ${turn.who}: ${turn.text.trim()}`);
    turn = null;
  };
  for (const e of log) {
    if (e.type === "session.input_transcript.delta" || e.type === "session.output_transcript.delta") {
      const who = e.type.includes("input") ? "CHILD " : "SPROUT";
      if (!turn || turn.who !== who || e.start_ms - turn.end > 1200) {
        flush();
        turn = { who, start: e.start_ms, end: e.end_ms, text: "" };
      }
      turn.text += e.delta;
      turn.end = e.end_ms;
      continue;
    }
    flush();
    const page = `  [page ${(e.at / 1000).toFixed(1)}s]`;
    if (e.dir === "scene") rows.push(`${page} SCENE -> ${e.scene}`);
    else if (e.dir === "evaluate")
      rows.push(
        `${page} JEV "${e.request.utterance}" @scene ${e.request.sceneIndex} -> ${e.answer?.probability ?? "no answer"} in ${e.at - e.askedAt}ms`,
      );
    else if (e.dir === "out")
      rows.push(`${page} APP -> ${e.type}${e.content ? `: ${String(e.content).slice(0, 90)}` : ""}`);
    else if (["session.delegation.created", "session.closed", "error"].includes(e.type))
      rows.push(`${page} LIVE -> ${e.type} ${JSON.stringify(e.delegation ?? e.reason ?? e.error ?? "")}`);
  }
  flush();
  return [`# ${name}`, `mic script: ${scenario.lines.map(([t, s]) => `${t}s "${s}"`).join(" | ")}`, ...rows].join("\n");
}

/**
 * Per-run numbers for the issue #3 comparison: what Jev was asked, how long it
 * took, and how closely the scene and Sprout's speech followed an advance.
 */
function metrics(log) {
  const evaluations = log
    .filter(e => e.dir === "evaluate")
    .map(e => ({
      utterance: e.request.utterance,
      sceneIndex: e.request.sceneIndex,
      probability: e.answer?.probability ?? null,
      latencyMs: e.at - e.askedAt,
      askedAt: e.askedAt,
    }));
  const scenes = log.filter(e => e.dir === "scene" && e.scene);
  const childSpoke = log.filter(e => e.type === "session.input_transcript.delta");
  const sproutSpoke = log.filter(e => e.type === "session.output_transcript.delta");
  const sproutBetween = (from, to) =>
    sproutSpoke
      .filter(e => e.at > from && e.at <= to)
      .map(e => e.delta)
      .join("")
      .trim();
  const words = text => (text ? text.split(/\s+/).length : 0);
  // The seam: what Sprout said after the child's last word and before the app
  // told it the outcome. More than a brief acknowledgment means Sprout had
  // already started its next move and the app's instruction lands mid-turn.
  const decisions = evaluations.map((e, i) => {
    const spoke = childSpoke.findLast(d => d.at <= e.askedAt);
    const until = evaluations[i + 1]?.askedAt ?? Infinity;
    const told = log.find(
      o =>
        o.dir === "out" &&
        o.at >= e.askedAt &&
        o.at < until &&
        /just changed|has not changed/.test(String(o.content ?? "")),
    );
    const decidedAt = told?.at ?? log.find(r => r.dir === "evaluate" && r.askedAt === e.askedAt)?.at;
    const before = spoke && decidedAt ? sproutBetween(spoke.at, decidedAt) : "";
    const firstWord = spoke && sproutSpoke.find(d => d.at > spoke.at);
    return {
      utterance: e.utterance,
      outcome: told ? (String(told.content).includes("just changed") ? "advanced" : told.type) : "none",
      sproutBeforeDecision: before,
      sproutWordsBeforeDecision: words(before),
      // Last word heard to the first word Sprout says after it: the silence the child hears.
      speechToFirstWordMs: firstWord ? firstWord.at - spoke.at : null,
      speechToInstructionMs: spoke && told ? told.at - spoke.at : null,
    };
  });
  const advances = scenes.slice(1).map(scene => {
    // The evaluation that caused this scene is the last one before it.
    const cause = evaluations.findLast(e => e.askedAt <= scene.at);
    const spoke = cause ? childSpoke.findLast(e => e.at <= cause.askedAt) : undefined;
    const told = log.find(e => e.dir === "out" && e.at >= scene.at && String(e.content ?? "").includes("just changed"));
    return {
      scene: scene.scene,
      probability: cause?.probability ?? null,
      // What the child actually waits: last word heard, through to new pixels.
      speechToSceneMs: spoke ? scene.at - spoke.at : null,
      // The evaluation alone, once the utterance was judged complete.
      decisionToSceneMs: cause ? scene.at - cause.askedAt : null,
      sceneToInstructionMs: told ? told.at - scene.at : null,
    };
  });
  return {
    evaluations,
    decisions,
    advances,
    scenesShown: scenes.map(scene => scene.scene),
    delegationsRefused: log.filter(e => e.type === "session.delegation.created").length,
  };
}

async function run(name, scenario, label = name) {
  const dir = `${OUT}/${label}`;
  mkdirSync(dir, { recursive: true });
  const wav = buildMicTrack(dir, scenario);
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
    await page.addInitScript(recordLiveTraffic);
    await page.goto(`${BASE_URL}/?debug=1`);
    await page.getByRole("button", { name: "Start counting together" }).click();
    const endButton = page.getByRole("button", { name: "End lesson" });
    const deadline = Date.now() + scenario.seconds * 1000;
    while (Date.now() < deadline && (await endButton.isVisible())) await page.waitForTimeout(500);
    if (scenario.stop !== "none" && (await endButton.isVisible())) await endButton.click();
    await page.waitForTimeout(2000);
    const log = await page.evaluate(() => window.__liveLog);
    const summary = metrics(log);
    const text = [timeline(label, scenario, log), `metrics: ${JSON.stringify(summary)}`].join("\n");
    writeFileSync(`${dir}/log.json`, JSON.stringify({ browser: browser.version(), scenario, summary, log }, null, 2));
    writeFileSync(`${dir}/timeline.txt`, text);
    await page.getByText("Parent testing notes").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download attempt diagnostics" }).click();
    copyFileSync(await (await downloadPromise).path(), `${dir}/diagnostics.json`);
    return text;
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
const repeatFlag = args.indexOf("--repeat");
const repeat = repeatFlag === -1 ? 1 : Number(args[repeatFlag + 1]);
const requested = repeatFlag === -1 ? args : args.slice(0, repeatFlag);
const unknown = requested.filter(name => !(name in SCENARIOS));
if (unknown.length || !Number.isInteger(repeat) || repeat < 1) {
  console.error(
    `Usage: npm run test:live [scenario ...] [--repeat N]. Available: ${Object.keys(SCENARIOS).join(", ")}`,
  );
  process.exit(1);
}
const names = requested.length ? requested : Object.keys(SCENARIOS);
const runs = names.flatMap(name =>
  Array.from({ length: repeat }, (_, i) => ({ name, label: repeat === 1 ? name : `${name}-${i + 1}` })),
);
const results = await Promise.allSettled(runs.map(({ name, label }) => run(name, SCENARIOS[name], label)));
results.forEach((result, i) =>
  console.log(result.status === "fulfilled" ? `${result.value}\n` : `# ${runs[i].label} FAILED: ${result.reason}\n`),
);
if (results.some(result => result.status === "rejected")) process.exitCode = 1;
