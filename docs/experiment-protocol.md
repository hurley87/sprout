# Seven-day experiment protocol

Use this protocol to evaluate the [Sprout MVP](sprout-mvp-prd.md). It is a small product experiment with one child and a supervising parent, not a study of educational effectiveness.

## 1. Before Day 1

Complete the MacBook-browser voice feasibility gate and the reviewed-evidence loop described in the [architecture](architecture.md). Record the browser/version and the application/model configuration used.

Prepare one child profile and use it throughout the run. Keep the initial learning scope at quantities 1–5. Record any implementation or prompt changes during the experiment so changes in behavior are not automatically attributed to memory.

Plan one lesson opportunity per day for seven days. The parent remains present throughout every session and can end it at any time. There is no expectation that the child must finish all activities or stay for five minutes.

## 2. Day 1: calibrate

Start with quantities 1–2 and sample other quantities as play and time permit. Use different objects or arrangements to avoid drawing conclusions from one response.

If the full range appears comfortably handled, pause the run and explicitly reconsider scope. Do not automatically add quantities or reinterpret an easy lesson as proof of useful adaptation.

If scope changes, document the new scope and begin a new seven-day run under the revised protocol. Keep prior attempts identifiable as calibration; do not silently combine incompatible runs.

An early end with limited evidence is not proof the range is too easy. Review what is available and retain uncertainty.

## 3. Daily procedure

1. **Before play:** Complete any pending analysis/review from the preceding session. Read today's target and its evidence-linked rationale. Day 1 uses the calibration plan.
2. **During play:** Observe without operating an assistance control. Help when needed; later mark affected observations as assisted. Let the child stop freely.
3. **After play:** Inspect the Observer's short summary. Accept, correct, or reject each proposal; expand the source exchange where useful.
4. **Evaluate:** Record willing participation, any useful adaptation actually delivered, and notable failures. Optional 1–5 ratings cover engagement, appropriateness, observation accuracy, and conversation quality.
5. **Prepare tomorrow:** Generate the next plan only after review is complete. Check that its explanation cites reviewed evidence.

Preserve the Observer's original proposals. Parent correction is expected as a safeguard, but frequent repair remains evidence of a weak Observer.

## 4. Counting rules

### Willing participation

The parent records yes/no for each planned day based on whether the child willingly took part in the activity. A child-requested early stop does not automatically negate earlier willing participation.

Count distinct days, not connection attempts. A declined or missed opportunity does not count as a participating day. Record technical failures separately so they remain visible when interpreting the result.

**Threshold:** At least five of the seven days.

### Useful adaptation

Count an adaptation only when:

- It occurs after the initial calibration session.
- It changes learning challenge, support, or practice based on an earlier reviewed observation.
- The source observation and delivered activity can be inspected.
- The parent judges the change useful after the session.

A favorite theme, the child's name, or a future plan alone does not qualify. If the session ends before the planned adjustment occurs, do not count it.

**Threshold:** At least three later sessions. With one planned daily lesson, count at most one qualifying session per day; retries cannot multiply the result.

### Observer acceptance

For every original learning proposal, record exactly one current review outcome:

- **Accepted unchanged:** The parent considers the proposed observation accurate without editing it.
- **Corrected:** The parent changes its content, behavior description, or support attribution.
- **Rejected:** The parent considers it unsupported or unusable.

Calculate:

```text
acceptance rate =
  original learning observations accepted unchanged
  / all original learning observations reviewed
```

The denominator includes accepted, corrected, and rejected proposals. It does not include purely conversational or engagement notes. Corrections do not create additional original proposals; regeneration or technical retries must not pad the counts.

**Threshold:** At least 80%. Report the numerator and denominator, not just the percentage. If no learning observations exist, the rate is undefined, not 100%. If any remain unreviewed, the final criterion is not yet evaluable.

This is parent acceptance of proposed learning observations, not objective ground truth or a calibrated measure of model accuracy.

## 5. Partial sessions and failures

A partial session can contribute valid reviewed evidence and can count as willing participation. It can qualify for useful adaptation if the relevant adjustment actually occurred.

Unanswered questions, pauses, unclear speech, and disrupted exchanges do not count as wrong answers. The saved record must distinguish completed exchanges from missing context.

After connection failure, show an explanation and preserve the record. Do not resume automatically. If the parent starts again, log a separate retry under the same day after the preceding record is analyzed and reviewed. A retry does not add another experiment day.

If analysis fails, the result remains pending. Retry processing the saved record rather than recreating the child's performance. Do not allow technical failures to disappear from the experiment report.

## 6. End-of-run report

Use a compact table:

| Day | Willingly participated? | Session duration / ending / retries | Useful adaptation delivered and evidence reference | Original observations: accepted / corrected / rejected / pending | Important failures |
| --- | --- | --- | --- | --- | --- |
| 1–7 | | | | | |

Then report:

- Participation days out of seven.
- Qualifying later sessions and the learning changes they actually delivered.
- Unchanged acceptances out of all reviewed original learning proposals, plus any pending proposals.
- Repeated problems with speech, interruptions, scenes, support attribution, parent repair, or quiz-like behavior.
- Whether later lessons were visibly more useful because of earlier evidence.
- Any changes to the application, prompts, models, or experiment scope during the run.

Do not obscure repeated problems with a passing aggregate. These thresholds guide a parent/builder decision; they are not an automatic product release gate.

## 7. Decision

**Promising:** All three thresholds are met and the examples support a credible learning-memory loop. Continue investigating longitudinal learning before expanding the product surface.

**Needs improvement:** The challenge was suitable and enough evidence was collected, but the thresholds or observed experience expose a weak loop. Address the identified failures before adding learning domains or users.

**Inconclusive:** The challenge was unsuitable, analysis/review is incomplete, or technical/data limitations prevent evaluating the loop. Explain the limitation, adjust the experiment explicitly, and rerun as appropriate.

Parent-reviewed success does not validate autonomous use. Testing with other families, unsupervised sessions, or broader curriculum remains a separate decision.
