# Catching Unicorns demo validation

This record covers the final validation slice for the standalone lesson at
`/demos/catching-unicorns`. The route uses the existing realtime lesson runtime,
session endpoint and semantic classifier endpoint. The authored content and
presentation are demo-specific; the lesson definition, reducer and runtime stay
shared with the counting lesson.

## Scope and evidence

`tests/catching-unicorns-lesson.test.ts` exercises reviewed transcript shapes
through the deterministic reducer. Its observations are controlled inputs, not
claims about provider accuracy. The fixtures cover paraphrase, incomplete and
misconception answers, self-correction, non-leading prompts, tutor-supplied
wording echoed by the learner, mixed evidence, both justified Canadian Armed
Forces conclusions, and weak transfer reasoning. The source-fidelity regression
also checks that:

- biological-memory paraphrases demonstrate Engram while an external-record
  answer does not; non-biological/external-memory paraphrases demonstrate
  Exogram;
- durability, shareability and revisability remain separate criteria;
- “writing things down” remains partial for Exographics until broader symbolic
  representation is shown;
- `84 + 1,045 + 693 + 719` prompts reification and memory extension, while the
  arithmetic result is explicitly outside the mastery rubric;
- technology use alone leaves the four techno-literate characteristics
  undemonstrated; and
- recap categories report recorded evidence and do not require “extended
  cognition” as a source-defined term.

`tests/browser/catching-unicorns.spec.ts` mounts the route and shared runtime
with local transport and controlled classifier responses. It checks hidden
answers, individual within-scene reveals, carried evidence, scene handoffs,
skip/early ending, evidence-grouped recap, export and cleanup. This is
provider-free integration coverage. A mocked accepted proposal is not evidence
that GPT-Live will prompt correctly or that Jev will judge a live paraphrase,
correction or tutor echo correctly.

On the final demo implementation, `npm test` passed (45 files, 887 tests),
`npm run typecheck`, `npm run lint`, and `npm run build` passed, and
`npm run test:browser` passed all 22 provider-free browser tests. Existing
counting coverage is included in the full unit and browser suites. The browser
suite ran from the disposable checkout because the primary checkout already had
a Next.js development server holding the shared `.next` lock; its configured
server reuse is disabled.

The authored source inventory points to *Catching Unicorns*, Preface
pp. xi–xiii and Introduction pp. 3–6. The referenced `CU to Dave.pdf` was not
available in the workspace during #65; its page claims are inherited from that
inventory and have not been independently checked against the PDF. The demo
does not make claims from the later body chapters.

## Live acceptance status

**Counting baseline: passed.** On 2026-10-07, the existing live harness ran its
single `@happy-path` counting scenario. The real session completed all three
counting nodes, recorded three current classifier results, and reached
`lesson_completed`; the harness's media and peer teardown assertions passed.
This confirms the configured providers and existing counting path were
available during the run. It does not establish Catching Unicorns classifier
accuracy.

**Catching Unicorns live walkthrough: blocked before the first learner turn.**
The demo route and Engram scene rendered, but the voice connection ended about
22 seconds later with `The voice connection or microphone became unavailable.`
The report contains no `session.started`, learner transcript, or classifier
result. No learner audio was played. The complete lesson, ambiguous-answer
probe, source-fidelity judgments, evidence-based recap, and real-session cleanup
therefore remain unverified. A bounded demo attempt was made, but it did not
produce semantic acceptance evidence. The bounded counting pass does not clear
this demo-specific blocker.

For both runs, the variables were loaded into the invoking process from the
existing `.env.local` via Node's `--env-file` option. The file was not opened
and its values were not printed or copied into the artifacts. The Playwright
live config then passed only the required provider variables to its isolated
server. The demo connection failure may still have incurred provider cost.

Reviewable, uncommitted harness artifacts are retained under
`test-results/live-acceptance-2026-10-07/`: `counting-happy-path/` and
`catching-unicorns-connection-failure/`. They contain the production report,
sanitized harness record, and event timeline; credentials, SDP, and raw
provider bodies are excluded.

When the demo voice connection is available, rerun only the bounded Catching
Unicorns walkthrough: one incomplete/ambiguous Engram answer followed by a
learner recovery, then the complete nine-scene lesson. Record the prompt,
learner evidence, tutor probe, classification, reveal/hold, final recap and
resource cleanup from the observation export. Keep the run small and opt-in
because it can make billed GPT-Live and Jev calls; use `docs/browser-tests.md`
and the existing live harness for credential handling. Do not report mocked
acceptance as live model evidence. The counting baseline does not need to be
repeated unless the counting path changes.

## Removal contract and rehearsal

The demo registration is the `catching-unicorns` entry in
`lib/lesson-runtime/lesson-registry.ts`. To remove the demo while retaining the
shared runtime and counting lesson, delete these demo-owned files:

- `app/demos/catching-unicorns/page.tsx`
- `components/catching-unicorns-demo.tsx`
- `lib/lesson-runtime/catching-unicorns-lesson.ts`
- `tests/browser/catching-unicorns.spec.ts`
- `tests/catching-unicorns-completion-policy.test.ts`
- `tests/catching-unicorns-lesson.test.ts`
- `tests/catching-unicorns-presentation.test.ts`
- `tests/catching-unicorns-runtime-continuation.test.ts`
- `tests/fixtures/catching-unicorns-transcripts.ts`
- `docs/catching-unicorns-demo-validation.md`

Then remove the Catching Unicorns import and registry entry from
`lib/lesson-runtime/lesson-registry.ts`, and remove its documentation link and
paragraph from `docs/README.md`, the module row from `docs/architecture.md`, and
the demo-specific paragraphs from `docs/browser-tests.md`. Keep the generic
concept-evidence contract, reducer, runtime and all counting content/tests.
There is no route-level shared-runtime hook to redesign and no counting lesson
or counting rubric change required.

The removal rehearsal was performed in a disposable detached checkout based on
the final delivery files. The steps above were applied only in that checkout;
the delivery branch retained the demo. After removal, `npm run build`,
`npm run typecheck`, `npm run lint`, `npm test` (41 files, 860 tests), and
`npm run test:browser` (18 tests) passed. The first typecheck saw a stale
generated `.next/dev/types` reference to the deleted route; after clearing only
the disposable checkout's generated `.next` directory, fresh type generation
and typecheck passed. No shared runtime redesign or counting change was needed.
