/** Explicit CLI only. No env files, automatic credentials, retry, production route or live session. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createServer } from "vite";
const args = process.argv.slice(2);
const flags = new Map();
try {
  while (args.length) {
    const flag = args.shift();
    if (flags.has(flag)) throw new Error("duplicate flag");
    if (["--execute"].includes(flag)) flags.set(flag, true);
    else if (
      [
        "--mode",
        "--cases",
        "--repetitions",
        "--max-requests",
        "--timeout-ms",
        "--review",
        "--policy",
        "--out",
      ].includes(flag) &&
      args[0] &&
      !args[0].startsWith("--")
    )
      flags.set(flag, args.shift());
    else throw new Error("unknown flag");
  }
  const mode = flags.get("--mode") ?? "plan";
  if (!["plan", "offline", "network"].includes(mode) || (flags.has("--execute") && mode !== "network"))
    throw new Error("invalid mode");
  const jsonFile = flag => {
    if (!flags.has(flag)) return null;
    const path = flags.get(flag);
    if (!path.endsWith(".json")) throw new Error("JSON input required");
    const bytes = readFileSync(path, "utf8");
    return { bytes, value: JSON.parse(bytes) };
  };
  const review = jsonFile("--review");
  const policy = jsonFile("--policy");
  // envDir:false is essential: Vite must not load .env.local or any other environment file.
  const server = await createServer({
    configFile: false,
    envDir: false,
    logLevel: "error",
    server: { middlewareMode: true, ws: false },
    appType: "custom",
    plugins: [
      {
        name: "experiment-server-only",
        enforce: "pre",
        resolveId(id) {
          if (id === "server-only") return "\0experiment-server-only";
        },
        load(id) {
          if (id === "\0experiment-server-only") return "export {};";
        },
      },
    ],
  });
  try {
    const artifacts = await server.ssrLoadModule("/lib/experiments/issue-42/benchmark-artifacts.ts");
    const harness = await server.ssrLoadModule("/lib/experiments/issue-42/provider-comparison.ts");
    const benchmark = artifacts.loadBenchmark();
    const options = {
      ...(flags.has("--cases") ? { caseIds: flags.get("--cases").split(",") } : {}),
      ...(flags.has("--repetitions") ? { repetitions: Number(flags.get("--repetitions")) } : {}),
      ...(flags.has("--max-requests") ? { maxRequests: Number(flags.get("--max-requests")) } : {}),
      ...(flags.has("--timeout-ms") ? { timeoutMs: Number(flags.get("--timeout-ms")) } : {}),
      ...(policy ? { mappingPolicy: policy.value } : {}),
    };
    const plan = artifacts.makePlan(benchmark, options);
    const gate = artifacts.reviewGate(benchmark, plan, review?.value);
    const reviewHash = review ? artifacts.sha256(review.bytes) : null;
    let output;
    if (mode === "plan") output = { kind: "dry_run_plan", plan, reviewHash, reviewGate: gate, requestsMade: 0 };
    else {
      let transport;
      if (mode === "network") {
        if (flags.get("--execute") !== true || !flags.has("--max-requests") || !gate.ready || plan.workingTreeDirty)
          throw new Error("execution gate blocked");
        // Credentials are only consulted AFTER review and opt-in. Never included in output.
        if (!process.env.TYPESAFE_API_KEY || !process.env.OPENAI_API_KEY)
          throw new Error("explicit environment credentials missing");
        const fetcher = globalThis.fetch;
        transport = async (arm, request, signal) => {
          const response = await fetcher(plan.providers[arm].endpoint, {
            method: "POST",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${arm === "jev" ? process.env.TYPESAFE_API_KEY : process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            signal,
          });
          return { ok: response.ok, body: response.ok ? await response.json().catch(() => null) : null };
        };
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        output = await harness.runComparison(benchmark, plan, {
          mode,
          execute: flags.get("--execute") === true,
          explicitBudget: flags.has("--max-requests") ? Number(flags.get("--max-requests")) : undefined,
          review: review?.value,
          reviewHash,
          reviewBytes: review?.bytes,
          transport,
          signal: controller.signal,
        });
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
    const serialized = JSON.stringify(output, null, 2) + "\n";
    if (flags.has("--out")) {
      const path = resolve(flags.get("--out"));
      if (!path.startsWith(resolve("test-results/issue-42") + "/") || !path.endsWith(".json"))
        throw new Error("output must be a new JSON file under test-results/issue-42/");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialized, { flag: "wx" });
      process.stdout.write("Comparison artifact written.\n");
    } else process.stdout.write(serialized);
  } finally {
    await server.close();
  }
} catch {
  process.stderr.write(
    "Comparison stopped: invalid arguments, incompatible artifacts, or unsatisfied execution/review gate. No provider body or credential logged. See docs/issue-42-provider-comparison.md.\n",
  );
  process.exitCode = 1;
}
