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
Never expose these credentials through `NEXT_PUBLIC_*` variables. Provider routes
accept loopback requests from the local page.

`/experiments/transcript-state-steering` is a temporary alias for the same lesson.
Experiment-named modules, UI labels and classifier endpoint remain until the next
production naming/API cleanup commit.

Attempts and speaker-labelled transcripts stay in page memory. **Export diagnostics**
downloads the current attempt as JSON; restarting or refreshing clears it. The app
has no audio recording, durable sessions, post-session analysis, or review workflow.
No backend database or deployment is required.

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
cover both lesson routes and local WebRTC output without billed providers. Real
conversational accuracy remains behavioral-evaluation work in
[#57](https://github.com/hurley87/sprout/issues/57).

See [the documentation index](docs/README.md) for architecture and evaluation guidance.
