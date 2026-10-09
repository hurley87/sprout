# Completed-exchange coordination

The `0b4da0e9-1afa-406f-86e4-8a6f75d18f67` Catching Unicorns export
shows two related delays. Times below are export `atMs` divided by 1,000.

- In Exographics, confirmed microphone speech without matching new text revoked
  current-turn transcript eligibility. Later discarded candidates did not restore
  that eligibility. Tutor text ended with “We can move on if you're ready” at
  197.618, but stabilization could not classify the visit-local exchange. “Yep”
  arrived at 200.688; its child snapshot received an acknowledging proposal at
  201.258, which could not authorize tutor closure because the current snapshot
  speaker was child. Semantic recovery followed at 205.260. The explicit learner
  request and subsequent tutor audio ultimately advanced at 215.274.
- In CAF application, missing-text microphone turns similarly blocked tutor
  stabilization. Tutor closure text completed at 563.538 and output became quiet
  at 564.391. Recovery enabled a closure recheck at 568.393, after four seconds
  of quiet. New microphone activity at 568.618 cancelled it. Another turn ended
  at 570.023, followed by another four-second wait. A successful proposal at
  574.512 preceded rendering at 574.564.

The fix lets an interrupted exchange with observed tutor output reach the existing
600 ms transcript stability / 500 ms output quiet boundary. At that boundary,
the runtime requests closure-only eligibility through the existing reducer event
and captures a fresh classifier source. Missing current-turn words still cannot
grant mastery. New speech, new text, visit changes, and resumed output retain
their cancellation and drain behavior. Explicit learner navigation keeps its own
debounce. Held or failed checks retain bounded missing-answer recovery.

`tests/fixtures/completed-exchange-coordination.json` projects the final answer
onset through the final tutor quiet observation for each exchange, using the
original microphone/output events and transcript deltas derived from successive
snapshots. `offsetMs` converts fixture-relative time back to export time. Earlier
conversation and the later recovery interval are intentionally omitted. These
fixtures contain data, not instructions.

Replay classifiers are deterministic doubles that acknowledge complete closure
text, including the readiness sentence. They verify scheduling, stale-response
rejection, output drain, and unchanged mastery; they do not establish how a live
classifier will interpret that earlier readiness sentence or measure live pacing.
