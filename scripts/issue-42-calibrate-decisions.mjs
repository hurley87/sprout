/** Explicit provider-free fit; never loads env files or supplies a reviewer/label. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
const args = process.argv.slice(2);
const flags = new Map();
try {
  while (args.length) {
    const flag = args.shift();
    if (
      !["--observations", "--review", "--candidates", "--out"].includes(flag) ||
      flags.has(flag) ||
      !args[0] ||
      args[0].startsWith("--")
    )
      throw new Error("invalid args");
    flags.set(flag, args.shift());
  }
  const json = flag => {
    if (!flags.has(flag)) return undefined;
    const path = flags.get(flag);
    if (!path.endsWith(".json")) throw new Error("JSON required");
    return JSON.parse(readFileSync(path, "utf8"));
  };
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
    const calibration = await server.ssrLoadModule("/lib/experiments/issue-42/decisions-calibration.ts");
    const result = calibration.fitDecisionsPolicy(
      artifacts.loadBenchmark(),
      json("--observations"),
      json("--review"),
      json("--candidates"),
    );
    if (flags.has("--out")) {
      const path = resolve(flags.get("--out"));
      if (!path.startsWith(resolve("test-results/issue-42") + "/") || !path.endsWith(".json"))
        throw new Error("output must be new experiment JSON");
      mkdirSync(dirname(path), { recursive: true });
      if (result.status === "candidate_available") calibration.writeFrozenCandidate(path, result.candidate);
      else writeFileSync(path, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
      process.stdout.write("Calibration artifact written.\n");
    } else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await server.close();
  }
} catch {
  process.stderr.write(
    "Calibration stopped: incompatible observation/review/design/model/split/group or candidate settings. No provider call made.\n",
  );
  process.exitCode = 1;
}
