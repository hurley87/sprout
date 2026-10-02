import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  // Playwright empties this directory on every run, so it must not be the one
  // the experiment scripts write their evidence to.
  outputDir: "./test-results/playwright",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1000 },
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_CONVEX_URL: "https://test.convex.cloud",
      OPENAI_API_KEY: "",
      TYPESAFE_API_KEY: "",
    },
  },
});
