# Commit 5: Exographics conversational closure

Starting commit: `a72a0fe`, branch `codex/issue-71-catching-unicorns-demo`, PR #72.

## Instruction review

The Exographics brief told GPT-Live to “Assess four targets separately”,
“Clarify one genuinely missing meaning at a time”, and, for abstraction, “ask
what idea or relationship the example expresses”. These can encourage another
criterion-specific probe after the learner has already explained that relationship.
Its final “Once clear” closure condition was less explicit than the shared session
and node guidance, which already permit closure when sufficient or when discussion
has run its course. The private `all_demonstrated` targets describe assessment;
they should not become a conversational interrogation checklist.

This is an instruction-level conflict in incentives, not proof that these words
caused any particular October 17 model response. No live provider run was made.

## Change and teaching safeguards

Only `exographics.tutorBrief` changes in production. It now asks GPT-Live to use
accumulated explanations across replies, avoid redundant examples/rephrasing/
elaboration for assessment confidence, and acknowledge the specific accurate
contribution before signalling closure and pausing for the app. It explicitly
permits unresolved concepts and says closure does not require all four concepts
independently demonstrated. Move-on requests receive no further question.

Meaningful ambiguity and incomplete ideas can still justify useful follow-ups.
Errors receive concise correction. The brief now explicitly permits targeted help
after difficulty or a request, consistent with the existing shared guidance's
requirement for scene-specific permission. It does not prescribe a follow-up count
or canned dialogue. Naming an example alone still does not prove meaningful visual
symbols, abstraction, or shared conventions. Tutor-supplied content remains
separate from independent learner evidence, including tutor-introduced shared
meaning. The learner can conclude an incomplete discussion without being told
that every concept is mastered.

The learning objective, four authored concepts, completion policy, shared tutor
instructions, Jev/source pipeline, reducer, navigation, recovery, audio drain and
terminal recap are unchanged. GPT-Live conducts the discussion, Jev evaluates
evidence independently, and the application controls transitions. No assessment
probabilities, accepted ledger or source boundaries were added to GPT-Live context.

## Verification

Five prompt-contract tests were added to `tests/catching-unicorns-steering.test.ts`.
They cover cumulative sufficiency, redundant examples and abstract restatements,
clarification/correction/help, specific rather than blanket praise, closure with
unresolved concepts, independent evidence boundaries, move-on requests, and
consistency with durable session guidance. Existing tests retain the scene append
budget: the revised Exographics update is 1,961 UTF-8 bytes, below 2,000.

- Eight targeted files: **138 tests passed**, including Commits 1–4, evidence
  spans/source boundaries and lesson-content checks. The preceding attribution
  tests verify that tutor-supplied shared meaning is not credited independently;
  closure/navigation tests verify progression without fabricated mastery.
- Full `npm test`: **1,351 passed, 48 skipped**. One frozen benchmark hash test and
  two frozen experiment suites fail as before this commit. The active lesson file
  hash necessarily changes; no historical issue #42 data or guards were edited.
- Scoped ESLint and `git diff --check`: passed.
- `npm run typecheck`: passed in a clean source archive of `a72a0fe` with the two
  changed TypeScript files applied, using installed dependencies. This avoids the
  checkout's previously identified ignored historical UI copies in `test-results`.

Static prompt assertions and controlled runtime tests do not prove live GPT-Live
adherence, naturalness, or improved follow-up frequency.

## Existing harness and live comparison

`playwright.live.config.ts` and `tests/browser/live/README.md` describe the existing
opt-in provider-backed microphone/observation harness. Its scenarios and ready
helpers currently target the counting lesson; they are not an Exographics
pedagogical evaluation. The Catching Unicorns suite in
`tests/browser/catching-unicorns.spec.ts` instead uses a local WebRTC peer and
mocked classification, so it cannot measure tutor judgment. No new evaluation
framework or billed session was introduced for this commit.

Compare `a72a0fe` with this commit using fresh sessions on the existing
`/demos/catching-unicorns?debug=1` page and its diagnostic export. Keep provider
settings and learner contributions comparable. Include mathematical notation,
maps/diagrams and music notation, plus partial/ambiguous answers, an incorrect
claim, a help request, continued uncertainty and an explicit move-on request.
Inspect the spoken turns and exports for redundant examples/restatements after
sufficient explanations, appropriate clarification or concise correction, support
when requested, and closure without a new question. Verify the recap preserves
unresolved/prompted distinctions, especially when the tutor introduces shared
meaning. Check that requested learner discussion can continue without a rigid
follow-up limit. Provider variability requires cautious comparison; a passing
static test is not a substitute for these observations.
