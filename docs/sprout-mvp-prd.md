# Sprout MVP

| | Scope |
| --- | --- |
| Status | Agreed prototype scope |
| Participant | One preschool-aged child, approximately 3–5, with their parent present throughout |
| Experiment | One planned five-minute session per day for seven days |
| Initial surface | Browser on a MacBook |
| Learning scope | Counting quantities 1–5 |

## 1. Purpose

Sprout is a short, playful voice learning companion. Its defining capability is using accurate evidence from earlier sessions to make later lessons more useful.

The MVP asks:

> Does Sprout learn enough about this child to make later lessons clearly better?

A favorite theme or the child's name can support engagement, but does not establish that the learning-memory loop works. A useful adaptation revisits a difficulty, adjusts help, or changes the challenge based on a specific prior observation the parent considers accurate.

This is a private, supervised experiment for the builder's own child. It does not attempt to prove educational improvement in seven days or support other families independently.

## 2. Core loop

> Plan → Play → Observe → Parent review → Remember → Adapt tomorrow

1. Prepare a bounded counting lesson.
2. Conduct a voice conversation with supporting emoji scenes.
3. Extract proposed observations from the session record.
4. Let the parent accept, correct, or reject those observations.
5. Make reviewed evidence available to the learning profile.
6. Generate the next lesson with an explanation linked to that evidence.

Parent review is required before the next daily lesson uses the session's observations. Pending observations cannot enter the learning profile or influence a future plan. The first lesson uses a calibration plan.

See the [architecture and evidence flow](architecture.md), [experiment protocol](experiment-protocol.md), and [domain glossary](../CONTEXT.md).

## 3. Learning boundary

Teach and revisit quantities 1–5 through different objects, arrangements, and playful stories. Defer more/less, big/small, sequencing, prediction, cause-and-effect, and broader curriculum coverage.

Distinguish observable behaviors:

| Behavior | What Sprout can record |
| --- | --- |
| Quantity identification | The child gave the correct total for the displayed group. |
| Counting aloud with a total | The child said a count sequence and gave the correct total. |
| Independent response | No help was given in the exchange and none was reported by the parent. |
| Supported response | The response followed a hint, choice, modeled answer, or reported parent help. |
| Uncertain evidence | Speech, attribution, scene context, or the exchange was too unclear to support a conclusion. |

A correct total alone does not establish how the child reached it. Spoken counting does not establish that each object was tracked individually. A single successful attempt does not establish consistent understanding; later lessons revisit the quantity with different objects or arrangements.

Sprout cannot see pointing or touch-counting. The parent can add that context during review.

The learning profile is a history of concrete observations and corrections. Do not assign mastery or developmental labels such as “emerging,” “developing,” or “consistent.”

### Day 1 calibration

Begin playfully with quantities 1–2, then sample the remaining range as the child's responses and available time permit. Do not force completion of all examples.

If the range proves too easy or too hard, the builder adjusts scope or difficulty in code after that day. Sprout must not change its learning scope on its own. An unsuitable challenge is not evidence that the memory loop failed.

## 4. Lesson experience

Each lesson has three parts:

1. **Warm-up:** A previously comfortable quantity; start with 1–2 on Day 1.
2. **Main activity:** One target quantity selected from reviewed evidence, with help as needed.
3. **Fresh example:** The target quantity in a different setting, initially without help.

The structure guides the lesson; finishing every part is optional. An initially unassisted fresh example does not make earlier help irrelevant. Preserve that context in the observation.

Use short sentences, one question at a time, and time for thinking. Tolerate hesitations, interruptions, self-corrections, and incomplete speech. Offer hints, choices, counting together, or a modeled example when helpful.

If the child changes the subject, briefly acknowledge it and incorporate the new theme into counting where practical. Keep the learning objective bounded. If the child repeatedly declines, offer to finish. An explicit request to stop ends the activity.

### Visuals and controls

- The child responds by voice. Taps and pointing are not answer inputs.
- Render simple, deterministic emoji scenes with React.
- Use a minimal character with conversational expressions; defer elaborate animation.
- Keep the child view free of navigation, transcripts, lesson titles, scores, grades, and streak pressure.
- Keep a parent end-session control available.
- Do not generate JSX, illustrations, or images during a lesson.

### Timing and stopping

- Aim for five minutes from the start of the live lesson.
- Begin wrapping up around 4½ minutes.
- End within six minutes, including any goodbye.
- A child or parent request to stop triggers an immediate end to the activity and a brief goodbye when the connection permits.
- Release the microphone and stop playback when the session ends.

A connection failure ends the session and shows the parent a short explanation. Preserve completed exchanges for review. Automatic reconnection and mid-lesson resume are out of scope; the parent may explicitly start a new session when service is available.

## 5. Evidence and parent review

Retain the session audio and transcript together with displayed scenes and help provided by Sprout. Each learning observation must link to the relevant exchange so the parent can inspect, and replay, what was said and shown.

Do not treat generated but unspoken answers, unshown scenes, silence, or disrupted exchanges as observed child performance.

Short or interrupted sessions can contribute valid observations from completed exchanges. Record their duration and ending reason without treating the interruption itself as a wrong answer.

The parent summary supports:

- Accepting accurate observations, including a one-tap acceptance of an unchanged summary.
- Correcting an observation, including marking a response as assisted.
- Rejecting an unsupported observation.
- Expanding the supporting audio, transcript, scene, and help context.

There is no live “I helped” control. Preserve the Observer's original proposal separately from the parent's decision and corrected version.

The parent reviews observations; they do not manually author the next lesson or assign skill states.

## 6. Parent experience

Keep two main views:

**Today:** Start the current lesson; see its target and, after Day 1, a one-sentence explanation linked to reviewed evidence. After the session, review a short summary and supporting observations. Generate the next lesson preview after review is complete.

**History:** Show the seven-day experiment's sessions, themes, targets, endings, and reviewed observations. Partial sessions and technical retries remain identifiable.

Collect a brief daily evaluation: willingness to participate, whether an evidence-based adaptation actually happened and was useful, and notable conversation or evidence failures. Optional 1–5 ratings cover engagement, appropriateness, observation accuracy, and conversation quality.

While analysis or review is pending, show that state explicitly. Do not imply that tomorrow's lesson is ready.

## 7. Success signals

The builder, who is also the parent, decides whether the idea merits continued investment. Two signals guide that judgment:

| Signal | Guide |
| --- | --- |
| Willing participation | The child willingly participates on at least five of seven days. |
| Useful adaptation | At least three later sessions make an adjustment based on earlier reviewed evidence that the parent judges useful. |

Observer acceptance (the share of proposals accepted without correction) is tracked as an informal signal of Observer quality, not a pass/fail criterion.

These are prototype guides, not evidence of academic improvement or calibrated model accuracy. The [experiment protocol](experiment-protocol.md) defines how to record them.

Inspect important failures alongside these signals: repeated interruptions, unreliable transcripts, incorrect scenes, unsupported claims, quiz-like interactions, substantial parent repair, or adaptations that were planned but never delivered.

If the challenge is suitable but the loop is weak, improve it before broadening the product. If the scope is unsuitable or evidence is insufficient, report an inconclusive experiment instead of claiming success or failure.

## 8. Product boundaries

The parent owns the profile, starts sessions, reviews observations, and remains present. The child is not expected to navigate independently.

Sprout must not diagnose developmental, speech, or learning conditions; label the child as “behind”; claim clinical authority; encourage secrecy; or position itself as a replacement for parents or teachers. It must not expose an unrestricted general-purpose chatbot.

Run the prototype locally on the builder's MacBook rather than as a public deployment, so no user accounts or access control are needed. Provider credentials stay on the server.

Deletion features are explicitly deferred for this prototype, including both whole-experiment and individual-session deletion. All session data, including audio, is kept for the builder's review. To wipe it manually, clear the Convex tables and file storage from the Convex dashboard.

Other non-goals: additional children or families, public signup, subscriptions, tablet-specific support, touch answers, camera input, custom hardware, local models, offline use, generated illustrations, a comprehensive curriculum, teacher dashboards, advanced analytics, rewards, streaks, achievements, and third-party product integrations.

## 9. Build sequence

The intended application stack remains Next.js, React, TypeScript, Convex, and Vercel; the seven-day experiment runs locally. GPT-Live 1 is the initial voice candidate; Jev is optional. Model-specific integration details belong in the [architecture document](architecture.md).

| Slice | Deliverable | Exit criterion |
| --- | --- | --- |
| 1. Voice feasibility | MacBook browser, one hardcoded counting activity, emoji scene, basic session record, parent stop, timing limits | Demonstrate usable pauses, interruption handling, transcript evidence, speech/scene coordination, and reliable stopping. Record shortcomings before choosing the live control approach. |
| 2. Reviewed evidence | Durable session records, Observer proposals, evidence inspection, parent corrections and review gate | A complete or partial session yields reviewable observations; only accepted or corrected evidence becomes eligible for planning. |
| 3. Adapt tomorrow | Evidence-based learning profile, bounded planner, three-part lesson, explanation of target choice | Session two demonstrably uses reviewed information from session one; the explanation traces to its source. |
| 4. Seven-day experiment | Today/History views, daily evaluation, experiment report | The parent can run the protocol and review participation and adaptations without manually reconstructing the record. |

Do not build the full memory pipeline until the voice feasibility gate is met. Add Jev only if that test identifies a concrete need for a separate controller.

This document specifies intended behavior. The repository currently contains a Next.js starter; this documentation does not claim the described product has been implemented.
