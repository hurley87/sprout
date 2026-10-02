import { defineConfig } from "@playwright/test";

/** Transport fixtures serve actual production modules through page.route.
 * They need a secure localhost origin, no Next server, credentials or provider. */
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["transport-output.spec.ts", "local-playback.spec.ts", "acknowledgment-choreography.spec.ts"],
  outputDir: "./test-results/playwright-transport",
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:3100",
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
});
