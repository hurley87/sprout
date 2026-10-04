# Issue #57 live observer mode

On this branch, the local lesson runtime and `/api/classify` default to
`simplified-full-context`. This intentionally executes the experimental Jev
observer in future user-started live lessons. The legacy nine-Noul classifier is
preserved. This is not a decision to promote the design to main/production.

Start the experimental mode explicitly:

```sh
NEXT_PUBLIC_SPROUT_CLASSIFIER_MODE=simplified-full-context npm run dev
```

Switch back for comparison:

```sh
NEXT_PUBLIC_SPROUT_CLASSIFIER_MODE=legacy npm run dev
```

Stop the previous dev server, restart with the selected setting, refresh the page,
and start a new lesson. The public variable controls only the mode, never a secret.
Next inlines public variables into the browser bundle; a production build must be
rebuilt to change it. With no recognized override, the branch default is experimental.
The browser captures the mode for the lesson and sends it with every classification
request. The route validates the optional mode; direct requests without it use the
same configured default. Invalid explicit request modes are rejected.

## Exactly one selected observer

The route branches once: legacy calls `classifyConversationStateWithDiagnostics`;
experimental calls `classifyFullContextObserver`. A valid configured classification
invokes one selected observer and at most one Jev request. Cancellation or missing
configuration may make zero requests. Provider failure does not fall back to the
other mode or retry. There is no dual evaluation in live lessons.

Experimental mode uses `contextProjectionRequest(input, "B")`, the frozen shared
context-projection questions and pinned `jev-1.13.0`. The exact state is:

```ts
{
  nodeId,                         // captured current authored node
  scene: { object, quantity },    // authored facts for that node
  learningObjective,              // authored objective for that node
  transcript,                     // full ordered current-node/visit snapshot
  transcriptRevision              // captured revision
}
```

There is no `tutorObservation`, `supportEvidence`, previous-node/future-node
context, graph, edge or next scene in the provider state. The existing runtime
transcript accumulator and visit isolation are unchanged. The tutor question still
targets the latest relevant response, interpreting earlier child/tutor messages as
context. No fragmented-transcript special case was added.

The frozen Choice contract, strict output validation, probability bands and mapper
are shared between the comparison and live paths. Candidate completion evidence
requires `completed` plus `confirmed_completion` AND the existing experimental
probability gates. Other valid states hold without a proposal. Contradictory,
ambiguous, malformed, cancelled or failed results abstain.

The contract/validator/mapper were extracted into
`lib/experiments/issue-57/simplified-observer-contract.ts` so browser diagnostics
never import the provider transport. The original experiment module re-exports
that contract and retains its projection-A evaluation entry point. Question and
case hashes in the frozen comparison artifacts remain unchanged. The offline
comparison scripts still have no paid execution mode.

## Export diagnostics

The session JSON contains `classifierMode` at the top level and on every
`classifier.*` event, including scheduled, started, mapping, result/held/abstained,
error and cancellation events. `classifier.mapping.detail` additionally includes:

- classifier mode and accepted/abstained decision;
- objective/tutor choices, complete normalized distributions and confidence;
- mapped outcome and diagnostic-only ungated label eligibility;
- closed abstention reason when present;
- unchanged thresholds;
- locally captured node/revision and server elapsed milliseconds.

The event envelope preserves app-owned runtime/visit/child-turn/node/revision.
Result events retain the existing browser elapsed time. Valid experimental
negative observations are logged as `classifier.held`; abstentions remain
`classifier.abstained`. Legacy mappings retain their nine probabilities and now
include mode/identity/elapsed metadata. Raw provider bodies, echoed commands,
provider identity claims and credentials are never exported. Browser parsing
keeps only validated normalized fields. Diagnostics still have no transition
authority and do not change proposal handling.

The existing clarification recovery implementation and instruction are untouched.
Its eligibility helper consumes legacy nine-score ambiguity diagnostics; no
fabricated nine-score probabilities or new recovery policy were added for Choice
abstentions. Experimental abstentions hold pending fresh conversational evidence.
This is a limitation to observe in live tests, not permission to reuse stale
answers or loosen interruption protection.

## Regression fixture and checks

`tests/fixtures/issue-57-fragmented-confirmation.json` retains the meaningful
current-node transcript from the recent export, including the child interjection
between “Yes, two” and “ducks.”. The human interpretation marks the settled child
answer as completed; the actual Choice tutor-state result remains unmeasured.
Tests assert unchanged delivery of the full transcript, not a hardcoded semantic
answer from Jev. Synthetic provider outputs are labelled transport/mapping controls.

Live-route tests prove the default selects experimental, never calls legacy,
sends exactly projection B with shared questions, and performs one mocked provider
request. Reverse-switch tests prove legacy never calls experimental. Failure tests
prove no fallback. Runtime export tests prove mode identity and normalized mapping
survive into session data without raw markers. Existing reducer, scheduling,
interruption, stale-result, current-turn, audio-drain, render and steering tests
continue to pass. GPT-Live prompts, authored graph/reducer and their gates were not
edited.

All 669 unit tests, typecheck, lint, formatting and the Next.js production build
pass. No live lesson, provider calls or paid evaluation was performed by this task.
Run locally on localhost/127.0.0.1 with microphone permission and the existing
`OPENAI_API_KEY` / `TYPESAFE_API_KEY` configuration and provider access. Credential
availability and a real browser/audio session were not checked. There is no new
application startup dependency, and the built route now exercises the experimental
path. Restart the app before the next lesson so an older browser bundle cannot
continue requesting legacy mode. No merge or production/main promotion occurred.
