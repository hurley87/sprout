# Jane Street's Socratic Tutor: Lessons for Sprout

**Reference:** [janestreet/agent_skills](https://github.com/janestreet/agent_skills) · [Socratic Tutor skill](https://github.com/janestreet/agent_skills/blob/master/socratic-tutor/SKILL.md)

## Overview

Jane Street's `agent_skills` repository includes a `socratic-tutor` skill: a Markdown-based set of instructions that guides a general-purpose LLM through structured, Socratic teaching. It is a **pedagogical prompt**, not a full tutoring platform. Its most valuable principle for Sprout is that **mastery must be demonstrated through evidence, not declared by the model after one correct response**.

The skill prescribes:

1. **Diagnostic placement:** Ask 3–5 questions to determine what the learner already knows.
2. **Skill mapping:** Break a topic into subskills and track proficiency from 0 (unaware) to 5 (can teach or handle edge cases).
3. **One-question-at-a-time tutoring:** Prompt the learner to reason, predict, explain, and correct mistakes rather than immediately supplying answers.
4. **Evidence-based advancement:** Require at least two independent checks, including recall that is not immediately prompted by instruction.
5. **Spaced review and final assessment:** Revisit earlier material, reassess when necessary, and verify performance before claiming mastery.

## What Sprout Should Adopt

### 1. Separate lesson completion from demonstrated learning

A correct answer should not automatically mean a child has mastered a skill. Track what was actually demonstrated:

- Correct with substantial help or modelling
- Correct after a small hint
- Correct independently on a fresh example
- Correct independently in a later session
- Unclear or insufficient evidence

Keep these as evidence-backed observations; avoid treating a single attempt as a definitive mastery score.

### 2. Add spaced review to daily learning

Revisit earlier skills in new contexts. For example, after a child independently identifies four butterflies, show four ice-cream cones in a later session without first supplying the answer. This tests retention and transfer, not just repetition of the same activity. Use the results to choose the next target or level of support.

### 3. Make responses to mistakes deliberate but age-appropriate

Adapt the Socratic method for children aged roughly 3–6:

**Independent attempt → neutral retry or clarification → small hint → stronger help or model together → fresh attempt with less help.**

Do not force multiple unsuccessful attempts or prolonged questioning. Allow the child to move on or stop; preserve engagement while protecting opportunities for independent thinking.

### 4. Put assessment and advancement rules in authored lessons

Lesson definitions should specify the objective, expected observable evidence, permitted support, fresh-example requirements, and conditions for progression. GPT-Live should handle natural conversational delivery; application-owned logic should control lesson scope, state transitions, and durable learning claims.

### 5. Use persistent evidence to personalize future lessons

As Sprout adds durable learner profiles, retain the distinction between observed responses, inferred knowledge, uncertainty, and parent-reviewed evidence. A later planner can use this history to select reinforcement, increased challenge, alternate representations, or spaced review—and explain its rationale to parents.

## What Not to Copy

- **Do not replace GPT-Live or Jev.** Jane Street's skill offers instructional policies, not an alternative real-time speech or lesson-runtime architecture.
- **Do not treat its 0–5 proficiency scale as a validated preschool assessment.** Use it as a conceptual reference, not an automatic child scoring system.
- **Do not adopt rigid Socratic questioning.** Young children need play, visual interaction, timely support, and room to disengage.
- **Do not mistake the repository for a production learning platform.** It does not provide Sprout's deterministic lesson graph, visual UI, persistent evidence infrastructure, or behavioral evaluation harness.

## Fit With Sprout's Architecture

Sprout already separates the authored lesson graph and deterministic runtime from GPT-Live conversation and Jev semantic observation. That is a strong foundation for implementing pedagogical rules outside the model prompt.

The current repository's counting attempts and transcripts remain in memory rather than a durable learner database. Persistent learner memory and next-day planning are roadmap directions; they should not be described as deployed features.

## Existing GitHub Issues to Refine

| Issue | Suggested refinement |
| --- | --- |
| [#16 — Lesson catalog and skill progression](https://github.com/hurley87/sprout/issues/16) | Explicit evidence requirements for independent performance, delayed review, and advancement. |
| [#29 — Persistent learner memory](https://github.com/hurley87/sprout/issues/29) | Preserve supported vs. independent success, uncertainty, timestamps, and provenance across sessions. |
| [#27 — Diagnostic onboarding](https://github.com/hurley87/sprout/issues/27) | Use playful, adaptive starting-point questions rather than a formal quiz; allow partial baselines. |
| [#75 — Misconception remediation](https://github.com/hurley87/sprout/issues/75) | Use bounded, age-appropriate follow-ups to distinguish possible reasons for mistakes without claiming to observe unmeasured behavior. |

These are enhancements to the existing roadmap, not a reason to start a separate tutoring architecture initiative.

## Recommended First Experiment

Extend the current counting experience with **one fresh independent check following a supported or successful attempt**.

- Record whether the child answered independently or after help.
- Present a different scene that tests the same underlying counting skill.
- Verify that Jev and the lesson runtime distinguish the fresh independent result from assisted success.
- Preserve uncertainty when a response is ambiguous.
- Test the behavior with the existing evaluation harness before introducing persistent mastery scores or a spaced-repetition scheduler.

**Long-term product benefit:** This supports Sprout's vertically integrated direction—expert-authored curriculum, adaptive daily learning, persistent personalization, and credible parent reporting—without changing its core GPT-Live architecture.
