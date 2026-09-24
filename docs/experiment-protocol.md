# Seven-day experiment protocol

Use this protocol to run the [Sprout MVP](sprout-mvp-prd.md). It is a small product experiment with one child and a parent who is also the builder, not a study of educational effectiveness. The PRD's [success signals](sprout-mvp-prd.md#7-success-signals) inform the builder's own judgment; they are not an automatic gate.

## 1. Before Day 1

Complete the MacBook-browser voice feasibility gate and the reviewed-evidence loop described in the [architecture](architecture.md). Record the browser/version and the application/model configuration used.

Prepare one child profile and use it throughout the run. Plan one lesson opportunity per calendar day for seven days. If a day is missed or declined, the pending plan carries over to the next session.

## 2. Day 1 and daily adjustments

Day 1 follows the PRD's [calibration](sprout-mvp-prd.md#day-1-calibration). After any day, the builder may adjust scope, difficulty, prompts, or code. Log each change in a short daily note so behavior changes are not automatically attributed to memory. The run continues; no restart is required.

An early end with limited evidence is not proof the range is too easy or too hard. Review what is available and retain uncertainty.

## 3. Daily procedure

1. **Before play:** Complete any pending analysis/review from the preceding session. Read today's target and its evidence-linked rationale.
2. **During play:** Help when needed; later mark affected observations as assisted and note any pointing or touch-counting. Let the child stop freely.
3. **After play:** Review each proposal, playing the session recording from the observation's timestamp where useful.
4. **Evaluate:** Record willing participation, any useful adaptation actually delivered, the day's parent repair level, notable failures, and any code or prompt changes.
5. **Prepare tomorrow:** Generate the next plan after review is complete and check that its explanation cites reviewed evidence.

## 4. Recording the signals

### Willing participation

Record yes/no for each calendar day based on whether the child willingly took part. A child-requested early stop does not automatically negate earlier willing participation. Count distinct days, not connection attempts, and record technical failures separately.

### Useful adaptation

Count an adaptation only when all of these hold:

- It occurs after Day 1 calibration.
- It changes the target, challenge, or support because of an earlier reviewed observation.
- There is a clear answer to: “What would this lesson have done differently if the referenced observation did not exist?” The planner's rationale should state it; see the PRD's [examples](sprout-mvp-prd.md#7-success-signals).
- It was actually delivered, not merely planned.
- The parent judges it useful.

A favorite theme, the child's name, or a changed activity or theme with the same target, challenge, and support does not qualify. Count at most one per day; retries cannot multiply the result.

### Parent repair

After each review, record the day's repair level with a one-line note:

- **Verified:** Observations accepted as proposed.
- **Light correction:** Small contextual corrections, such as help or pointing the system could not detect.
- **Substantial repair:** The parent rewrote what the child did, reconstructed an exchange, or supplied learning evidence the Observer missed.

This is a judgment, not a score. Routine substantial repair means the loop is weak even if adaptations built on the corrected evidence were useful.

### Observer acceptance (informal)

Tally each day's original proposals as accepted unchanged, corrected, or rejected. This is a rough read on Observer quality, not a threshold.

### Conversation-quality diagnostics

The optional conversation-quality rating is not sufficient by itself. Record concrete examples when they occur, including:

- false interruptions or child speech cut off while still thinking/continuing;
- premature correctness praise/correction before the child has settled;
- noticeable dead air after a clearly completed turn;
- repeated re-prompts or unnecessary hint escalation;
- self-corrections that were accepted or cut off;
- child-initiated questions or off-topic comments and whether Sprout acknowledged and recovered naturally;
- interactions that became rigid or quiz-like rather than conversational.

These are diagnostic observations for this prototype, not calibrated model scores. Preserve enough session reference/timing context to inspect recurring failures later.

## 5. Partial sessions and failures

A partial session can contribute reviewed evidence, count as willing participation, and qualify as a useful adaptation if the adjustment actually occurred. Behavior on disconnects, retries, and failed analysis follows the [session lifecycle](architecture.md#3-session-lifecycle) and [review rules](architecture.md#5-observation-and-review-rules). A retry does not add another experiment day. Do not let technical failures disappear from the report.

## 6. End-of-run report

| Day | Willingly participated? | Duration / ending / retries | Useful adaptation delivered and evidence reference | Proposals: accepted / corrected / rejected | Parent repair level and note | Changes made | Important failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1–7 | | | | | | | |

Then note:

- Participation days out of seven and qualifying adaptations.
- How much parent repair the run required: the number of days at each repair level, and whether any qualifying adaptation relied on substantially repaired evidence.
- Repeated problems with speech, interruptions, scenes, support attribution, or quiz-like behavior.
- Whether later lessons were visibly more useful because of earlier evidence.

## 7. Decision

Parent review should primarily verify or lightly correct Sprout's observations rather than reconstructing what happened. If substantial parent repair is routinely required, the learning-memory loop should not be considered promising even if later adaptations based on corrected evidence are useful.

**Promising:** The examples support a credible learning-memory loop, and parent review mostly verified or lightly corrected the Observer. Continue investigating longitudinal learning before expanding the product surface.

**Needs improvement:** The challenge was suitable, but the experience exposes a weak loop, including routine substantial parent repair. Address the identified failures before adding learning domains or users.

**Inconclusive:** The challenge was unsuitable or technical limitations prevented evaluating the loop. Adjust and rerun as appropriate.

Parent-reviewed success does not validate autonomous use. Testing with other families, unsupervised sessions, or broader curriculum remains a separate decision.
