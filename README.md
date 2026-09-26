# Sprout

A private, parent-supervised prototype for short counting lessons that adapt to reviewed evidence from earlier sessions. Start with the [MVP documentation](docs/README.md) for product scope, architecture, and the seven-day experiment.

The application is currently a [Next.js](https://nextjs.org) starter bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Convex persistence foundation

The session-record schema and functions live in `convex/`. For local MVP development, run
`npm run convex:dev` in a second terminal and select a local deployment when prompted.
The Convex CLI writes the deployment URL to an ignored local environment file and regenerates
`convex/_generated/`. The CLI-generated bindings are committed so tests and typecheck work
without a running deployment. The live lesson records lifecycle, displayed scenes, and child utterances
through Convex. Configure `NEXT_PUBLIC_CONVEX_URL` for the browser recorder; recording failures are
shown while the lesson continues. Sprout playback attribution and support capture are deferred.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Live audio harness

With macOS `say`, `ffmpeg`, and the local app configured for GPT-Live and Jev, start
`npm run dev`. These commands use real, billed services:

- `npm run test:live quick_answer` keeps the existing fixed-WAV timeline adapter.
- `npm run test:live:reactive` runs one minimal reactive smoke. It waits for the
  Commit 2 observer's Sprout turn-end signal, then synthesizes `One!` at runtime,
  emits it through a persistent browser microphone/WebRTC track, and waits for a
  real evaluation. Turn-end is a conservative transcript-based approximation,
  not confirmation that remote audio playback has finished.

`BASE_URL` overrides `http://127.0.0.1:3000`. `LIVE_OUT` overrides the artifact
folder (`test-results/live-reactive` for the reactive smoke). The JSON log and
readable timeline include observation, synthesis, playback boundaries, real
provider transcripts, and Jev requests/results. Failed scenario waits also leave
`failure.txt`. Clips use temporary files that are removed after playback or
failure; child audio connects only to the synthetic mic destination, never to
laptop speakers. Calls to `child.say(text)` are serialized and resolve after
playback ends. Browser/session cleanup cancels queued speech and active playback.

The reactive entry point is deliberately limited to explicit speech. Lesson-aware
answers, scenario/assertion DSLs, the reactive matrix, interruption, and full child
action reporting remain later work.
