# Calculus tutor display and confirmation contract

Historical commit 7 contract: commit 7 extends the existing `session.instructions.append` path. It adds no
transport, provider delegation, voice confirmation parser or public route.
The conversation guidance follows [official GPT-Live prompting guidance](https://developers.openai.com/api/docs/guides/live-prompting)
for focused clarification, interruptibility and application-owned confirmations.
The existing session/API contract is unchanged.

## Board and voice adapter responsibilities (commits 8/9)

1. Render the entire `math.pending.batch`, including action order, exact supplied
   expressions, targets and source quotes. Retain its `id` and `boardRevision`.
   After that provisional view actually commits to the DOM, call
   `confirmMathProposalDisplayed(id, boardRevision)`. This both marks that exact
   proposal visible and sends bounded feedback asking whether those exact actions
   match the learner's intent. It does not accept the proposal.
2. Obtain explicit learner confirmation tied to that displayed proposal and one
   operation per action (`differentiate`, `rewrite`, or `unassessed`). Invoke
   `confirmMathProposal(id, boardRevision, operations)` only through the trusted
   confirmation control. Confirmation establishes interpretation fidelity and
   intent, never supported reasoning or independence. Generic yes, tutor praise,
   model output and rendering cannot grant acceptance.
3. Acceptance immediately publishes the math snapshot, even during tutor output.
   Render the new board AND disposition, including non-equation strategy,
   clarification, help and undo outcomes. After DOM commit call
   `confirmMathFeedbackDisplayed(math.feedback.token)` for the exact snapshot.
   This token is separate from the scene token and provisional proposal ID.
   Feedback is consumed once; send failures cannot undo math or end the session.
   A provider acknowledgment or completion is never an equation publication gate.
4. Ordinary speech onset currently revokes pending proposals and unsent feedback.
   The later spoken-confirmation adapter must reserve the displayed token BEFORE
   onset, suspend mutation while speaking, authenticate a bounded confirmation-only
   turn before normal `learnerRevision`, retain that confirmation, and call the
   acceptance API. Any correction or other words revoke the reservation. Calling
   the existing API after an ordinary yes transcript cannot recover revoked
   authority. The tutor asks about the exact displayed proposal; it never calls
   confirm or claims acceptance. The direct UI confirmation path works now.

The feedback view contains only the current problem presentation, last six current
board versions (with an omitted count), up to eight recent action dispositions,
and the entire current pending action projection. There are no review keys,
validator solution details, future problems, raw transcript quotations or previous
visits. The 24,000-character context budget abstains rather than splitting an
expression/proposal. Renderers must still show all proposal sources; the voice
feedback projection deliberately omits them. Stopped/inactive views cannot send
feedback. New speech, corrections, board edits, visits and Stop revoke unsent tokens.
The append explicitly expires earlier feedback on those changes. Already-sent
provider instructions/audio cannot be retracted or made compliant by this check.

## Assistance and evidence

The shared application observation sequence orders learner fragments, explicit
app help and observed tutor text. `recordMathSourceEvent(kind, text)` is a trusted
app-only boundary: use `neutral-probe`, `hint`, `supplied-answer`, `unknown-help`
or `tutor-context` explicitly, never model self-grading. App feedback probes are
neutral; requested hint instructions are recorded as hints when sent, which does
not prove they were spoken. Unclassified tutor transcript fragments are retained
as unknown-help. This deliberately includes ambiguous praise/recitation rather
than asserting that the tutor gave either a specific hint or no help. Tutor-only
updates preserve pending learner authority; help events do not retroactively
rewrite an earlier attempt's evidence. Subsequent work/corrections retain their
applicable help provenance. Fragment completion order includes intervening help.
No-event silence never establishes independence; runtime reasoning remains
unassessed (strategy observations are only strategy-only), and known correct math
is not mastery. Tutor speech alone creates neither board edits nor evidence.

## Verification limits

Deterministic fixtures verify context projection, display-token matching,
publication ordering, stale suppression, conservative evidence and regression
boundaries. They cannot establish actual spoken compliance, prevent every verbal
answer leak, or demonstrate microphone interpretation accuracy. Real audio
sessions and the reserved spoken-confirmation adapter remain pending. No paid
provider calls were made: the previously invalidated key returned 401. Board UI,
spoken adapter, live evaluation and commit 8 are outside this commit.

Offline verification on base `2f43791ca98f1932faeac9f46f42030b6d2fde22`:

- Focused calculus/endpoint and scheduling/navigation/transport regression command:
  `npx vitest run tests/calculus-*.test.ts tests/math-action-route.test.ts tests/lesson-runtime-scheduling.test.ts tests/mae386-navigation-runtime.test.ts tests/browser-transport.test.ts`
  — 329 passed, one explicit live-provider replay skipped, 12 files.
- `npm test` — 2,180 passed, one explicit live-provider replay skipped, 101 files.
- Targeted ESLint for the seven changed/new TypeScript files — pass, no warnings.
- `npm run typecheck` and `npm run lint` — pass in a disposable clean copy of
  tracked base source plus this change, using the installed dependencies.
  Ignored historical artifacts in the working checkout were preserved; no project
  lint or TypeScript exclusions were changed to hide them.
- `git diff --check` — pass. Browser/audio acceptance was not run for this commit.


## Commit 9: public demo and bounded spoken confirmation

`/demos/calculus` reuses the shared browser voice lifecycle and controls, with one
current authored prompt, ordered read-only mathematical work and correction
history. The initial scene display token is independent of proposal display and
board feedback tokens. Only `?debug=1` shows session details and the transcript;
a basic scrubbed JSON session export is available there, including after Stop. Confirmation
is an explicit learner action, never a render callback or correctness judgment.

Before local microphone onset is dispatched, the runtime reserves the exact
already-displayed pending ID, board revision, visit and expected learner turn.
Mutation stays disabled during microphone activity. Authenticated learner fragments
must remain a prefix of the closed command grammar; other words revoke the
reservation immediately and follow normal interpretation/navigation. At the local
speech-end boundary the runtime checks the entire received learner turn, then
accepts against the reserved identity **before** advancing mathematical learner
revision. Discarded activity, textless turns, stale identity, Stop and visits revoke
without inventing a revision. Tutor text never confirms. A fresh command cannot
recover an undisplayed or already-revoked proposal.

The grammar is case-insensitive, with an optional final period:

- One action: `confirm differentiation`, `confirm rewrite`, or
  `confirm without checking`.
- Ordered batches: `action 1 confirm rewrite; action 2 confirm differentiation`
  (one explicitly numbered command per action, separated by semicolons).
- Bound: at most eight actions, 600 characters and eight seconds from microphone
  onset through local speech end, including the local quiet window. Turns exceeding those
  speech bounds or unreliable punctuation can use the per-action UI operation selectors and
  **Confirm displayed actions** button.

Generic yes, quotation marks, reported/negated/conditional commands, question
marks, extra correction words and partial batches cannot accept. The UI rechecks
the same current proposal/visit/revision authority and is disabled during speech
or before the exact proposal has been displayed. Spoken confirmations retain their
text, operations, fragment source/timing metadata, revision and reserved identity
in the exported report. Consumed confirmations and accepted learner fragments are
excluded from subsequent extraction, including after late tutor fragments change
message grouping. Confirmation establishes intended notation/operation only;
reasoning and independent understanding remain unassessed.

Confirmation calls `commitMathBatch` once: it parses the source-bound batch,
requires a faithful review callback for every action against the staged board,
and publishes the entire batch or nothing. Frozen states and stale batch identities
reject. The controller also checks the captured state and displayed pending UUID,
then clears the proposal after commit. History `deliveryId` retains that UUID only
for feedback/diagnostic correlation; it is not a deduplication mechanism.
Each created board version retains its validation `base` and resulting `context`
under `validation`, including null contexts for unchecked operations. Replacement
and undo read that version metadata directly; exported checks keep their existing
shape, and version metadata is included in board snapshots and diagnostics.

Exact complete `help` and `repeat` learner turns use the existing support append
path (with hint or neutral-probe provenance), waiting for observed quiet output.
Direct `next`, `next problem`, and `skip this problem` use the authored navigation
path, with its debounce/quiet gates. Quoted or negated navigation does not advance.
Math-provider `next` proposals alone still cannot grant navigation authority.
Wrong signs, replacements and undo originate in learner voice through
`/api/math-action`; strategy-only and missing-operand actions add no equations.
Natural completion says practice finished; early Stop retains the stopped board.

Browser integration exposed that the prior verbose feedback exceeded the existing
2,000-byte append ceiling. Feedback now uses lossless ordered expression tuples
without importing the KaTeX renderer into the runtime, up to six current lines,
the complete pending proposal and latest disposition. Initial session instructions
already carry the full tutor guidance. Normal authored product-rule and chain-rule
multi-line workflows have explicit budget regressions. Truly oversized context
abstains without truncating a proposal or equation; correlated feedback rejection
cannot undo work or terminate the voice session.

The provider has no input-turn completion event. The adapter defines a complete
bounded turn using existing local VAD speech end and requires its transcript to
have arrived by that boundary. Late recognition cannot recover the reservation;
post-boundary amendments are ordinary new evidence and cannot retroactively prove
fidelity of an already accepted command. Real recognition fidelity, spoken tutor
compliance and transcript latency remain unverified. No paid provider calls were
made; the previously invalidated credential returned 401. All browser evidence
uses labelled deterministic math responses, synthetic microphone audio and local
WebRTC transport. Commit 10 diagnostics/regression work and real microphone
acceptance remain separate.


Streaming tutor deltas are coalesced into contiguous messages before extraction.
Only the most recent sixteen nonempty tutor messages are included, each bounded
to 2,000 characters; an explicit omission marker precedes a retained recent suffix
when earlier context is omitted. This changes assistance context only, never exact
learner sources. A regression covers 24 small tutor deltas followed by another
learner step, and another covers an oversized tutor message.

Commit 9 verification (base `6372c31abe7eafc0ce0c6eabacac6f69e750ae35`):

- Focused calculus, math endpoint, scheduling, MAE386 navigation and browser
  transport units: 371 passed; one explicit live-provider replay skipped, 14 files.
- Calculus plus MAE386 browser suites: 12 passed with `--workers=1`.
- Final calculus-only browser rerun, including dictated chain-rule fixture and
  confirmation export provenance: seven passed with `--workers=1`.
- Scoped ESLint and clean-source `npm run typecheck` / `npm run lint`: pass.
  Clean-source checks use tracked source plus this change and installed
  dependencies. Existing ignored historical TypeScript artifacts were preserved;
  project exclusions were not changed to conceal them.
- Route inspected in the app browser. Desktop and 390px-wide full-page proposal
  screenshots retained locally under `.sprout-evidence/issue80-commit9/`.
- `git diff --check`: pass. The full browser/build gate belongs to commit 10.
