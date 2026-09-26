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
import { SCENARIOS } from "./live/scenarios.mjs";
import { runFixedTimeline } from "./live/fixed-timeline.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.LIVE_OUT ?? "test-results/live-matrix";

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
const results = await Promise.allSettled(
  runs.map(({ name, label }) => runFixedTimeline(name, SCENARIOS[name], { out: OUT, baseUrl: BASE_URL, label })),
);
results.forEach((result, i) =>
  console.log(result.status === "fulfilled" ? `${result.value}\n` : `# ${runs[i].label} FAILED: ${result.reason}\n`),
);
if (results.some(result => result.status === "rejected")) process.exitCode = 1;
