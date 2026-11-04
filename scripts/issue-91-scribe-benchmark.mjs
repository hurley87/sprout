import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== "--repeats" || !/^[1-9]\d*$/.test(args[1]) || Number(args[1]) > 100)
) {
  console.error("Usage: node scripts/issue-91-scribe-benchmark.mjs [--repeats 1-100]");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required; no requests were made.");
  process.exit(1);
}
const repeats = args.length ? Number(args[1]) : 3;
const fixtures = JSON.parse(readFileSync("tests/fixtures/math-scribe-utterances.json", "utf8"));
const server = await createServer({
  configFile: false,
  envDir: false,
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { createResponsesScribeProvider, interpretSpeech, parseScribeInput } = await server.ssrLoadModule(
    "/lib/math-scribe/interpretation.ts",
  );
  const { scoreInterpretation, summarizeScores } = await server.ssrLoadModule("/lib/math-scribe/benchmark-score.ts");
  const provider = createResponsesScribeProvider(process.env.OPENAI_API_KEY);
  const cases = [];
  for (const fixture of fixtures) {
    const { expected, name, ...input } = fixture;
    const runs = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const started = performance.now();
      const result = await interpretSpeech(parseScribeInput(input), provider);
      const latencyMs = Math.round(performance.now() - started);
      runs.push({ repeat: repeat + 1, latencyMs, result, score: scoreInterpretation(expected, result) });
    }
    cases.push({ name, expected, runs, summary: summarizeScores(runs) });
  }
  const overall = summarizeScores(cases.flatMap(item => item.runs));
  const report = { createdAt: new Date().toISOString(), repeats, cases, overall };
  mkdirSync("test-results/issue-91", { recursive: true });
  const path = `test-results/issue-91/scribe-${Date.now()}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.table([...cases.map(item => ({ case: item.name, ...item.summary })), { case: "OVERALL", ...overall }]);
  console.log(`Report: ${path}`);
} finally {
  await server.close();
}
