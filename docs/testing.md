# Testing Sprout

Use Node 24 (`.nvmrc`), then `npm ci`. The pull-request workflow runs these
commands in order:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

Unit tests check session and evidence logic. The browser suite covers the parent
lesson, microphone cleanup, persistence UI, and live-harness components with
synthetic media and intercepted service requests. Playwright starts its own
server with a fixed, intercepted Convex URL and empty provider keys. It refuses
to reuse an already running server, so a green browser run needs no account or
billed API. Failure traces and screenshots are retained under
`test-results/playwright/` and uploaded from CI for seven days.

The browser suite does not measure real speech comprehension, provider latency,
or teaching outcomes. For a live voice change, follow the
[reactive simulated-child E2E guide](../scripts/live/REACTIVE.md) locally with
configured providers and review its artifacts. `npm run test:live:reactive`,
`npm run test:live`, `npm run test:jev`, and `npm run benchmark:jev` are manual,
billed checks and do not run in CI. Do not commit credentials, child recordings,
or identifiable transcripts.
