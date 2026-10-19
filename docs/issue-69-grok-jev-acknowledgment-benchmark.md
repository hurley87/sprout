# Grok + Jev acknowledgment benchmark (Commit 2)

**The October 18 phrase is recognized by real Jev:** with authored node
`count-1-duck`, expected answer `one duck`, validated learner `One duck.`, and
final tutor `One duck. That's right!`, pinned `jev-1.14.0` returned **0.99** in
**110 ms**. The unchanged 0.95 gate accepts it. The actual Grok-only grammar
abstains on that same text. The confirmation following the number was not a
blocker in this sample.

**The real voice walkthrough did not complete scene 1.** Grok transcribed the
existing adult synthetic `answer-one` fixture ("I see one duck.") as "I see one
dog." and proposed `incorrect/none`. The unchanged counting validator rejected
that report as `unsupported incorrect answer`. No learner answer was accepted,
no Jev acknowledgment request became eligible, and no scene transition occurred.
The attempt stopped at this genuine blocker; scenes 2–3 and a fresh Grok-only
comparison were not executed. This does not establish a Jev integration failure
or success in a live lesson.

## Evidence and scope

- [Actual Jev probabilities and metrics](evidence/issue-69-jev-acknowledgment-benchmark.json):
  32 sequential calls, one per eligible authored text example, no retries,
  five-second deadline each, exact model identity validated on all 32. Includes
  labeled inputs, rationale, raw **probability projection only**, request timing,
  parent revision and source SHA-256s. No raw provider bodies or credentials.
- [Actual Grok + Jev-mode walkthrough](evidence/issue-69-grok-jev-live-walkthrough.json):
  one provider session, one learner fixture, actual sanitized native WebSocket
  events, the application JSON export and decision timeline. The mode was
  `grok-jev`; there were zero eligible Jev HTTP requests in this session.
- [Independent authored dataset](../lib/experiments/grok-counting/acknowledgment-cases.json):
  33 fixed cases labeled **before** live predictions: 13 positive, 13 negative,
  six ambiguous, plus one negative precondition case with no validated learner
  utterance. Labels are developer judgments, not independent human adjudication.
- [Historical comparison](issue-69-grok-counting-evaluation.md) and
  [later October 18 Grok evidence](evidence/issue-69-grok-settlement-live.json)
  remain unchanged. Historical runs are separate evidence, not new paired runs.

The expected-answer formatter is shared between browser input construction and
server validation: `one duck`, `two ducks`, `three butterflies`. It changes only
experiment classifier context, not curriculum, tool schema or learner validation.
The Jev question and criteria, model pin and production threshold remain unchanged.
An internal server/harness-only evaluator returns the validated scalar probability;
the browser endpoint continues to return only its closed decision schema.

## Actual Jev text results

At 0.95, all **13/13 positives** were accepted, **0/13 negatives** were accepted,
and **0/6 ambiguous cases** were accepted. No false positives or missed positive
acknowledgments were observed in these 32 calls. The extra no-learner-evidence
case was blocked before classification, with no probability or paid request;
it is not included in model accuracy denominators.

The three-way semantic interpretation uses `positive` at p ≥ threshold,
`negative` at (1−p) ≥ threshold, and `abstain` between these boundaries or on
failure. The production progression gate withholds **both negative and abstain**.
These are deliberately reported separately:

| Threshold, same collected probabilities | Definitive semantic accuracy, abstentions unresolved | Negative false positives | Missed positives, including abstention/failure | Semantic abstentions, all 32 | Ambiguous abstentions, of six |
| --- | --- | --- | --- | --- | --- |
| 0.90 | 26/26 (100%) | 0 | 0 | 2 (6.25%) | 2 |
| **0.95 (unchanged)** | **24/26 (92.31%)** | **0** | **0** | **6 (18.75%)** | **4** |
| 0.99 | 18/26 (69.23%) | 0 | 0 | 14 (43.75%) | 6 |

At 0.95 the two unresolved definitive negatives were "Is there one duck?"
(p=0.08) and "Say one duck." (p=0.07); both were correctly withheld by the
production gate. Thus binary accept/withhold agreement on the definitive set
was **26/26**, while the stricter semantic accuracy was **24/26**. Two ambiguous
utterances were confidently negative, rather than abstentions; all six were
withheld. In total the production gate withheld **19/32**, which is not the same
quantity as six semantic abstentions. Selective accuracy on confidently decided
definitive examples was 100%, with coverage varying by threshold.

**Model identity:** 32/32 correct. **Provider errors/timeouts:** 0/32. **Latency:**
median **136 ms**, nearest-rank p95 **273 ms**, maximum **309 ms**, n=32. These are
local server-side fetch/parse/validation round trips, including network and
connection setup. They are not provider compute-only measurements and exclude
browser HTTP overhead. No percentile confidence or population-tail claim is
supported by this sample. Every positive returned 0.99; this small set cannot
justify threshold calibration or a threshold change. No alternative-threshold
provider calls were made.

For comparison, the unchanged Grok-only grammar recognizes **3/13** of the same
positive texts and none of the 19 eligible negative/ambiguous texts. This is a
deterministic offline replay of the actual shared grammar, not another live
voice session. It explains the natural-language coverage improvement without
claiming a controlled paired provider experiment.

## Actual voice attempt and timing

The harness used the existing checksum-verified macOS Albert synthetic adult
`answer-one`, `answer-two` and `answer-three` fixtures, but played only the first.
It waited for real tutor text, real question PCM, provider generation completion
and local playback idle before supplying the answer. There were no route mocks,
VAD/transcript/tool injections, classifier overrides or synthetic transitions.
No human listened to the generated output or rated the fixture here.

| Observation | Actual result |
| --- | --- |
| Requested and provider-echoed Grok model | `grok-voice-3.0` (provider-reported identity) |
| Opening text | "Hello, friend. I see a duck on the screen. How many ducks do you see?" |
| Settled/revised learner text | "I see one dog." |
| Tool proposal | `incorrect`, support `none`; rejected `unsupported incorrect answer` |
| Settled learner → rejected tool report | **3,000 ms**, application timeline 8,732 → 11,732 ms |
| Settled learner → validated tool | Unavailable; no validated proposal |
| Jev classification latency/result | Not executed; eligibility precondition not met |
| First scheduled acknowledgment audio / acknowledgment drain | Unavailable; no accepted answer acknowledgment |
| Opening local audio drain | 6,739 ms, after opening generation completion at 2,365 ms |
| Next scene render | None |
| Application recovery | One automatic `rejected-tool-only` continuation requested at 11,733 ms; started at 11,857 ms; cancelled by harness Stop at 12,211 ms |
| Completion | 0 completed scenes / 1 attempted; two scenes not reached |
| Paid harness retries | Zero |

The validator's rejection is application policy, not evidence that the actual
learner said "dog"; the committed synthetic fixture text says "duck". The
wire ASR repeatedly returned "dog". Whether this is a fixture intelligibility
issue, provider transcription behavior, or both needs separate investigation.
No prompts, audio fixtures or validation rules were changed to improve this run.
The harness stopped at the first genuine report blocker and did not wait for or
repeat the recovery's learner clarification request. It made two application
`response.create` requests (opening and automatic recovery); the ordinary VAD
answer response is provider-generated. Billing/usage totals are unavailable.

Timing deltas above use the application's monotonic decision timeline. Native
wire receipt timestamps use a separate local harness clock and are retained
without subtracting across clocks. Web Audio scheduling and source drain describe
local playback mechanics, not genuinely audible latency or physical display
latency. A walkthrough completing all three scenes is still needed to measure
classification/audio overlap, acknowledgment drain and exact next-scene renders
under real successful conditions.

## Architecture comparison

| Dimension | A: GPT-Live + Jev | B: Grok-only | C: Grok + Jev |
| --- | --- | --- | --- |
| Lesson completion evidence | Historical Oct 18: 3/3 correct scenes in one session | Historical Grok sessions blocked at scene 1; no new run | New session blocked at scene 1 before Jev; 2–3 unexecuted |
| Classification reliability | Historical three correct observer results; not evaluated on this acknowledgment-only corpus | Actual regex accepts 3/13 corpus positives | Real Jev accepts 13/13 corpus positives, no negative/ambiguous acceptance in this sample |
| False progression risk | Deterministic reducer gates; limited live negative evidence | Narrow grammar plus the same progression requirements | Broader semantic input plus the same learner/source/audio/render gates; small text corpus cannot establish a live false-progression rate |
| Latency evidence | Historical fixture-end → valid observer proposal: 3,439 / 3,414 / 4,481 ms, different boundary/workload | No classifier HTTP hop; historical blocked runs lack valid answer → render timing | Text-only Jev median 136 / p95 273 ms; successful voice acknowledgment → render latency remains unavailable |
| Recovery evidence | Existing baseline behavior, unchanged in this commit | Existing single continuation; historical failures retained | Same budget; new rejected-tool-only continuation was cancelled on the observed blocker, not an acknowledgment recovery |
| Operational complexity | Existing realtime provider + full conversation Jev observer | Grok plus deterministic acknowledgment grammar | Grok plus narrow Jev endpoint, deadlines, request cancellation, stale-result checks and diagnostics |
| Cost evidence | No verified billing comparison | No verified billing comparison | 32 text Jev requests and one Grok session observed; no verified usage/billing totals or monetary estimate |

**Recommendation:** further development of the opt-in Grok + Jev experiment is
warranted for acknowledgment coverage. Real Jev handles the demonstrated phrase
and the tested natural variations quickly, without observed false acceptance.
Keep 0.95 and the existing safety gates. Do not select an architecture winner or
claim production readiness: the voice path still blocks before acknowledgment
classification, and no live incorrect-input progression study was performed.

No second corrective commit was added here. A separately scoped investigation
and any resulting corrective commit for fixture/ASR/tool grounding are needed
before a successful bounded three-scene validation. The present sample does not
justify relaxing counting validation, changing prompts, or tuning the threshold.

## Reproduction and paid-call controls

Provider-free plan (no env files loaded, no network inference even if a key is set):

```sh
node scripts/grok-acknowledgment-benchmark.mjs
```

Live text evaluation requires the invoking environment to contain the key, both
execution flags, an explicit cap, and a **new** JSON output path:

```sh
node scripts/grok-acknowledgment-benchmark.mjs \
  --live --execute --max-requests 32 --out docs/evidence/NEW-acknowledgment-run.json
```

To explicitly use a local credential file, Node's `--env-file=.env.local` may be
supplied before the script path; the harness never loads it automatically. Do not
print the credential file. Missing credentials yield unavailable live metrics
and zero provider calls. The fixed dataset is validated before execution. Calls
are serial, bounded by five seconds and the explicit request cap, and never
retried. Existing evidence paths are rejected before any calls.

The dedicated walkthrough config is outside ordinary CI/browser/live-baseline
discovery. Run only with real keys in the invoking environment and an explicit
mode and **new** output file:

```sh
GROK_BENCHMARK_EXECUTE=1 GROK_BENCHMARK_MODE=grok-jev \
GROK_BENCHMARK_OUT=docs/evidence/NEW-grok-jev-walkthrough.json \
node node_modules/@playwright/test/cli.js test --config=playwright.grok-benchmark.config.ts
```

It permits one session, one fixture attempt per reached scene, zero Playwright
retries, a 150-second scenario timeout and a 180-second global bound. A genuine
blocker produces a failing live test and preserved sanitized evidence. The
Grok-only mode can be requested explicitly for a future separate comparison;
it was not run after this attempt's first blocker. A clean source copy with
provider keys supplied only to the dedicated process was used for this run.

## Validation

Provider-free checks passed: **290 focused Grok/Jev unit tests**, the full
**1,762-test suite in 74 files**, and **23 relevant browser tests**. The 29 new
benchmark regressions cover formatter/server validation for all three scenes,
dataset structure, probability/threshold boundaries, aggregation denominators,
latency statistics, execution/cap guards, missing credentials, timeout and
malformed output, deterministic regex comparison, evidence replay and correlated
walkthrough timing. Normal tests make no paid provider calls.

Typecheck, lint, formatting and production build passed in an isolated source
copy without the repository's ignored `test-results` review-source trees or local
environment files. All changed files were byte-compared with that validation
copy; `git diff --check` passed. The tool schema, authored lesson and shared
reducer were unchanged. The dedicated **actual-provider** walkthrough test
failed on the retained scene-1 blocker (one attempt); this is separate from the
23 passing provider-free browser checks. No paid rerun was used to turn it green.
