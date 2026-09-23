/**
 * Asks the REAL Jev model (billed per input token) the one Noul question from
 * lib/answer.ts about a labeled set of learner utterances, several times each,
 * and reports the probability spread per case.
 *
 * This is a text-only pass: no GPT-Live, no browser, no lesson. It goes through
 * the app's own /api/evaluate route, so it calibrates exactly the question,
 * criteria, state shape and pinned model the lesson uses. Its purpose is to
 * choose the advance threshold before any live comparison run, so the threshold
 * is not tuned on the results it is meant to judge.
 *
 * Usage: start `npm run dev`, then `npm run test:jev`. REPEATS defaults to 5.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const REPEATS = Number(process.env.REPEATS ?? 5);
const OUT = "test-results/jev-calibration";

/** [sceneIndex, utterance, shouldAdvance]. Scene 0 is 1 duck, 1 is 2 ducks, 2 is 3 butterflies. */
const CASES = [
  // Correct: the answer the application should act on.
  [0, "One!", true],
  [0, "One duck.", true],
  [0, "There's one!", true],
  [0, "Just one.", true],
  [0, "I count one!", true],
  [0, "Um... one.", true],
  [1, "Two!", true],
  [1, "One, two. Two ducks!", true],
  [2, "One... two... three!", true],
  [2, "Three butterflies!", true],
  [0, "Two? No, wait. One!", true],
  [2, "Two... no, three!", true],
  // Incorrect: a different total.
  [0, "Five!", false],
  [0, "Two.", false],
  [1, "Three ducks!", false],
  [2, "One, two!", false],
  [2, "Four butterflies.", false],
  [0, "One, two, three!", false],
  [0, "One! No, three.", false],
  // No usable total: uncertainty, questions, thinking noises, off topic.
  [0, "Umm... I dont know.", false],
  [0, "I don't know.", false],
  [0, "One?", false],
  [0, "Ummm...", false],
  [0, "um, I think", false],
  [0, "A duck!", false],
  [0, "I have a dinosaur! His name is Rex!", false],
  [0, "Can you tell me a story about space rockets?", false],
  [2, "They're pretty.", false],
  // Sprout's own speech, in case it is echoed into the input transcript.
  [0, "I see 1 duck on the screen. How many can you count?", false],
];

const origin = new URL(BASE_URL).origin;

async function ask(sceneIndex, utterance) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ sceneIndex, utterance }),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  if (!response.ok)
    throw new Error(`/api/evaluate returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const { probability, model } = await response.json();
  return { probability, model, latencyMs };
}

const results = [];
let model = "unknown";
for (const [sceneIndex, utterance, expected] of CASES) {
  const runs = await Promise.all(Array.from({ length: REPEATS }, () => ask(sceneIndex, utterance)));
  model = runs[0].model;
  const probabilities = runs.map(run => run.probability);
  results.push({
    sceneIndex,
    utterance,
    expected,
    probabilities,
    min: Math.min(...probabilities),
    max: Math.max(...probabilities),
    latencies: runs.map(run => run.latencyMs),
  });
}

/** The gap between the lowest "should advance" and the highest "should not". */
const floor = Math.min(...results.filter(result => result.expected).map(result => result.min));
const ceiling = Math.max(...results.filter(result => !result.expected).map(result => result.max));
const latencies = results.flatMap(result => result.latencies).sort((a, b) => a - b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.floor((latencies.length * p) / 100))];

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/results.json`, JSON.stringify({ model, repeats: REPEATS, results }, null, 2));

console.log(`# Jev calibration (${model}, ${REPEATS} runs per case)\n`);
console.log("| Scene | Utterance | Advance? | min | max |");
console.log("| --- | --- | --- | --- | --- |");
for (const result of results)
  console.log(
    `| ${result.sceneIndex} | ${result.utterance} | ${result.expected ? "yes" : "no"} | ${result.min.toFixed(2)} | ${result.max.toFixed(2)} |`,
  );
console.log(`\nlowest probability on an answer that should advance: ${floor.toFixed(2)}`);
console.log(`highest probability on an answer that must not advance: ${ceiling.toFixed(2)}`);
console.log(
  `separated: ${ceiling < floor ? `yes, any threshold in (${ceiling.toFixed(2)}, ${floor.toFixed(2)}]` : "NO, these overlap"}`,
);
console.log(
  `latency (includes one localhost hop) p50 ${percentile(50)}ms, p95 ${percentile(95)}ms, max ${latencies.at(-1)}ms`,
);
