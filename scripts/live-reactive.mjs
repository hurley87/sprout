/** Explicitly billed live regression suite; runs sequentially, never part of npm test. */
import { REACTIVE_SCENARIOS } from "./live/reactive-scenarios.mjs";
import { selectScenarios, runSelected, runReactiveScenario } from "./live/reactive-runner.mjs";

try {
  const runs = selectScenarios(process.argv.slice(2), REACTIVE_SCENARIOS);
  console.log(
    `BILLED LIVE SERVICES: running ${runs.length} GPT-Live/Jev scenario(s) sequentially: ${runs.map(r => r.label).join(", ")}`,
  );
  const results = await runSelected(runs, async ({ name, label }) => {
    const dir = await runReactiveScenario(name, REACTIVE_SCENARIOS[name], {
      out: process.env.LIVE_OUT ?? "test-results/live-reactive",
      baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:3000",
      label,
    });
    console.log(`PASS ${label}: ${dir}`);
    return dir;
  });
  for (const result of results) if (result.status === "failed") console.error(`FAIL ${result.label}: ${result.error}`);
  if (results.some(r => r.status === "failed")) process.exitCode = 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
