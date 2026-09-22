# GPT-Live-1 baseline: test results and shortcomings

Findings for [issue #2](https://github.com/hurley87/sprout/issues/2), slice 1 (voice feasibility) of the [PRD build sequence](sprout-mvp-prd.md#9-build-sequence). The lesson uses `gpt-live-1` directly with client delegation for one capability, advancing through six fixed emoji scenes (quantities 1–5). No Jev or other control model is involved.

## Verdict

**The GPT-Live-only baseline is usable enough to continue, but it does not yet meet the slice 1 exit criterion.** Conversation quality is good: turns are short, one question at a time, interruption and topic changes are handled well, and scaffolding is gentle. Application-owned controls (parent stop, child stop, wrap-up, goodbye, hard limit, failure cleanup) are reliable because they do not depend on the model.

The weak point is **model-owned lesson control**: deciding when to advance the scene, keeping speech consistent with the displayed scene, and re-engaging after silence. These are the problems for the Jev exploration ticket (see [Problems for the Jev ticket](#problems-for-the-jev-ticket)).

None of this has been tested with a real child yet. That run is still required before the gate is met.

## How it was tested

1. **Automated control/state tests** (`npm test`, `npm run test:browser`): 44 unit tests for the session state machine, scene bounds, stop detection and the session endpoint; 6 Chromium tests with a real `getUserMedia` stream and a mocked provider transport, covering parent stop, fragmented child stop, connection failure, stop during permission prompt, wrap-up/goodbye timing, and missing configuration.
2. **Live synthetic matrix** (`npm run test:live`, [`scripts/live-matrix.mjs`](../scripts/live-matrix.mjs)): 31 sessions against the real `gpt-live-1` on 2026-09-22, headless Chromium 153. The "child" is macOS text-to-speech on a fixed timeline, fed in as a fake microphone, with every data-channel event and displayed scene logged.

The synthetic child is a clean adult voice that cannot react to Sprout. Transcription accuracy, preschool pronunciation, speaker echo, and real turn-taking are therefore **not** validated. Some "wrong" answers in multi-step scripts are artifacts of the fixed timeline drifting from the actual scene.

Three prompt versions were tried; `counting-baseline-2` is committed.

| Version | Change | Outcome |
| --- | --- | --- |
| 1 | Original | Often ended turns on praise alone, ignored wrong counts, asked vague "what do you notice?" questions. |
| 2 | Always end a turn with one counting question; address mismatched counts; scene context asks "How many can you count?" | Fixed all three. Kept. |
| 3 | Also "move forward after a correct answer" and "never mention unconfirmed scenes" | Much worse: 0 of 9 runs delegated, 7 of 9 narrated scenes never shown. Reverted. |

## Test matrix

Result is for prompt version 2 unless noted.

| Scenario | How tested | Result | Observed shortcomings |
| --- | --- | --- | --- |
| Long thinking pause | Live: "Ummm…", then ~35 s silence | Did not interrupt or pressure the child. | Never offered help during 35 s of silence, in any prompt version. |
| Quick answer | Live | Replied immediately and asked a follow-up. | Often asks the child to recount a correct answer instead of progressing. |
| Self-correction | Live: "Two? No, wait. One!" | Responded to the final answer ("one duck") in all versions. | None observed. |
| Child interruption | Live: child talks over the greeting | Stopped the greeting as soon as the child spoke ("Okay, go ahead"), acknowledged, and redirected to the scene. No overlapping speech. | Brief backchannels ("Okay,", "Oh,") during the child's sentence; once began "You counted…" just before the child answered. |
| Silence | Live, same as long pause | See long pause. | No re-engagement. Separately, in 3 of 31 sessions the greeting was delayed until the child made a sound (~11 s). |
| Off-topic | Live: dinosaur, then a request for a rocket story | Briefly acknowledged both and returned to counting. Never became a general chatbot. | None observed. |
| Incorrect answer | Live: "Five!" with one duck shown | No blunt correction; invited counting together. | In one run it then said "Now there are two ducks" **without requesting a scene**, so the screen still showed one. |
| Supported answer | Live: "I don't know" → modeled count → "One!" | Counted together or modeled, then praised the supported answer. | Tends to give the answer itself quickly ("one duck, can you say it with me?"). |
| Explicit stop | Live and automated: "I am all done…" | Transcript guard ended the lesson and stopped the mic within ~2.5 s of speech onset. | Stop is abrupt: the app ends before Sprout can say goodbye. The guard is regex-based and will miss phrasings it does not know. |
| Parent stop | Live (every run) and automated | Media stopped immediately; `session.closed` confirmed in ~0.7 s. Late model events are ignored. | None observed. |
| Time limit | Live: 5½-minute session, 2 runs; automated at 4:30 / 5:00 / 5:08 / 6:00 | Wrap-up sent 4:31; the model finished gently and declined "can we count more?". Goodbye sent 5:01, "Bye for now!" spoken, closed 5:09. Speech after goodbye did not restart play. | The 6:00 hard stop was only exercised in automated tests, because the graceful ending always came first. |
| Connection failure | Automated only (peer failure, provider error, unsolicited close, stalled startup, 502/503) | Ends the attempt, stops capture, and shows a parent-facing message plus "Start a new lesson". No reconnect. | A real network drop was not tested. |

### Scene advancement (repeat trials)

The same "progression" script, where the child counts correctly and asks for more, was run 4 times on version 2:

- **2 of 4** advanced cleanly: delegated, waited for the displayed scene, then asked about it.
- **1 of 4** refused to advance for 90 s ("let's stay with the 1 duck") despite "more ducks!".
- **1 of 4** never delegated and accepted "two ducks" while one was shown.

The 5½-minute run advanced three times, reaching scene 4 of 6. When delegation happened, speech and scene were well coordinated: the new scene was confirmed and mentioned within about a second.

## Problems for the Jev ticket

1. **Unreliable scene advancement.** Whether the model delegates varies from run to run with identical input, and small prompt changes swing it from "sometimes" to "never" (version 3).
2. **Speech/scene desync.** The model sometimes names quantities or objects that were never displayed, or accepts a count that contradicts the screen. The app ignores invalid actions but cannot stop the model from *saying* the wrong thing. Evidence records will need to flag these moments.
3. **No initiative after silence.** The model does not start speaking on its own after prolonged silence, so the "gently offer help" requirement is unmet. This likely needs an external trigger (an application or controller nudge), which conflicts with "GPT-Live owns pacing" and should be an explicit design decision.
4. **Pedagogical drift.** Recounting correct answers and quickly modeling the answer slow progression and reduce independent evidence. This may be tunable by prompt, but prompt changes also destabilized delegation (see 1).
5. **Occasionally deferred greeting.** In 3 of 31 sessions, the greeting instruction was not acted on until the child spoke.

## Other fixes made during testing

- The session endpoint's loopback guard compared the browser `Origin` against `request.url`, which Next.js normalizes to `localhost`. Every lesson started from `http://127.0.0.1:3000` (the URL `npm run dev` serves) was rejected. The guard now compares `Origin` with the `Host` header, which also rejects DNS-rebound hostnames.
- Two browser tests matched the Next.js route announcer as a second `alert`; they now scope to the page's main content.

## Still required before the gate

- A real parent-and-child session on a MacBook in Chrome, using built-in speakers (checks echo and self-hearing) and a real preschool voice, repeating this matrix where it can be done naturally.
- A real network drop mid-session.
- A decision on problems 1–3: prompt iteration, application nudges, or a Jev controller.
