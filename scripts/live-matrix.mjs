/**
 * Runs scripted voice scenarios against the REAL GPT-Live-1 session (billed per
 * second) and writes readable timelines to test-results/live-matrix/.
 *
 * Speech is macOS `say` text-to-speech mixed by ffmpeg and fed to Chromium as a
 * fake microphone. It is adult synthetic speech on a fixed timeline that cannot
 * react to Sprout, so it probes model control behavior, not preschool speech.
 *
 * Usage: start `npm run dev`, then `npm run test:live [scenario ...]`.
 * BASE_URL defaults to http://127.0.0.1:3000.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = "test-results/live-matrix";

/** [secondsAfterStart, text]. `stop: "none"` lets the app or child end the lesson. */
const SCENARIOS = {
  quick_answer: { seconds: 50, lines: [[11, "One!"], [24, "Two!"], [38, "Three!"]] },
  progression: { seconds: 90, lines: [[11, "One!"], [22, "Yes! More ducks!"], [35, "One, two. Two ducks!"], [50, "Okay!"], [62, "One... two... three!"], [75, "Three butterflies!"]] },
  self_correction: { seconds: 55, lines: [[11, "Um... two? No, wait. One! One duck."], [26, "Yeah!"], [38, "Three... no. Two!"]] },
  long_pause: { seconds: 75, lines: [[11, "Ummm..."], [50, "One?"]] },
  off_topic: { seconds: 65, lines: [[11, "I have a dinosaur! His name is Rex!"], [28, "Can you tell me a story about space rockets?"], [46, "One duck."]] },
  interruption: { seconds: 45, lines: [[3.5, "Wait wait! I want to tell you something! I have a duck at home!"], [22, "One!"]] },
  incorrect_then_supported: { seconds: 60, lines: [[11, "Five!"], [25, "Umm... I dont know."], [42, "One!"]] },
  explicit_stop: { seconds: 45, stop: "none", lines: [[11, "One!"], [22, "I am all done. I want to stop now."]] },
  time_limit: { seconds: 375, stop: "none", lines: [[11, "One!"], [25, "More!"], [40, "One, two!"], [60, "Yes!"], [75, "One, two, three."], [95, "Three butterflies!"], [120, "Okay!"], [140, "One, two, three strawberries."], [170, "More please!"], [200, "One, two, three, four."], [240, "Yes!"], [268, "One, two, three, four, five!"], [285, "Can we count more?"], [305, "I want to play more!"], [325, "One more please!"]] },
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
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-t", String(seconds + 5), "-i", "anullsrc=r=48000:cl=mono", ...inputs,
    "-filter_complex", mix, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  return wav;
}

/** Records every data-channel event in both directions plus each displayed scene. */
function recordLiveTraffic() {
  const log = [];
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  window.__liveLog = log;
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      channel.addEventListener("message", ({ data }) => { try { log.push({ at: at(), dir: "in", ...JSON.parse(data) }); } catch { /* not JSON */ } });
      const send = channel.send.bind(channel);
      channel.send = raw => { log.push({ at: at(), dir: "out", ...JSON.parse(raw) }); send(raw); };
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
  const flush = () => { if (turn) rows.push(`${(turn.start / 1000).toFixed(1).padStart(6)}s ${turn.who}: ${turn.text.trim()}`); turn = null; };
  for (const e of log) {
    if (e.type === "session.input_transcript.delta" || e.type === "session.output_transcript.delta") {
      const who = e.type.includes("input") ? "CHILD " : "SPROUT";
      if (!turn || turn.who !== who || e.start_ms - turn.end > 1200) { flush(); turn = { who, start: e.start_ms, end: e.end_ms, text: "" }; }
      turn.text += e.delta;
      turn.end = e.end_ms;
      continue;
    }
    flush();
    const page = `  [page ${(e.at / 1000).toFixed(1)}s]`;
    if (e.dir === "scene") rows.push(`${page} SCENE -> ${e.scene}`);
    else if (e.dir === "out") rows.push(`${page} APP -> ${e.type}${e.content ? `: ${String(e.content).slice(0, 90)}` : ""}`);
    else if (["session.delegation.created", "session.closed", "error"].includes(e.type)) rows.push(`${page} LIVE -> ${e.type} ${JSON.stringify(e.delegation ?? e.reason ?? e.error ?? "")}`);
  }
  flush();
  return [`# ${name}`, `mic script: ${scenario.lines.map(([t, s]) => `${t}s "${s}"`).join(" | ")}`, ...rows].join("\n");
}

async function run(name, scenario) {
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const wav = buildMicTrack(dir, scenario);
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
    await page.addInitScript(recordLiveTraffic);
    await page.goto(BASE_URL);
    await page.getByRole("button", { name: "Start counting together" }).click();
    const endButton = page.getByRole("button", { name: "End lesson" });
    const deadline = Date.now() + scenario.seconds * 1000;
    while (Date.now() < deadline && await endButton.isVisible()) await page.waitForTimeout(500);
    if (scenario.stop !== "none" && await endButton.isVisible()) await endButton.click();
    await page.waitForTimeout(2000);
    const log = await page.evaluate(() => window.__liveLog);
    const text = timeline(name, scenario, log);
    writeFileSync(`${dir}/log.json`, JSON.stringify({ browser: browser.version(), scenario, log }, null, 2));
    writeFileSync(`${dir}/timeline.txt`, text);
    return text;
  } finally {
    await browser.close();
  }
}

const requested = process.argv.slice(2);
const unknown = requested.filter(name => !(name in SCENARIOS));
if (unknown.length) {
  console.error(`Unknown scenario(s): ${unknown.join(", ")}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}
const names = requested.length ? requested : Object.keys(SCENARIOS);
const results = await Promise.allSettled(names.map(name => run(name, SCENARIOS[name])));
results.forEach((result, i) => console.log(result.status === "fulfilled" ? `${result.value}\n` : `# ${names[i]} FAILED: ${result.reason}\n`));
if (results.some(result => result.status === "rejected")) process.exitCode = 1;
