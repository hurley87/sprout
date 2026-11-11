# Garden Rescue playtest protocol

Use the existing prototype environment described in [browser tests](browser-tests.md), with GPT-Live and Jev configured securely on the server. Do not add credentials to notes or exports. Start the local app, open `/games/garden?debug=1`, allow a real microphone, and use speakers or headphones. A developer or parent first completes an adult real-mic run, including a wrong answer, correction and request for help. Then, where feasible, invite a preschooler to play while their parent observes. Let the child lead; stop whenever they want. Note device, date, environment and whether each run was performed. Label every untested item **not performed**.

Obtain the parent's consent and the child's assent before starting. Explain that speech is sent to the configured live providers during play. The debug export contains conversation text and timing, though not raw audio. Keep notes and exports on the device; no recordings leave the device unless the parent agrees. Avoid names or identifying details, and agree on retention and deletion before sharing anything.

## Observation sheet

Complete separately for the adult and child runs. Record observations and examples, not guesses about intent.

- Run type, date, device, environment, consent and status (performed / not performed):
- Wanted to start, continue and replay? What did they say or do?
- Moments that felt game-like or quiz-like:
- Confusion about what to count, including background objects:
- Dead air, awkward repeats, perceived latency, misrecognition or failed corrections (when and what happened):
- Hints offered and parent intervention (what, when and why):
- Rewards and world effects: did they arrive at the right time?
- Fresh transfer challenge: what was attempted, with what help, and what does that observation actually support? A single response is not proof of independent mastery.
- Qualitative comparison with the garden lesson at `/` (including whether that comparison was performed):
- Other observations, technical problems and follow-up:

If consent permits, export diagnostics from the debug panel and keep them with the local notes. Mark missing or incomplete exports and timing observations as not performed. Small playtests are not population-level evidence of learning; distinguish observed behavior from interpretation.
