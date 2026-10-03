# Sprout

A private, parent-supervised prototype for short counting lessons that adapt to reviewed evidence from earlier sessions. Start with the [MVP documentation](docs/README.md) for product scope, architecture, and the seven-day experiment.

The root route runs the transcript-state-steering lesson. GPT-Live is the conversational tutor;
Jev's `ConversationStateClassifier` proposes semantic state; the authored graph and deterministic
reducer own the lesson and UI; local microphone and output activity provide choreography evidence.
`/experiments/transcript-state-steering` remains a temporary alias. The superseded answer/delegation
lesson controller has been removed.

The root experience keeps its local diagnostic export. It does not yet record audio or persist
sessions. The post-session Observer, stored evidence and parent-review infrastructure remain
separate from the realtime classifier.

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
without a running deployment. `ConvexSessionRecorder`, `SessionEvidenceRecorder`, the recording queue,
and the inspector remain available for durable evidence and existing saved sessions. Configure
`NEXT_PUBLIC_CONVEX_URL` for callers of the browser recorder. These primitives are not yet wired
into the transcript-steering root lesson. Sprout playback attribution and support capture remain deferred.

Ended records are analyzed after the recording attachment is durably committed. The internal Convex
action needs server-side `OPENAI_API_KEY`; `OPENAI_OBSERVER_MODEL` optionally selects a text model,
defaulting to the unvalidated `gpt-6-astra` evaluation candidate. Never use a `NEXT_PUBLIC_*` key.
Provider analysis is initiated through a loopback-guarded Next.js route and a backend action that requires the matching
server-only `OBSERVER_SERVER_CAPABILITY` in both the Next.js and Convex Node runtimes. Public audio attachment only
persists the recording; after durable assembly, the recorder notifies that route to start automatic analysis. If this
notification fails, the saved record remains available for explicit retry. Configure the same high-entropy capability
on both servers before enabling analysis; never set it in a `NEXT_PUBLIC_*` variable. No capability is configured or
deployed by this repository change.

The retained browser-reference helper stores only the latest durable session ID, which an inspector host can use to reopen a saved record after reload. Session evidence and audio stay in Convex. The inspector offers a loopback-guarded retry for failed, expired, or not-yet-requested saved-record analysis without starting a live lesson. Active controller and microphone state are not restored; missing or invalid references and pending/incomplete records are identified explicitly.
See [Observer provider feasibility](docs/observer-provider-feasibility.md) for limits, evidence rules,
and the remaining synthetic evaluation gate. No live-provider suitability result is claimed.

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

## Verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
`npm run test:browser` covers the root/temporary alias, reusable transport media,
and a standalone saved-evidence inspector fixture. The retired live runners and answer-calibration
commands were removed because they depended on the old lesson's evaluation endpoint and debug UI.
Generic synthetic microphone, audio, event-journal and artifact tools remain for verification.
See the [manual browser guide](docs/transcript-state-steering-browser-experiment.md) for live evaluation.
