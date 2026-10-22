# Pinned reducer for issue 77

`reducer.ts` is **actual pre-instrumentation source**, extracted with:

```sh
git show 16120943cd821749dbca025d4456f53bf4c01968:lib/lesson-runtime/lesson-runtime-reducer.ts
```

Original SHA-256: `4c6cfad2942257e8e9652d3423609d34dc6ef7639b781c5bc6d303e622267b04`.
Only a provenance comment and relative import relocation were added. Preserve its
original formatting; the provenance test reverses those edits and verifies bytes.
The six dependency hashes were extracted from the same commit in
`dependencies.json`. The proposal parser now has an actual historical copy in
`proposal-parser.ts` because the live counting parser adds explicit commitment.
The parser and lesson-definition, tutor-observation, conversation-progression,
and concept-evidence helpers are frozen historical copies. References to the
parser use its fixture name; reversing that rename reproduces the original hashes.
Only events remain shared and hash-pinned. The historical reducer uses these
frozen helpers so MAE386 changes cannot silently alter its behavior.
There is no second application tree, provider, baseline build or Git dependency at
test execution time. A deliberate change to those dependencies requires revisiting
the baseline harness rather than silently comparing against changed semantics.

All frozen dependency bytes remain hash-pinned after reversing the parser rename.
For inputs enabling that policy, the guard explicitly compares the current
confirmation-based path with the historical reducer on the same input state.
The new counting-only `answerCommitment` proposal field is omitted from that
legacy projection, whose original parser rejects unknown fields.
The new policy intentionally differs and is verified by direct policy tests,
not by claiming historical equivalence.

Run `npx vitest run --config vitest.tracking-replay.config.ts` to replay the
unit suite with the differential guard. MAE386 lesson initialization/reductions
and its new `question.observation` event have no historical counterpart and are
excluded from the comparison; their ordinary regression assertions still run. The setup mock delegates to the **actual
current reducer** and invokes the pinned reducer on identical state/event/lesson
inputs for the legacy projection, comparing full resulting state, ordered effects, and whether the state
object was returned unchanged. Initialization is compared too. This gives an
inductive comparison across each test's event stream; tests that begin from recorded
or synthetic intermediate states compare from that shared checkpoint. Only new
`proposalConsumption` result metadata is excluded; no state/effect field is removed.
Existing semantic, render and orchestration assertions still run. The ordinary unit
command remains unchanged and can run without the differential guard.

`tests/tracking-runtime-replay.test.ts` independently executes the real runtime
with journal tracking methods enabled versus test-only no-op spies and the optional
playback sink attached versus absent. Both runs receive identical provider events,
classifier responses and fake timers. Full nontracking diagnostics, final runtime
snapshot, ordered HTTP request bodies/timestamps, cancellation indexes, all outbound
commands, close count, render identities/effects and steering are compared. Only
tracking records and snapshot observation projections/recent diagnostics are
excluded. UUID and wall clock are fixed identically. This compares tracking-on/off
orchestration, **not** two historical runtime implementations; the pinned reducer
comparison supplies the historical behavior check. It does not run the real
BrowserTransport; transport callbacks are synthetic and the browser checks cover
actual transport separately.

The saved butterfly `incoming` provider fragments/order/intervals and saved final
classifier outputs are reused. The first two authored visits, their classifier
responses and media signals are synthetic setup. Local timer execution reconstructs
the schedule; it does not recreate ASR/network jitter. Other new runtime cases are
entirely synthetic. No new fixtures purport to be recorded sessions.
