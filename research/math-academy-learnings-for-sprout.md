# Math Academy: Lessons for Sprout

**Research note — November 11, 2026**  
**Reference:** https://www.mathacademy.com/

## Executive summary

Math Academy offers a useful **architecture for personalized learning**, even though its primary audience and learning experience are different from Sprout's preschool audience.

The central insight is to separate **what to teach next** from **how to deliver the learning experience**. Sprout can retain GPT-Live as its natural voice tutor and build a small, deterministic curriculum and learner-model layer around it.

The most useful ideas to adapt are:

1. Model the curriculum as individual skills with prerequisite relationships.
2. Track evidence of mastery across sessions and different game themes, not just one correct answer.
3. Use a learner profile to choose new, review, or easier activities.
4. Make diagnosis a gradual, playful part of ordinary lessons.
5. Give parents meaningful reports about demonstrated learning rather than just time spent or points earned.

**Recommendation:** Integrate these ideas into the existing counting-game work before building a broad adaptive learning platform.

## What Math Academy does that matters

Math Academy describes an adaptive system that uses detailed skill/prerequisite structures, learner performance, diagnostics, targeted practice, and spaced review to select what a student should work on. Its approach is closer to a **structured tutoring expert system** than an open-ended chatbot improvising a curriculum.

The transferable design pattern is:

```text
Expert-authored skill map
          ↓
Learner evidence and mastery estimates
          ↓
Next-skill / review decision
          ↓
Age-appropriate interactive lesson
          ↓
New evidence feeds the learner model
```

This is a conceptual summary of the product's approach, not a claim that its proprietary implementation follows exactly this diagram.

## How it maps onto Sprout

Sprout's existing and planned pieces already fit this division of responsibilities:

| System | Responsibility |
| --- | --- |
| Expert-authored curriculum | Defines skills, prerequisites, suitable questions, and progression rules |
| Learner model (Convex) | Stores learner profile, answer evidence, skill status, and review history |
| Lesson selector | Decides whether to introduce, reinforce, or review a skill |
| GPT-Live | Provides engaging, responsive voice interaction and instruction |
| Jev / structured lesson runtime | Handles deterministic lesson state and answer-evaluation decisions |
| Game / visual layer | Presents a skill through themes the child likes (flowers, dinosaurs, ice cream, etc.) |
| Parent reporting | Translates evidence into understandable progress and suggested offline activities |

**Important:** Keep GPT-Live. The lesson is *not* to replace the conversational tutor with a custom model. It's to give the tutor a clearer teaching objective and reliable long-term learning context.

## 1. Define a small early-numeracy skill graph

Start with about **10–15 foundational skills**, not thousands. Illustrative examples:

- Recognize quantities 1–3 without counting (subitizing).
- Recite counting words 1–5 in order.
- Count up to five physical or pictured objects with one-to-one correspondence.
- Understand that the last counting word gives the total (cardinality).
- Match the numbers 1–5 to pictured quantities.
- Recognize written numerals 1–5.
- Compare two small groups: more, fewer, same.
- Extend counting to 10 when ready.

Represent prerequisites explicitly, but **do not assume the above list is a validated developmental sequence**. Have an early-childhood educator review the content and dependency graph.

A game should target one or more defined skills. For example, a flower-counting game and an ice-cream-counting game may both practise `count_objects_1_to_5`.

## 2. Collect *learning evidence*, not only lesson completions

Each evaluated learner attempt should have enough context to support later decisions.

Suggested initial record:

```ts
{
  learnerId: string,
  sessionId: string,
  activityId: string,
  skillId: string,
  promptId: string,
  expectedAnswer: unknown,
  observedAnswer: unknown,
  outcome: "correct" | "incorrect" | "uncertain" | "skipped",
  assistance: "none" | "hint" | "modelled" | "repeated_prompt",
  evaluationConfidence?: number,
  timestamp: number
}
```

This is a **proposed schema**, not an existing Sprout interface. It can be simplified to match the current Convex/Jev contracts.

Two guardrails are especially important:

- **Separate speech recognition uncertainty from mathematical misunderstanding.** If the child's speech was ambiguous or masked by noise, record `uncertain` instead of reducing estimated mastery.
- **Distinguish independent success from prompted success.** A correct answer after the tutor counted along is still useful evidence, but it is not equivalent to an unassisted answer.

## 3. Estimate mastery over time and across contexts

Avoid marking a skill mastered because of a single correct attempt. Instead, look for repeated successes, ideally across different prompts, sessions, and visual themes.

Example:

- Monday: counts four flowers independently.
- Tuesday: counts four scoops of ice cream independently.
- Friday: counts four dinosaurs after a short pause, without a hint.

This is stronger evidence of transferable understanding than repeating the same item three times in one session.

A simple first implementation could use interpretable states:

```text
not_started → emerging → practicing → demonstrated → review_due
```

These states are proposed product conventions, **not a scientifically validated mastery algorithm**. Thresholds should be conservative, adjustable, and tested with real sessions.

## 4. Make diagnostics feel like play

Math Academy's formal diagnostic approach should **not** be copied directly for preschoolers. Sprout can infer proficiency from the first few games and continuously update it afterward.

An example path:

1. Present two or three objects to count.
2. If answered comfortably, try a slightly larger quantity.
3. If the child struggles, offer an easier prompt or supportive counting activity.
4. Adapt the next session based on the overall pattern, not a single answer.

Avoid timed tests, long onboarding assessments, and framing attempts as failures. The experience should still feel like a short, enjoyable game.

## 5. Select the next activity using simple deterministic rules

A first-generation lesson selector can be rule-based:

| Observation | Candidate next action |
| --- | --- |
| Repeated independent success | Introduce the next appropriate skill |
| Inconsistent or assisted performance | Practise the same skill with a different game |
| Previously demonstrated skill is due for review | Briefly revisit it in a new theme |
| Persistent difficulty | Break the task down into a simpler prerequisite |
| Evidence is uncertain due to audio | Retry gently; don't penalize mastery |
| Signs of disengagement | Change pacing/theme or wrap up; don't force progression |

Future versions can use better estimation methods, but there's no reason to add an elaborate adaptive algorithm before the basic evidence is reliable.

## 6. Treat game themes as presentations of curriculum

This is a valuable design boundary for Sprout:

- **Curriculum object:** `count_objects_1_to_5`
- **Question template:** “How many [objects] do you see?”
- **Game theme:** flowers / dinosaurs / ice cream / Halloween
- **Learner preference:** likes dinosaurs, prefers short sessions, etc.

That makes content reusable. It also allows tests of **transfer**: can a child perform the same skill in a visually new context?

Themes should influence engagement, while skill selection remains driven primarily by learning needs.

## 7. Build parent reporting from evidence

A parent-facing weekly brief could show:

- **Skills demonstrated:** e.g., counted 1–3 independently in multiple games.
- **Skills being practised:** e.g., counting 4–5 with occasional hints.
- **New activities introduced:** which concepts or games appeared.
- **Confidence and context:** distinguish observed performance from uncertain/limited evidence.
- **One practical offline suggestion:** e.g., count four strawberries together at snack time.

A sample report should avoid false precision. “Demonstrated independently in three different games” is more defensible than a fabricated “92% mastered” score.

## Implementation plan

### P0 — Add skill metadata to counting games

- Define the first 10–15 skills and stable IDs.
- Add simple prerequisite links and authoring notes.
- Annotate existing counting prompts with target skills.
- Keep the existing GPT-Live + Jev lesson flow intact.

**Done when:** each evaluated question maps to a clearly defined skill.

### P0 — Persist answer evidence

- Save the target skill, expected answer, observed answer, evaluation result, assistance level, and timestamp.
- Preserve an `uncertain` classification where voice evidence isn't trustworthy.
- Build a basic internal view of a learner's skill attempts.

**Done when:** a child's performance can be compared across separate sessions and game themes.

### P1 — Add a first lesson selector

- Introduce a simple `new / practice / review` decision.
- Review older skills periodically; vary prompts and visual themes.
- Keep decisions transparent and inspectable in the debug overlay.

**Done when:** the system can select an appropriate next counting activity from recent evidence without manual intervention.

### P1 — Generate a parent learning brief

- Produce a weekly summary from persisted learner evidence.
- Report observable behaviour and assistance rather than inflated mastery scores.
- Add one short at-home practice suggestion.

**Done when:** a parent can understand what their child practised, what they demonstrated, and what comes next.

## What *not* to copy from Math Academy

- Long formal diagnostic tests.
- Timed or high-pressure assessments.
- Leaderboards or competition as a core motivator.
- Very large curriculum graphs before proving the early lessons work.
- Aggressive optimization of “learning speed” at the expense of joy, confidence, or willingness to return.

Math Academy addresses a substantially older, more independent learner. Sprout should optimize for a **3–6-year-old's playful, short, guided learning experience**.

## Open questions and validation

1. Which early-numeracy standards or educator-authored progression should anchor the first skill graph?
2. What evidence is sufficient to say a child *demonstrated* a skill, rather than merely attempted it?
3. How reliably can the current GPT-Live/Jev pipeline distinguish incorrect, uncertain, and assisted spoken answers?
4. Does changing themes improve engagement while preserving performance on the same underlying skill?
5. Do families find evidence-based weekly summaries useful enough to return to the product?

## Bottom line

Math Academy helps Sprout most as an **architectural model**, not a UX template:

> **Curriculum intelligence** decides what is worth learning.  
> **Learner intelligence** estimates what the child knows and should practise next.  
> **GPT-Live** turns that decision into an engaging spoken and visual experience.

Build a small version of those first two layers around the counting games; validate them before expanding the curriculum.

## Sources and further reading

- Math Academy homepage: https://www.mathacademy.com/
- How Our AI Works: https://www.mathacademy.com/how-our-ai-works
- How It Works: https://www.mathacademy.com/how-it-works

*Prepared as a Sprout product-design synthesis of Math Academy's publicly described approach and our existing Sprout direction. Proposed schemas, lesson rules, and curriculum examples are recommendations, not features verified to exist in Math Academy or Sprout.*
