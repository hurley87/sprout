# Calculus tutor display and confirmation contract

Commit 7 extends the existing `session.instructions.append` path. It adds no
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
