import { defineConfig } from "@playwright/test";
import browserConfig from "./playwright.config";

// Validate only the invoking environment; do not load credential files.
const required = ["OPENAI_API_KEY", "TYPESAFE_API_KEY"] as const;
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(
    `Live lesson tests require ${missing.join(", ")} in the invoking environment. ` +
      "See docs/browser-tests.md. These tests may make billed provider calls.",
  );
}

export default defineConfig({
  ...browserConfig,
  testDir: "./tests/browser/live",
  testMatch: "**/*.spec.ts",
  testIgnore: [],
  projects: [{ name: "lesson-live" }],
  outputDir: "./test-results/playwright-live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalTimeout: 600_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: Object.fromEntries(required.map(name => [name, process.env[name]!])),
  },
});
