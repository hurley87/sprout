/** Sequential latency probe of the exact pinned Jev request and Sprout route.
 * Usage: npm run benchmark:jev. Loads local Next env without printing secrets,
 * starts a local dev server if BASE_URL is unset, and writes only safe results.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY is unavailable; configure the local app environment first.");

const endpoint = "https://api.typesafe.ai/v1/systemone";
const model = "jev-1.13.0";
const questionId = "countedDisplayed";
// Kept in sync with lib/answer.ts; the benchmark asserts the exact wire values.
const question = {
  type: "noul",
  instructions: "Did the learner correctly count the objects currently displayed?",
  criteria: {
    true: "The learner's final answer gives the same total as the displayed quantity, either by naming that total or by counting up to it and stopping there. A self-correction counts: judge only the answer they settled on.",
    false:
      "The final answer gives a different number, gives no total at all, is a guess the learner is asking about rather than stating, says they do not know, or is about something other than counting what is displayed.",
  },
};
const cases = [
  { sceneIndex: 0, scene: "1 duck", object: "duck", quantity: 1, utterance: "One" },
  { sceneIndex: 1, scene: "2 ducks", object: "ducks", quantity: 2, utterance: "One, two" },
  { sceneIndex: 2, scene: "3 butterflies", object: "butterflies", quantity: 3, utterance: "One, two, three" },
  { sceneIndex: 3, scene: "3 strawberries", object: "strawberries", quantity: 3, utterance: "Two" },
  {
    sceneIndex: 3,
    scene: "3 strawberries",
    object: "strawberries",
    quantity: 3,
    utterance: "One, two... no, one, two, three",
  },
];
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const origin = new URL(baseUrl).origin;
const timeoutMs = 4000; // Historical probe budget; the interactive deadline lives in lib/answer.ts.
const repetitions = 10;
let server;

function stateFor(c) {
  return { displayed: { object: c.object, quantity: c.quantity, description: c.scene }, learnerUtterance: c.utterance };
}
async function request(path, c, warmup = false) {
  const body =
    path === "direct"
      ? { model, state: stateFor(c), questions: { [questionId]: question } }
      : { sceneIndex: c.sceneIndex, utterance: c.utterance };
  const started = performance.now();
  let status = null,
    probability = null,
    reason = null,
    outcome = "failure";
  try {
    const response = await fetch(path === "direct" ? endpoint : `${baseUrl}/api/evaluate`, {
      method: "POST",
      headers:
        path === "direct"
          ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    // Read the body within the same timed interval. Never record raw provider data.
    const data = await response.json().catch(() => null);
    if (!response.ok) reason = `http_${status}`;
    else if (path === "direct") {
      const value = data?.answers?.[questionId]?.noul;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
        probability = value;
        outcome = "success";
      } else reason = "unreadable_noul";
    } else if (typeof data?.probability === "number" && Number.isFinite(data.probability)) {
      probability = data.probability;
      outcome = "success";
    } else reason = "unreadable_answer";
  } catch (error) {
    reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "request_failed";
    if (reason === "timeout") outcome = "timeout";
  }
  return {
    path,
    scenario: `${c.scene}: ${c.utterance}`,
    httpStatus: status,
    probability,
    latencyMs: Math.round(performance.now() - started),
    outcome,
    reason,
    warmup,
  };
}
function stats(rows) {
  const successes = rows.filter(r => r.outcome === "success");
  const values = successes.map(r => r.latencyMs).sort((a, b) => a - b);
  const percentile = p => (values.length ? values[Math.ceil((p / 100) * values.length) - 1] : null);
  return {
    successful: successes.length,
    total: rows.length,
    failures: rows.filter(r => r.outcome === "failure").length,
    timeouts: rows.filter(r => r.outcome === "timeout").length,
    min: values[0] ?? null,
    mean: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    max: values.at(-1) ?? null,
  };
}
function classify(direct, route) {
  if (direct.successful < 40 || route.successful < 40) return "inconclusive";
  const providerSlow = direct.p50 >= 1000;
  const integrationSlow = route.p50 - direct.p50 >= 500;
  if (providerSlow && integrationSlow) return "both";
  if (providerSlow) return "primarily TypeSafe/Jev latency";
  if (integrationSlow) return "primarily Sprout integration overhead";
  return "inconclusive";
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server?.exitCode !== null) throw new Error("The local Next server exited before it became ready.");
    try {
      if ((await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Local app did not become ready at ${baseUrl}`);
}

try {
  if (!process.env.BASE_URL) {
    server = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });
    await waitForServer();
  }
  const rows = [];
  for (const path of ["direct", "route"]) {
    for (const c of cases) rows.push(await request(path, c, true));
  }
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const c of cases) {
      rows.push(await request("direct", c));
      rows.push(await request("route", c));
    }
    console.log(`Measured ${repeat + 1}/${repetitions} passes`);
  }
  const measured = rows.filter(r => !r.warmup);
  const direct = stats(measured.filter(r => r.path === "direct"));
  const route = stats(measured.filter(r => r.path === "route"));
  const classification = classify(direct, route);
  const result = {
    capturedAt: new Date().toISOString(),
    endpoint,
    model,
    timeoutMs,
    warmupsPerPath: cases.length,
    measuredPerPath: cases.length * repetitions,
    method:
      "Sequential direct/route pairs, round robin across scenarios; successful-request latency statistics exclude failures and timeouts; settle wait excluded.",
    summary: {
      direct,
      route,
      medianOverheadMs: direct.p50 === null || route.p50 === null ? null : route.p50 - direct.p50,
      classification,
    },
    scenarios: Object.fromEntries(
      cases.map(c => {
        const scenario = `${c.scene}: ${c.utterance}`;
        return [
          scenario,
          {
            direct: stats(measured.filter(r => r.path === "direct" && r.scenario === scenario)),
            route: stats(measured.filter(r => r.path === "route" && r.scenario === scenario)),
          },
        ];
      }),
    ),
    rows,
  };
  mkdirSync("test-results/jev-latency", { recursive: true });
  writeFileSync("test-results/jev-latency/results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ summary: result.summary, scenarios: result.scenarios }, null, 2));
  console.log("Safe per-request results: test-results/jev-latency/results.json");
} finally {
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
}
