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

## 2026-10-07 recorded first-scene blockage

The supplied `Cap Recording - 7 October 2026.mp4` and accompanying VTT show
the learner correctly identifying memory inside the brain and contrasting it
with an external record. The tutor repeatedly acknowledges this distinction,
then asks for another restatement or elaboration. At 145 seconds the Engram
definition is revealed, but Continue remains disabled. The original session's
diagnostic export was not supplied, so its exact classifier scores and media
gate state are unknown.

Two bounded transcript replays through the configured local `/api/classify`
endpoint used the real classifier. The repeated-question response returned
`no_confident_concept_observation`. Replacing that response with a clear
confirmation and a pause returned confident objective/tutor completion, but
independent versus prompted concept scores remained split (0.47/0.52). The
mapper omitted `conceptObservations`, causing the reducer to reject the
otherwise valid confirmation even if a criterion had previously been revealed.
These are replay observations, not recovered diagnostics from the recording.

The mapper now emits an empty concept-observation list for such a completion
proposal. This records no new concept evidence and lets the reducer use retained
evidence; absent or partial evidence still blocks completion. Counting proposals
retain their existing shape. The demo's tutor instructions now explicitly
require brief confirmation followed by a pause for Continue, and the Engram
brief accepts evidence across answers without requiring repeated restatements
or properties belonging to later scenes.

Runtime regression coverage passes the mapper's actual proposal through the
runtime and checks both retained and absent evidence, the hold after another
tutor question, and advancement only after fresh confirmation and quiet media.
This validates the application fix with controlled scores. A fresh voice
walkthrough is still needed to verify the revised tutor behavior end to end.

## 2026-10-07 second demo: automatic advancement and Exogram recovery

The latest recording, `transcript-5zq227e44vx0nzv.vtt`, and exported session
`4bd5efa5-4a03-41d1-9443-f4dca8ee39bf` establish a stall in Exogram (scene 2),
not the later Exographics scene. Engram was accepted and carried into Exogram.
All eight Exogram classifier results abstained: the classifier lacked the earlier
Engram transcript and confused later tutor paraphrasing with help. None accepted
the Exogram criterion despite the learner's external-memory explanation.

The instructions now distinguish accumulated learner evidence, later tutor
confirmation, and criteria eligible for carry-forward. Bounded real-provider
replays produced one unreadable response, one accepted final transcript, and a
first-confirmation snapshot with confident Exogram evidence and tutor confirmation
but an uncertain generic completion score. The mapper now permits the reducer to
settle that last case from the confident current criteria and confirmation. It
does not invent carried evidence or override a confidently negative summary.
The normalized first-confirmation scores and transcript are retained in
`tests/fixtures/catching-unicorns-exogram-replay.json` as controlled regression
inputs; they are observations from a replay, not guarantees of future accuracy.

The demo now uses the shared runtime's automatic transition policy. Continue is
removed from the UI and tutor steering. Accepted criteria, tutor confirmation,
and quiet media lead to the next scene and its confirmed teaching context.
Incomplete answers still hold the current scene. Engram, Exogram and Exographics
share the centered question/answer styling; accepted definitions remain available
in collapsed details while unresolved definitions stay hidden. Other scene
questions use the same typography.

The mapper-to-reducer regression covers the recorded Exogram answer and holds
when carried evidence is missing, the summary is confidently incorrect, or tutor
confirmation is uncertain. The provider-free browser walkthrough traverses all
nine scenes without Continue clicks and checks matching question styles. A fresh
voice walkthrough remains necessary to verify model behavior end to end.

Validation for this update: all 896 unit tests, type checking, source lint
(excluding generated `test-results` artifacts), and the production build passed.
All 22 provider-free browser tests passed against the isolated production build,
including all nine demo scenes and computed-style equality for Engram, Exogram,
and Exographics. An earlier parallel development-server run reloaded several
pages and lost their session state; those failures did not recur with the
production build. The isolated checkout contains no provider credentials.

## Recorded Engram retries, 7 October 2026

The later recorded retry session accepted objective completion and tutor
confirmation but emitted no concept evidence: the final concept probabilities
were 0.76 independent, 0.23 prompted and 0.01 partial. Both demonstrations count
towards understanding, while prompting attribution remains uncertain. The mapper
now records demonstrated understanding without asserting either attribution.

`tests/fixtures/catching-unicorns-engram-replay.json` contains only normalized
scores and speaker-labelled transcripts for the four classified snapshots.
The runtime replay holds the earlier incomplete answers, records understanding
from the complete learner explanation, waits for final tutor confirmation and
quiet audio, and automatically renders Exogram. The shared diagnostic parser
round-trips those decisions. Separate tests retain the confidence boundary,
independent-only policy and earlier established attribution.

Validation for this fix: 904 unit tests and 22 browser tests passed, along with
TypeScript, source lint, and an isolated production build. Browser tests used
local provider peers; recorded scores were replayed without a new paid model call.

## Rejected comparison steering and silent question 2, 7 October 2026

The next report matched `invalid_value` to `:steer:3` immediately after rendering
Compare. The expanded append was 3,397 characters, measured at 673 tokens with
`o200k_base` and 679 with `cl100k_base`, exceeding the documented 500-token
append limit. The added rubric/checklist and repeated durable teaching guidance
introduced this regression. Question 2 received and acknowledged its scene
context, but the update did not explicitly require a new spoken question.

Durable teaching/checklist/recovery guidance now lives in startup instructions.
Scene updates retain the current prompt, objective, brief and private assessment
targets, removing repeated source provenance and global instructions. They
explicitly request the displayed question aloud immediately, then listening;
if the learner already started answering, they instruct listening instead of
interruption. No graph edges or future-scene content are added.

All nine updated scene appends measure 178–346 tokens with `o200k_base` and
178–346 with `cl100k_base`; question 3 is 331 with both. Recovery appends measure
63–138 tokens. Tests enforce authored-English size budgets of 2,000 bytes per
scene update and 1,000 per recovery. These budgets are regression checks, not
claims about the provider's exact tokenizer. Browser demo peers reject oversized
updates rather than blindly acknowledging them. Validation: 922 unit tests and
22 browser tests passed, plus TypeScript, source lint and an isolated production
build. The updated live tutor's spoken question compliance still needs a fresh
session; these checks verify request contents and the local transport flow.

## Question-2 confirmation ambiguity, 7 October 2026

The next question-2 stall recorded demonstrated Exogram understanding and carried
Engram evidence. The final tutor utterance explicitly accepted the learner's note
example, but the tutor Choice score was 0.87, below the unchanged 0.90 gate.
A recovery append was acknowledged but generated no subsequent tutor transcript;
its conditional wording permitted the tutor to remain silent.

Catching Unicorns tutor classification now observes the latest conversational act
separately from mastery: explicit affirmation plus a paraphrase of learner-supplied
content is confirmation, and earlier clarification is not the latest tutor act.
Mastery remains checked by objective/criterion mapping and the reducer. Recovery
with complete recorded concept evidence now explicitly requests speech immediately,
while permitting clarification for a contradictory latest learner statement.

One bounded live replay of the exact recorded transcript produced tutor confirmation
probability 1.00 and Exogram demonstration probability 0.97 combined across prompting
attributions. The uncertain generic objective remained 0.73; the existing criterion
completion path accepts the demonstration and confirmation while the reducer verifies
carried Engram evidence. The normalized replay fixture is
`tests/fixtures/catching-unicorns-exogram-confirmation-replay.json`. Tests advance to
Compare with carried evidence, hold without it, and reject tutor affirmation as a
substitute for missing learner mastery. Original-session scores are not overwritten.
Validation: 925 unit tests and 22 browser tests passed, plus TypeScript, source
lint and an isolated production build. One live classifier call verified the
updated confirmation interpretation; live recovery speech remains to be observed.

## Engram acceptance with added explanation, 7 October 2026

The next report recorded the learner explaining biological memory as information
stored in the mind or brain. The tutor explicitly accepted it, then added the term
"memory trace" and a contrast with a note on paper. The first original observation
scored tutor confirmation 0.89 and helping 0.11, despite independent learner
demonstration 0.93. Subsequent microphone activity without new transcript words
repeatedly reset recovery and reclassified the same revision.

The tutor criteria now give explicit acceptance precedence over added explanation
unless another question or retry request follows. This separates the conversational
act from learner mastery; score thresholds and microphone detection are unchanged.
One bounded live classifier replay returned confirmation 1.00 and independent
demonstration 0.91. The normalized fixture
`tests/fixtures/catching-unicorns-engram-acceptance-replay.json` contains that replay's
scores and the original safe event prefix, not overwritten original scores. The
event replay advances to Exogram at 21.342 seconds, before subsequent microphone
activity. It does not establish that microphone recovery issues are resolved.
Validation: 926 unit tests and 22 browser tests passed, plus TypeScript, source
lint, an isolated production build and diff whitespace checks. The paid replay
checks the exact transcript; a new live session is still needed to verify speech
and microphone behavior together.

## Exographics progress after a spent recovery, 7 October 2026

Report `595a0a09-d886-4c85-ab53-679bd49085f8` reached Exographics, question 4
of 9, then stopped without a provider error. At 226.179 seconds a support append
asked about visual symbols, the last missing criterion. At 257.254 seconds all
four required concepts were recorded, but the tutor continued asking questions.
The single visit recovery budget had been spent, so later complete evidence could
not trigger a new confirmation request. Later microphone turns also interrupted
completion authority; accepted concept evidence alone does not permit advancement.

Concept scenes now have separate support and completion request budgets, each
limited to one per visit, including failed sends. Completion guidance waits one
second of sustained quiet rather than the support path's four seconds. It is
selected only when the actual retained evidence satisfies the authored policy;
static carry eligibility is insufficient. The prompt names the accepted private
targets and explicitly supersedes the prior missing-target focus. New speech,
revisions, inactive phases and unavailable/active audio retain their cancellation
and quiet gates. No confidence threshold or microphone detector changes were made.

The original normalized held snapshots at revisions 330 and 383 are retained in
`tests/fixtures/catching-unicorns-exographics-progress-replay.json`. A runtime test
replays both explanations, spends support once, records all four concepts, sends
completion guidance once, and advances only after a controlled fresh tutor
confirmation and quiet audio. That closing response is mocked, not a fresh live
provider result. Request acknowledgment itself never advances the lesson.

Question 2's accepted explanation was followed by "Right" and "Okay", whose
confirmation scores were 0.76–0.79. The old four-second recovery and microphone
interruptions delayed advancement from the first held assessment at 47.410 seconds
until 59.272 seconds. The faster completion wait addresses that delay. New question
audio began approximately two seconds after each new scene rendered; those provider
response delays are separate and remain unchanged.
Validation: 929 unit tests and 22 production browser tests passed, plus TypeScript,
source lint, the isolated production build and diff whitespace checks. No paid
provider replay was run for this change; fresh live confirmation behavior remains
to be verified.

## First-question microphone starvation and next-answer leakage, 7 October 2026

Report `d19098c9-9424-400c-888d-77303f6f9b2f` contained a correct internal-memory
explanation followed by the tutor's "Yeah, that's right" and unsolicited contrasts
with a notebook entry and a file. The old Engram target required an explicit external
contrast, encouraging disclosure of the next question's answer. Engram now accepts
biological memory inside the mind or brain without that comparison. Its tutor brief
requests a short acceptance without added definitions, external examples or contrasts.

The original early classification held the answer at 0.63 combined demonstration,
before tutor confirmation. Later energy-confirmed microphone turns contained no new
child transcript, preventing classification of the completed tutor response. Missing
text recovery was armed at 27.671 seconds, then repeatedly cancelled by short discarded
candidates. Concept-lesson missing-text recovery now survives discarded candidates,
preserving the tutor-audio quiet deadline and deferring sends while activity is pending.
Confirmed speech and new child words still cancel; active/unavailable tutor audio resets
the quiet deadline. Counting candidate behavior is unchanged. Prior completion authority
is never restored and a recovery append alone cannot advance.

A bounded live classifier replay of the exact final transcript with the revised
rubric scored completed 0.95, tutor confirmation 1.00, independent demonstration
0.90 and prompted demonstration 0.09. Those new scores, the original early outputs
and a safe projection of 119 original media/microphone events are stored in
`tests/fixtures/catching-unicorns-engram-location-replay.json`. The runtime replay
requests recovery before 35 seconds, holds without current learner text, and advances
only after a controlled fresh answer and confirmation. The fresh exchange is mocked;
the replay does not establish that the original untranscribed activity was noise.
Validation: 933 unit tests and 22 production browser tests passed, plus TypeScript,
source lint, the isolated production build and diff whitespace checks. One paid
classifier replay verified the revised rubric; fresh live tutor speech and
microphone behavior still need to be observed together.

## Removal contract and rehearsal

The demo registration is the `catching-unicorns` entry in
`lib/lesson-runtime/lesson-registry.ts`. To remove the demo while retaining the
shared runtime and counting lesson, delete these demo-owned files:

- `app/demos/catching-unicorns/page.tsx`
- `components/catching-unicorns-demo.tsx`
- `components/catching-unicorns-demo.module.css`
- `lib/lesson-runtime/catching-unicorns-lesson.ts`
- `tests/browser/catching-unicorns.spec.ts`
- `tests/catching-unicorns-completion-policy.test.ts`
- `tests/catching-unicorns-lesson.test.ts`
- `tests/catching-unicorns-presentation.test.ts`
- `tests/catching-unicorns-runtime-continuation.test.ts`
- `tests/catching-unicorns-steering.test.ts`
- `tests/fixtures/catching-unicorns-transcripts.ts`
- `tests/fixtures/catching-unicorns-exogram-replay.json`
- `tests/fixtures/catching-unicorns-engram-replay.json`
- `tests/fixtures/catching-unicorns-engram-acceptance-replay.json`
- `tests/fixtures/catching-unicorns-exographics-progress-replay.json`
- `tests/fixtures/catching-unicorns-engram-location-replay.json`
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

## Culture question: two examples, 10 October 2026

The displayed and spoken prompt is now: “Give two examples of what makes a culture
techno-literate.” Two distinct relevant characteristics from the Introduction
satisfy the task, including natural paraphrases accumulated across replies.
Repeated mentions of one characteristic count once. Two named cultures or
institutions are not the task. Learners need neither a causal explanation nor an
account of all four characteristics. One example permits a request for a second;
unclear meaning permits at most one short, neutral clarification, without giving
away missing answers. After two examples, the tutor briefly acknowledges and
pauses for application-owned advancement, without opening an optional discussion.
Recognized requests to move on continue to preserve unresolved evidence.

The scene's count policy records each of the four source-backed criteria
separately. Two accepted criteria never fabricate evidence for the other two.
The full definitions and four-item CAF reference framework remain available in
the lesson; only accepted evidence authorizes each reveal. Source evidence is
still separate from transfer reasoning. Production remains conversation-first:
this count defines sufficient task evidence, not a new mastery gate on voluntary
navigation or conversational closure. Global confidence thresholds, render,
steering acknowledgment and audio-drain behavior are unchanged.

The bounded transcript inspection of export
`8e0a754a-785b-4b2f-9ecb-f0587f47d450` confirmed that the tutor probed all four
characteristics and opened another discussion after the learner had named them.
The export and audio are not checked in. Missing-transcript recovery, “yep”
navigation recognition and retrospective review failures remain separate work.

`catching-unicorns-culture-scope.test.ts` exercises all six characteristic pairs,
a single/repeated characteristic, accumulated paraphrases, evidence references,
selective reveals, CAF provenance and invalid count policies with controlled
observations. `conversation-first.test.ts` exercises actual runtime advancement
with mocked classification and transport, including active/unavailable audio,
fresh acknowledgment, quiet drain, rendering and steering acknowledgment. The
browser walkthrough now supplies only two culture examples and checks that the
other two remain unresolved in CAF. These deterministic tests and authored
instruction assertions do not establish live provider recognition or tutor speech
semantics; a fresh human voice walkthrough remains necessary.
