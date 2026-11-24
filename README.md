# Sprout

A private, parent-supervised voice counting prototype. The root lesson at `/` uses
an authored graph and deterministic reducer to control the displayed scene, with
GPT-Live for conversation and Jev for semantic observation. Local microphone/VAD
and tutor output activity supply choreography evidence. Exact render confirmation
precedes bounded current-node steering.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in a microphone-capable browser.
Configure server-only `OPENAI_API_KEY` and `TYPESAFE_API_KEY` in your local environment.
Lessons use `gpt-live-1.1`; set `SPROUT_LIVE_MODEL=gpt-live-1` to roll back or compare
(unknown values fall back to the default).
Never expose these credentials through `NEXT_PUBLIC_*` variables. Provider routes
accept loopback requests from the local page.

### Hosting (for example on Vercel)

Away from loopback, Sprout is locked behind a family passcode. Set `SPROUT_PASSCODE`
(at least 6 characters) with the provider keys in the host's environment variables. Visitors
are sent to `/unlock`; the right passcode sets a signed, HttpOnly cookie for 30 days, and
API routes then accept only same-origin HTTPS requests that carry it (`lib/access.ts`,
`proxy.ts`). Without `SPROUT_PASSCODE`, remote access stays closed. Changing the passcode
signs everyone out. There is no per-client rate limit beyond a short delay after a wrong
passcode, so use a passcode that is hard to guess and set a spending limit on the provider keys.

The canonical counting lesson is served at `/`. `/api/live` accepts `{ sdp, lessonId }` and
uses the Sprout tutor configuration; `/api/classify` returns semantic proposals
and normalized diagnostics. Both endpoints enforce local request boundaries.

The interest-led [Halloween counting adventure](docs/halloween-counting.md) is at `/halloween`.
The [concert counting adventure](docs/concert-counting.md) is at `/concert`.

Attempts and speaker-labelled transcripts stay in page memory. **Export diagnostics**
downloads the current attempt as JSON; restarting or refreshing clears it. The app
has no audio recording, durable sessions, post-session analysis, or review workflow.
No backend database or deployment is required.

## Adult-learning demos

The existing demos at `/demos/catching-unicorns` and `/demos/mae386` remain
available. [MAE386 validation](docs/mae386-demo-validation.md) records its bounded
coverage and pending live work.

[Calculus practice](http://127.0.0.1:3000/demos/calculus) has the learner work
three authored problems aloud. Each step is checked as they speak, the tutor helps
with the specific step that is wrong or missing, and the next problem follows once
every step and the final answer are correct. Use
[`?debug=1`](http://127.0.0.1:3000/demos/calculus?debug=1) for session JSON export.
See the [calculus demo guide](docs/calculus-demo.md). Its voice and
`/api/calculus-work` step mapping use the server-only `OPENAI_API_KEY`; refresh
credentials locally, never paste secrets into chat. Live acceptance remains
**PENDING**.

## Check

```bash
npm test
npm run test:browser
npm run lint
npm run typecheck
npm run build
git diff --check
```

Unit tests use synthetic proposals, provider responses and clocks. Browser tests
cover the root lesson, adult demos, removed route boundaries and local WebRTC
output without billed providers. Real conversational accuracy remains behavioral-evaluation work in
[#57](https://github.com/hurley87/sprout/issues/57).

Future provider-backed scenarios have a separate, deliberately selected live
project. See [browser test selection, configuration and costs](docs/browser-tests.md).

See [the documentation index](docs/README.md) for architecture and evaluation guidance.
