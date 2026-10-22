# Issue #80: interpretation and renderer feasibility

Commit 1 experiment, October 22, 2026. Starting/parent SHA:
`982cad4ba68bcc8f33beb4560dc46d3e129fb8fc`. Issue:
https://github.com/hurley87/sprout/issues/80.

**Recommendation:** use an explicit server-side Responses interpretation adapter
with `gpt-6-luna`, then an ordered equation list with KaTeX. The existing voice
transport remains the conversation system. This commit adds only an opt-in CLI,
synthetic text fixtures, and a disposable renderer harness. No production route,
runtime, demo, dependency manifest, or root lockfile changes.

## Provider capability decision

The [GPT-Live model documentation](https://developers.openai.com/api/docs/models/gpt-live-1)
marks native structured outputs unsupported. The current
`lib/lesson-runtime/live-context.ts` configures no delegation backend or proposal
schema; its instructions explicitly deny tool/delegation authority. Therefore the
**current integration cannot yield a validated structured math proposal**. This
is not a claim that the platform cannot support such a workflow.

[Live delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation)
describes Responses/client delegation and backend tool execution; a backend model
is required for Responses delegation. Adding and synchronizing that workflow
would add lifecycle work beyond this spike. No Live session, delegation, tool
call, or real microphone was tested here.

The smaller proven mechanism is one server-only `POST /v1/responses`, using the
existing `OPENAI_API_KEY`, `store: false`, and strict `text.format` JSON Schema.
The [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
documents that request format and the need to handle refusals/incomplete output.
The [GPT-6 Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
documents structured output support. The actual calls below establish access for
this credential on this date. The returned model was exactly `gpt-6-luna`; this is
an alias, not an immutable snapshot, so future reproducibility includes model drift.
No hidden model substitution or retry is performed.

The existing `lib/jev.ts` pins `jev-1.14.0`, sends authored `noul` questions, and
accepts probabilities. That local contract is evidence of closed-choice
classification only, not arbitrary equation generation. Jev was not called or
changed; no undocumented generation API is assumed.

## Experimental contract and failure disposition

Input: problem label, board revision, existing logical step IDs/structured
expressions, and separate `{id, speaker, text}` turns. Expected answers and fixture
labels are never sent to the provider. Text is explicitly treated as data.

Output: exactly `{kind, target, expression, sources}`. `kind` is append, replace,
undo, clarify, strategy, help, or next. Only append/replace carry an expression;
only replace carries an existing target. Each source quotes an exact nonempty
learner substring with its turn ID. Local validation rejects tutor sources,
unknown keys, unsupported operators, invalid arity/targets, empty-board undo,
and more than 64 expression nodes / depth 12. Integer atoms are bounded to six
digits. The experimental AST has `{op,value,args}`: x/integers as leaves;
add/multiply are ordered n-ary, subtract/power binary, sin/cos unary. No eval,
solver, arbitrary LaTeX, normalization, mathematical correction, or answer key.
The renderer uses separately authored display strings; this spike does not yet
implement the production AST-to-LaTeX serializer.

The application derives source offsets from exact quotes. This establishes
fixture span membership only; a quote is **not** proof of semantic faithfulness
or live authority. Runtime/problem/visit/learner-revision/board-revision checks,
help attribution, multi-turn settlement, atomic action batches, and stale-result
suppression remain later plan commits. This experiment proposes a single action,
not a general math contract. It is not imported by the application.

A 30-second deadline or SIGINT/SIGTERM aborts local fetch; pre-aborted operations
send nothing and post-response cancellation discards the result. Cancellation
does not guarantee provider computation/billing stops. HTTP failure, refusal,
incomplete status/model mismatch, malformed JSON, and failed structural/source
validation produce a non-mutating disposition. No fallback guesses an expression.
Provider bodies/errors/credentials are not logged. The CLI saves only validated
proposals from these synthetic fixtures and token usage; ignored local output
must not be generalized to sensitive learner transcripts.

## Actual provider text experiment

Command (explicitly loads existing local credentials in Node, never in a shell
substitution or browser):

```sh
node --env-file=.env.local scripts/issue-80-feasibility.mjs --network
```

One serial call per fixture, at most 17 calls, no retry. Actual run ended
`2026-10-22T19:13:24.181Z` (15:13 Toronto). **17/17** returned structurally valid,
source-valid, faithful proposals matching independently authored expectations.
All sources cited learner `u1`; no tutor source was accepted. Exact half-open
character offsets within that fixture turn are recorded below (quotes are recovered
by slicing the retained fixture). Each case was run once; this is a small feasibility
sample, not an accuracy estimate or a false-commit guarantee.

| Case | Actual kind | Target | Faithful | Request ms | Input/output tokens |
| --- | --- | --- | --- | ---: | ---: |
| power-complete | append | — | yes | 5050 | 486/194 |
| product-complete | append | — | yes | 3831 | 489/262 |
| chain-complete | append | — | yes | 5509 | 495/340 |
| strategy-only | strategy | — | yes | 2072 | 482/70 |
| missing-operand | clarify | — | yes | 3046 | 484/101 |
| ambiguous-sine-sign | clarify | — | yes | 3993 | 494/83 |
| ambiguous-power | clarify | — | yes | 2194 | 490/80 |
| wrong-sign | append | — | yes | 2842 | 489/280 |
| replace-complete | replace | s1 | yes | 2731 | 642/267 |
| replace-term | replace | s1 | yes | 2930 | 638/230 |
| undo | undo | — | yes | 2476 | 630/72 |
| undo-empty | clarify | — | yes | 1500 | 480/79 |
| tutor-answer-not-learner | strategy | — | yes | 1193 | 510/65 |
| help | help | — | yes | 2173 | 487/65 |
| next | next | — | yes | 3114 | 481/80 |
| unsupported | clarify | — | yes | 2307 | 487/78 |
| misleading-reasoning | append | — | yes | 2739 | 495/262 |

Exact expression outputs, losslessly compacted as `op(args...)`, with leaves
`number:value` or `variable:x` (all operator values are null). Null expressions
are required for every other result in the table:

```text
power-complete: subtract(multiply(number:3,power(variable:x,number:2)),number:4)
product-complete: add(multiply(number:2,variable:x,sin(variable:x)),multiply(power(variable:x,number:2),cos(variable:x)))
chain-complete: multiply(number:5,power(add(multiply(number:3,power(variable:x,number:2)),number:1),number:4),number:6,variable:x)
wrong-sign: subtract(multiply(number:2,variable:x,sin(variable:x)),multiply(power(variable:x,number:2),cos(variable:x)))
replace-complete: add(multiply(number:2,variable:x,sin(variable:x)),multiply(power(variable:x,number:2),cos(variable:x)))
replace-term: subtract(multiply(number:2,variable:x,sin(variable:x)),multiply(power(variable:x,number:2),sin(variable:x)))
misleading-reasoning: add(multiply(number:2,variable:x,sin(variable:x)),multiply(power(variable:x,number:2),cos(variable:x)))
```

The minus in `wrong-sign` stayed minus. `replace-term` changed only the requested
cosine to sine and kept the existing minus. `misleading-reasoning` supplied the
correct product expression while calling the method “chain rule”: faithful
extraction is a pass, while that reasoning claim is not thereby correct. No
proposal was graded for mathematical correctness or learner independence. The
strategy-only/tutor-answer cases did not generate the tutor's derivative;
missing operands, ambiguous speech text, and unsupported Bessel notation clarified.

Request latency: min **1,193 ms**, median **2,739 ms**, nearest-rank p95/max
**5,509 ms**, n=17. These are serial HTTP-start-to-response-header measurements,
not speech-end-to-display or tutor latency; body parse/validation/display are
excluded. Total reported input **8,759**, output **2,608**, cached input **0**
tokens. The API did not return billed dollars; actual dollar cost was not
measured. No latency acceptance threshold was agreed, and seconds of extraction
latency remain a material product concern.

Run fixture SHA256:
`064d52fa04f537e36d58493936471e9931cec08db24415549abfee208365b277`.
Run harness SHA256 before formatting:
`92491e26cd94f9e781a7b634127531c776b08e2b883098882ea96c7563c1c280`.
Subsequent harness edits were renderer preparation/formatting only; the network
instructions, request schema, and interpreter are unchanged. Raw synthetic report
is local/ignored at `test-results/issue-80/provider-1792696404183.json`; the table
and expression outputs above retain its substantive results.

### Exact source locators

```text
power-complete: u1[18:45]
product-complete: u1[0:49]
chain-complete: u1[0:87]
strategy-only: u1[0:21]
missing-operand: u1[0:24]
ambiguous-sine-sign: u1[0:62]
ambiguous-power: u1[0:43]
wrong-sign: u1[0:50]
replace-complete: u1[0:77]
replace-term: u1[0:59]
undo: u1[4:13]
undo-empty: u1[0:10]
tutor-answer-not-learner: u1[0:21]
help: u1[12:30]
next: u1[0:18]
unsupported: u1[0:43]
misleading-reasoning: u1[23:71]
```

## Offline checks are separate evidence

```sh
node scripts/issue-80-feasibility.mjs --self-test
```

Pass: 17 fixture contracts, 17 forged-source rejections, 17 extra-field
rejections, malformed expression rejection, pre-request and post-response abort,
and non-mutating HTTP 403. These use constructed expectations and mocked
transport. They verify harness mechanics, not provider accuracy, network timeout,
real speech recognition, mathematical correctness, or live runtime races.

## Reproducible renderer experiment

Read installed Next 16.3.5's
`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
before writing code. The spike intentionally uses standalone Vite/React; a future
interactive Next renderer needs a client boundary.

```sh
node scripts/issue-80-feasibility.mjs --prepare-renderer
npm install --prefix test-results/issue-80-renderer --no-audit --no-fund
node scripts/issue-80-feasibility.mjs --serve-renderer
```

Open `http://127.0.0.1:4180/`. Select Show list / Show tldraw; append the wrong
sign, replace it, undo, append the long line, and trigger render failure. Both
surfaces read the same logical steps/history. Undo restores the predecessor of a
replacement. Canvas history never owns logical state. The stress line deliberately
combines terms from different problems to test width, not mathematical correctness.
Use `/?narrow` for a 390px outer content container (350px content + 40px padding),
not a simulated mobile device. Restart the server after preparing changed assets:
Vite's cached transforms did not reliably refresh inside this ignored directory.

Versions observed: Node **22.17.0**, npm **10.9.2**, Next **16.3.5**, React and
React DOM **19.2.8**, tldraw and `@tldraw/editor` **5.5.2**, KaTeX **0.19.0**,
Vite **7.3.1**. These exact direct versions are generated into the ignored sandbox
manifest. Installation added 165 packages; npm warned that transitive
`lodash.isequal@4.5.0` is deprecated. No root installation or package edits.
A sandbox lockfile records the tested transitive tree locally; it is not retained,
so future transitive resolution can drift.

The [tldraw custom-shape example](https://tldraw.dev/examples/custom-shape)
documents ShapeUtil/HTMLContainer and schema registration; BaseBoxShapeUtil
supplies the rectangle geometry for this minimal equation shape. The harness
projects create/update/delete operations into read-only shapes, temporarily
allowing programmatic updates in one synchronous editor transaction. Both
candidates render through the same KaTeX options.

[KaTeX options](https://katex.org/docs/options) document HTML plus MathML output
and line-breaking behavior. This experiment uses `htmlAndMathml`, visible plain
text, `throwOnError: true`, and an explicit fallback. Its
[security guidance](https://katex.org/docs/security) motivates `trust: false` and
bounded macro expansion. Production should generate LaTeX only from validated AST.

### Visual and accessibility observations

Inspected in the in-app browser at a 678×892 viewport, plus a 390px content
container; an earlier 1280×720 view was also inspected. No microphone involved.

| Check | Ordered list + KaTeX | tldraw custom equation + KaTeX |
| --- | --- | --- |
| Three authored prompts | Superscripts, grouping, sine and minus faithful | Same glyph fidelity |
| Append wrong sign | Minus visibly retained | Minus visibly retained |
| Replace then undo | Plus replaces minus; keyboard Tab/Enter on Undo restores minus | Plus replaces minus; Undo restores minus |
| Long line | Normal-size text, local horizontal overflow | Fits all shapes by shrinking camera zoom |
| Narrow container | 292px equation area; wrong line scroll width 338px, long line 548px; readable text wraps | Full equations fit but text becomes very small |
| Render error | Explicit “Equation unavailable” text; no injected error HTML | Same fallback, but small when zoomed out |
| Semantics | Ordered list/list markers, MathML in DOM, visible text, polite update region | MathML/text in DOM, but canvas accessibility order observed chain/power/product rather than logical step order |
| Controls | Native buttons; visible focus; keyboard undo verified | Shared buttons; canvas navigation adds another interaction surface |
| Integration | React list projection and overflow policy | Shape schema, IDs, editor lifecycle, read-only mutation coordination, geometry, viewport/camera and culling |

An early two-surfaces-stacked version produced culled/blank shapes when the canvas
was below the fold. Initial read-only mode also blocked later programmatic edits.
The retained harness switches surfaces into the same viewport and refreshes
viewport bounds/fit on scroll/resize; its editor transaction restores read-only
mode after projection. These are experiment findings, not proof that every
embedded canvas layout is fixed. The list needs neither mechanism.

This is a DOM/accessibility-tree inspection and keyboard-control smoke test,
**not a screen-reader audit**. Production still needs a single understandable
math reading path (avoid duplicate spoken text), focusable horizontal scrolling,
logical correction/history announcements, and real assistive-technology testing.
Neither candidate has established display-ack timing; the experiment does not
claim React update completion proves paint.

### Dependencies, license, and recommendation

Current npm metadata: tldraw 5.5.2 has React peers `^18.2.0 || ^19.2.1`, compatible
with this repo. Its package license is `SEE LICENSE IN LICENSE.md`; unpacked
package size is 15,244,188 bytes. KaTeX 0.19.0 is MIT, 4,043,696 unpacked bytes.
Unpacked sizes include assets and are **not browser transfer measurements**.

The [current tldraw license documentation](https://tldraw.dev/community/license)
allows development use and requires an active production license key, with
trial/commercial/hobby options. No production license was obtained or assumed.
KaTeX's [repository license](https://github.com/KaTeX/KaTeX/blob/main/LICENSE)
is MIT. Keep its copyright/license notice and shipped font licenses when used.

Choose the **equation list** for the three-problem POC. It offers the same math
fidelity with clearer reading order and fewer lifecycle/dependency/licensing
obligations. The spike established no spatial/freehand requirement that justifies
an infinite canvas. Add KaTeX only in the planned presentation commit after review;
revisit tldraw if authored spatial diagrams become a concrete requirement.

## Verification and boundaries

Commands and results:

- `node scripts/issue-80-feasibility.mjs --self-test`: pass; constructed fixture and mocked transport checks described above.
- `node --env-file=.env.local scripts/issue-80-feasibility.mjs --network`: pass, 17 actual requests; no retry or fallback.
- `npm run lint` in the working checkout: fails, 759 errors / 10,594 warnings, including ignored historical app/build copies under `test-results/commit3-review` and `test-results/ui-review`. Those copies were preserved.
- `npm run typecheck` in the working checkout: fails on 16 diagnostics in those historical copies (missing old modules, stale component types, implicit-any parameters). The chained build consequently did not run there.
- Fresh disposable copy of `git archive 982cad4` plus only these experiment sources: `npm run lint` and `npm run typecheck` pass. Its first build with an external `node_modules` symlink failed Turbopack's filesystem-root restriction. Replacing only that disposable symlink with `npm ci --no-audit --no-fund`, then `npm run build`, passes: all existing routes build and no calculus route is added.
- Separate Vite production build of the renderer sandbox: passes, 857 modules. Combined comparison JS chunk 2,190.94 kB (666.99 kB gzip) and CSS 109.18 kB (23.11 kB gzip), plus fonts and a small SVG helper. This imports both candidates, not a measured list-only comparison. Expected ignored `use client` directive and >500 kB chunk warnings; no production tldraw license/public deployment tested.
- Browser observations: manual append/replace/undo on each candidate, long line, unsupported LaTeX, narrow container, accessible text/tree and keyboard undo verified as described above.
- `git diff --check`, `git diff --cached --check`, explicit five-file allowlist, staged diff review, and scan against existing local secret values: pass. No production files or credentials staged.

Clean-copy verification preserves the existing ignored workspace artifacts instead
of changing unrelated lint/TypeScript configuration. It verifies this commit's
source compiles; the working checkout's broad commands remain obstructed by those
copies. Full application unit/browser regression and real microphone acceptance
are not claimed for an isolated experiment with no runtime changes.

Outstanding: real microphone transcription and ambiguity handling; repeated runs
and adversarial prompt injection; multi-turn/multi-action extraction; authenticated
runtime/visit/revision checks; deterministic math validation and reasoning/help
provenance; paint acknowledgment and speech-to-display timing; full screen-reader
and actual mobile viewport testing; Bill's review. No issue-completion claim.
The existing untracked implementation plan is preserved outside this commit.
Stop after this commit for **Approve**, **Request changes**, or **Abort**.
