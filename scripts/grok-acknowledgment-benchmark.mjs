/** Plan by default. Live calls require both --live and --execute; credentials are never loaded implicitly. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
const args = process.argv.slice(2);
const allowed = new Set(["--live", "--execute", "--max-requests", "--out"]);
const flags = new Map();
while (args.length) {
  const key = args.shift();
  if (!allowed.has(key) || flags.has(key)) throw new Error("Unknown or duplicate flag");
  if (key === "--live" || key === "--execute") flags.set(key, true);
  else {
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error("Missing value");
    flags.set(key, value);
  }
}
if (flags.has("--live") !== flags.has("--execute")) throw new Error("Live evaluation requires --live --execute");
if (flags.has("--execute") && !flags.has("--max-requests"))
  throw new Error("Live execution requires an explicit request cap");
if (flags.has("--execute") && !flags.has("--out")) throw new Error("Live execution requires a durable output path");
if (flags.has("--out") && (!flags.get("--out").endsWith(".json") || existsSync(resolve(flags.get("--out")))))
  throw new Error("Output must be a new JSON file");
const datasetPath = "lib/experiments/grok-counting/acknowledgment-cases.json";
const server = await createServer({
  configFile: false,
  envDir: false,
  logLevel: "error",
  resolve: { alias: { "@": process.cwd() } },
  server: { middlewareMode: true, ws: false },
  appType: "custom",
});
try {
  const harness = await server.ssrLoadModule("/lib/experiments/grok-counting/acknowledgment-benchmark.ts");
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const cases = harness.validateBenchmarkCases(dataset.cases);
  const sourceFiles = [
    datasetPath,
    "lib/experiments/grok-counting/acknowledgment-benchmark.ts",
    "lib/experiments/grok-counting/jev-acknowledgment.ts",
    "lib/experiments/grok-counting/acknowledgment.ts",
    "lib/experiments/grok-counting/expected-answer.ts",
    "lib/jev.ts",
  ];
  const startedAt = new Date().toISOString();
  const result = await harness.runAcknowledgmentBenchmark(cases, {
    execute: flags.has("--execute"),
    maxRequests: Number(flags.get("--max-requests") ?? 40),
    credentialsAvailable: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
  });
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceParent: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceSHA256: Object.fromEntries(
      sourceFiles.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]),
    ),
    datasetProvenance: dataset.provenance,
    ...result,
  };
  if (flags.has("--out")) {
    const out = resolve(flags.get("--out"));
    if (!out.endsWith(".json")) throw new Error("JSON output required");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }
  console.log(
    JSON.stringify(
      {
        status: result.status,
        providerAttempts: result.providerAttempts,
        thresholds: result.thresholds,
        october18Demo: result.october18Demo,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
