import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import browserConfig from "./playwright.config";
// Separate from routine browser tests and the GPT-Live live suite. No automatic env-file loading.
if (
  process.env.GROK_BENCHMARK_EXECUTE !== "1" ||
  !["grok-jev", "grok-only"].includes(process.env.GROK_BENCHMARK_MODE ?? "")
)
  throw new Error("Explicit GROK_BENCHMARK_EXECUTE=1 and GROK_BENCHMARK_MODE are required");
const required = ["XAI_API_KEY", "TYPESAFE_API_KEY"] as const;
if (required.some(key => !process.env[key]?.trim()))
  throw new Error("Grok walkthrough requires XAI_API_KEY and TYPESAFE_API_KEY");
const out = process.env.GROK_BENCHMARK_OUT;
if (!out?.endsWith(".json") || existsSync(out))
  throw new Error("GROK_BENCHMARK_OUT must identify a new JSON evidence file");
export default defineConfig({
  ...browserConfig,
  testDir: "./tests/experiments/grok-counting",
  testMatch: "live-walkthrough.ts",
  testIgnore: [],
  projects: [{ name: "grok-benchmark" }],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 150_000,
  globalTimeout: 180_000,
  outputDir: "./test-results/grok-live-benchmark",
  use: { ...browserConfig.use, baseURL: "http://127.0.0.1:3104", trace: "off" },
  webServer: {
    command: "npm run dev -- --port 3104",
    url: "http://127.0.0.1:3104",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { XAI_API_KEY: process.env.XAI_API_KEY!, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY!, OPENAI_API_KEY: "" },
  },
});
