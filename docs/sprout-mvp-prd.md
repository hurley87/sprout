# Sprout MVP

## Product Requirements Document

**Stage:** MVP  
**Primary user:** Parent of a preschool-aged child  
**Child age for initial prototype:** 3–5 years  
**Initial test:** One child, one five-minute session per day, for seven days  
**Initial surface:** iPad / browser  
**Core AI:** GPT-Live-1 + Jev + post-session Observer  
**Backend:** Next.js + Convex

---

# 1. Summary

Sprout is a five-minute daily conversational learning companion for young children.

Each day, the child participates in a short voice-first lesson consisting of stories, questions, simple games, emojis, and conversational activities.

The child experiences a playful interaction.

Behind the scenes, Sprout:

1. begins with a small learning objective;
2. conducts a live voice lesson;
3. adapts the interaction based on the child's responses;
4. records evidence of understanding;
5. updates a longitudinal learning profile;
6. plans the next lesson using what it learned.

The core loop is:

> **Plan → Play → Observe → Remember → Adapt tomorrow**

The MVP exists to validate whether this longitudinal loop creates a meaningfully better learning experience over repeated sessions.

---

# 2. Product thesis

The important capability is not that an AI can teach a five-minute lesson.

The important capability is that:

> **Tomorrow's five-minute lesson can be better because of what happened today.**

Most learning apps primarily track completion, scores, or correct answers.

Sprout should instead develop an evolving understanding of:

- what the child has demonstrated independently;
- what requires prompting;
- what concepts are inconsistent;
- what interests produce engagement;
- what kinds of activities work well;
- what should be reinforced;
- what is ready to advance;
- what has not been revisited recently.

Over time, the system should increasingly feel as though it knows how to teach this particular child.

---

# 3. MVP research question

The primary research question is:

> **Does Day 7 feel meaningfully more personalized and useful than Day 1?**

The MVP is not intended to prove measurable academic improvement in seven days.

It is intended to determine whether:

- young children engage naturally with the interaction;
- meaningful learning evidence can be extracted from conversation;
- the system can remember that evidence accurately;
- future lessons can use it effectively;
- the resulting personalization feels valuable to the parent and child.

---

# 4. Target user

## Child

The initial experience is optimized for a preschool-aged child, approximately 3–5 years old.

Assume:

- little or no reading ability;
- short attention span;
- developing conversational ability;
- frequent pauses and self-corrections;
- incomplete sentences;
- interruptions;
- occasional topic changes;
- preference for stories, pretend play, humor, and simple visual interaction.

The child is not expected to navigate the application independently.

## Parent

The parent:

- creates the child profile;
- initiates the lesson;
- reviews summaries;
- verifies whether observations appear accurate;
- controls stored history;
- decides when and whether Sprout is used.

The parent is the account owner.

---

# 5. Core product principles

## 5.1 Five minutes

The default session length is approximately five minutes.

A session may end slightly earlier or later if the conversation naturally requires it.

Sprout should not optimize for maximizing time spent.

## 5.2 Play, not testing

The child should not feel examined.

Do not show:

- scores;
- grades;
- percentages;
- pass/fail results;
- streak pressure.

Learning objectives remain hidden inside activities.

## 5.3 Voice first

The primary interaction is speech.

The child should be able to:

- pause;
- hesitate;
- interrupt;
- change an answer;
- ramble briefly;
- speak imperfectly.

Sprout should adapt rather than forcing rigid turn-taking.

## 5.4 Simple visuals

Visuals support the conversation rather than dominate it.

The MVP uses emojis rather than generated illustrations.

Examples:

```text
🥚 🥚 🥚 🥚 🥚
```

```text
🐘        🐭
```

```text
😀 😢 😴
```

```text
🌧️ → ☀️ → 🌈
```

## 5.5 Teaching is allowed

Sprout should scaffold when necessary.

It may:

- simplify a question;
- offer a choice;
- provide a hint;
- model one example;
- count together;
- use a visual cue;
- change the activity.

The objective is learning, not merely detecting failure.

## 5.6 Store evidence, not just answers

Sprout should distinguish between:

- independent demonstration;
- light prompting;
- choice-based support;
- modeled support;
- incomplete evidence;
- incorrect evidence.

Example:

> Counted five eggs independently.

is more useful than:

> Answered "five."

---

# 6. Initial learning scope

The MVP should intentionally cover a very small set of skills.

Initial skill taxonomy:

### Number sense

- quantities 1–3;
- quantity 4;
- quantity 5;
- more / less.

### Concepts

- big / small.

### Sequencing

- first / next / last.

### Reasoning

- simple prediction;
- simple cause and effect.

This is sufficient to validate the longitudinal learning system without attempting to build a preschool curriculum.

---

# 7. Initial activity formats

Support approximately five reusable activity patterns.

## Counting

Example:

```text
🥚 🥚 🥚 🥚 🥚
```

> "Can you count the eggs?"

## Which one?

Example:

```text
🐘        🐭
```

> "Which animal is bigger?"

## What happens next?

Example:

```text
🌧️ → ☀️ → ?
```

> "What do you think comes next?"

## Silly mistake

Example:

> "Fish live in trees, right?"

```text
🐟 🌳
```

The child corrects Sprout.

## Short story

Use a simple narrative to test sequencing, prediction, or cause and effect.

Example:

> "The duck went outside. Then it started raining. What should the duck bring?"

---

# 8. Daily lesson plan

Before each session, Sprout generates a compact lesson plan.

Example:

```text
Primary objective:
quantity_5

Secondary objective:
first_next_last

Theme:
dinosaurs

Activity:
dinosaur egg rescue

Visual scenes:
- five eggs
- four eggs
- dinosaur
- celebration

Evidence sought:
- counts five independently
- identifies what happened first
```

The plan establishes the rails of the lesson.

GPT-Live should not independently invent the curriculum while conducting the conversation.

---

# 9. Live session architecture

The live experience uses three different layers.

```text
                     CHILD
                       │
                       ▼
                  GPT-Live-1
             natural conversation
                       │
              finalized utterance
                       │
                       ▼
                      Jev
            fast bounded decisions
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   lesson move      UI action      evidence signal
        │              │
        │              ▼
        │           React UI
        │
        ▼
    GPT-Live
 continues conversation
```

---

# 10. GPT-Live responsibilities

GPT-Live owns the conversational experience.

It should handle:

- speech;
- pacing;
- listening;
- short acknowledgements;
- clarifications;
- interruption recovery;
- child-friendly language;
- personality.

It should generally:

- speak in short sentences;
- ask one question at a time;
- give the child time to think;
- stop speaking when genuinely interrupted;
- tolerate hesitation;
- avoid over-explaining.

GPT-Live should not own:

- long-term memory;
- mastery state;
- curriculum selection;
- authoritative learning-profile updates.

---

# 11. Jev responsibilities

Jev acts as Sprout's fast semantic control layer during the lesson.

Run a Jev evaluation after each meaningful finalized child utterance.

Input:

```text
current objective
latest child utterance
current activity
current visual
support already provided
time remaining
recent turn context
```

## Noul questions

Use Noul for gating decisions.

Examples:

> Did the child demonstrate the current concept?

> Is this response useful learning evidence?

> Does this situation require deeper reasoning?

> Should the visual change?

## Choice questions

Use Choice for discrete next actions.

### Lesson move

- continue;
- reinforce;
- scaffold;
- advance;
- change_activity;
- wrap_up.

### Visual action

- no_change;
- highlight;
- add_item;
- remove_item;
- new_example;
- celebrate.

### Character expression

- listening;
- curious;
- thinking;
- surprised;
- happy.

## Score questions

Use Score for ordered judgments.

Examples:

### Evidence strength

```text
0 = none
1 = weak
2 = moderate
3 = strong
```

### Engagement

```text
0 = disengaged
1 = low
2 = moderate
3 = strong
4 = highly engaged
```

### Support required

```text
0 = independent
1 = light prompt
2 = substantial prompt
3 = modeled
```

---

# 12. Jev is not authoritative memory

Jev influences the current interaction.

It does not permanently determine what the child knows.

For example:

```text
demonstratedConcept = true
```

may cause Sprout to move to a harder example during the live session.

It does not automatically mark the skill as mastered.

Long-term learning updates occur after the session using the complete transcript.

---

# 13. Visual system

The MVP uses deterministic React rendering.

Do not generate JSX or images dynamically.

Initial scene schema:

```ts
type Scene =
  | {
      type: "items";
      items: string[];
    }
  | {
      type: "choice";
      items: string[];
    }
  | {
      type: "sequence";
      items: string[];
    }
  | {
      type: "character";
      expression:
        | "listening"
        | "happy"
        | "curious"
        | "thinking"
        | "surprised";
    };
```

Example:

```json
{
  "type": "items",
  "items": ["🥚", "🥚", "🥚", "🥚", "🥚"]
}
```

---

# 14. Child-facing UI

The child-facing view should be extremely simple.

No visible navigation.

No transcript.

No lesson title.

No reading-heavy interface.

Conceptually:

```text
┌────────────────────────────┐
│                            │
│            👀              │
│                            │
│          Sprout            │
│                            │
│   🥚   🥚   🥚   🥚   🥚   │
│                            │
└────────────────────────────┘
```

The character dominates when no learning visual is required.

---

# 15. Character

The MVP character can be minimal.

States:

- listening;
- talking;
- thinking;
- curious;
- surprised;
- happy.

Do not invest in elaborate animation before validating the core loop.

The character exists primarily to give the voice a persistent identity.

---

# 16. Transcript

Persist the complete lesson transcript.

Each turn should include at minimum:

```ts
{
  speaker: "child" | "sprout";
  text: string;
  timestamp: number;
}
```

Transcript data is evidence for the post-session Observer.

Raw audio does not need to be retained for the MVP.

---

# 17. Post-session Observer

After the five-minute lesson ends, run the full transcript through a capable reasoning model.

The Observer produces structured evidence.

Example:

```json
{
  "observations": [
    {
      "skill": "quantity_5",
      "evidence": "Counted five dinosaur eggs independently.",
      "support": "none",
      "confidence": 0.94
    },
    {
      "skill": "first_next_last",
      "evidence": "Identified what happened first after receiving two choices.",
      "support": "choice",
      "confidence": 0.81
    }
  ],
  "engagement": {
    "level": "high",
    "notes": "Strong engagement with dinosaur pretend play."
  }
}
```

---

# 18. Learning profile

The learning profile is the durable memory of Sprout.

Initial state options:

- unobserved;
- emerging;
- developing;
- consistent;
- needs_revisit.

Example:

```text
quantity_1_3:
consistent

quantity_4:
consistent

quantity_5:
developing

big_small:
consistent

first_next_last:
emerging
```

Each state should be grounded in supporting observations rather than overwritten by one session.

---

# 19. Evidence model

Each observation should include:

```ts
Observation {
  skillId
  sessionId
  evidence
  support
  confidence
  context
  createdAt
}
```

Example:

```text
skill:
quantity_5

evidence:
Counted five ducks independently.

support:
none

confidence:
0.91

context:
zoo story
```

---

# 20. Next-day lesson planner

After observations update the learning profile, generate the next lesson.

The planner receives:

- skill states;
- recent observations;
- recent lesson themes;
- recent activity types;
- interests;
- recent engagement;
- concepts not recently revisited.

Example state:

```text
Quantity 1–4:
consistent

Quantity 5:
developing

First/next/last:
emerging

Interests:
dinosaurs
animals

Recent themes:
dinosaurs
dinosaurs

Successful activities:
pretend play
silly mistakes
```

Tomorrow's lesson might be:

```text
Theme:
zoo snack time

Primary objective:
quantity 5

Secondary objective:
first / next / last

Activity:
feed five bananas to monkeys
```

The product should deliberately vary context rather than repeat the same activity.

---

# 21. Data model

The MVP needs only a small set of core entities.

## Child

```ts
Child {
  name
  birthDate
  interests[]
}
```

## Session

```ts
Session {
  childId
  startedAt
  endedAt
  objective
  secondaryObjective?
  theme
  activity
  transcript
}
```

## Observation

```ts
Observation {
  childId
  sessionId
  skillId
  evidence
  support
  confidence
  context
}
```

## SkillState

```ts
SkillState {
  childId
  skillId
  state
  evidenceCount
  lastObservedAt
}
```

## LessonPlan

```ts
LessonPlan {
  childId
  objective
  secondaryObjective?
  theme
  activity
  scenes[]
}
```

---

# 22. Parent experience

The MVP parent view requires only two screens.

## Today

Example:

### Dinosaur Egg Rescue

She practiced counting and sequencing.

**What Sprout noticed**

She counted five objects independently.

She needed two choices to identify what happened first.

She was highly engaged during the dinosaur story.

**Tomorrow**

Sprout will revisit quantity five in a different setting and continue practicing first / next / last.

## History

Show the last seven sessions.

For each:

- date;
- lesson theme;
- objective;
- 2–3 important observations.

Do not build a complex analytics dashboard yet.

---

# 23. One-week experiment

Run one session per day for seven days.

The same child profile should be used throughout.

Do not manually rewrite the learning profile between sessions unless correcting a clearly erroneous observation.

---

# 24. Parent evaluation

After each lesson, the parent records four subjective ratings.

## Engagement

```text
1–5
```

## Lesson appropriateness

```text
1–5
```

## Observation accuracy

```text
1–5
```

## Conversation quality

```text
1–5
```

Optional notes should capture obvious failures.

---

# 25. System metrics

Capture:

- sessions started;
- sessions completed;
- duration;
- number of child turns;
- number of Jev evaluations;
- premature GPT-Live interruptions;
- child interruptions successfully handled;
- lesson moves selected by Jev;
- independent demonstrations;
- prompted demonstrations;
- skills revisited;
- activities used;
- observation confidence;
- whether the lesson used prior-session evidence.

---

# 26. MVP success criteria

The MVP is promising if, by the end of seven sessions:

- the child willingly participates in most sessions;
- approximately five minutes feels appropriate;
- adult intervention is uncommon;
- GPT-Live handles preschool pauses reasonably well;
- emoji visuals are sufficient for basic lessons;
- Jev decisions generally align with sensible lesson behavior;
- post-session observations are credible;
- skill history accumulates coherently;
- later lessons clearly use prior evidence;
- lesson content varies rather than becoming repetitive;
- the parent finds the daily summary useful;
- Day 7 feels noticeably more personalized than Day 1.

---

# 27. Primary failure conditions

The MVP should be considered weak if:

- lessons feel like quizzes;
- the child regularly loses interest before five minutes;
- GPT-Live repeatedly interrupts thinking pauses;
- transcript quality makes evidence unreliable;
- Jev produces erratic lesson moves;
- observations frequently misrepresent what happened;
- skill states fluctuate arbitrarily;
- tomorrow's lesson does not meaningfully depend on today's evidence;
- personalization is not obvious after several sessions.

---

# 28. Safety and privacy

Sprout should not:

- diagnose developmental conditions;
- diagnose speech or learning disorders;
- claim clinical authority;
- tell parents that a child is "behind";
- generate high-stakes educational conclusions;
- encourage secrecy from parents;
- position itself as a replacement for parents or teachers;
- expose a general-purpose chatbot to the child.

Parents should control:

- profile creation;
- history;
- deletion.

Raw audio should not be retained by default.

---

# 29. Technical stack

Recommended MVP stack:

### Application

- Next.js
- React
- TypeScript
- Vercel

### Persistence

- Convex

### Live voice

- GPT-Live-1

### Fast semantic control

- Jev through Vercel AI Gateway

### Post-session reasoning

- capable text reasoning model with structured output

### Visuals

- deterministic React renderer
- emoji assets only

---

# 30. Build sequence

## Slice 1 — Live lesson

Build:

- child session screen;
- GPT-Live connection;
- five-minute session;
- one hardcoded lesson;
- transcript persistence.

Exit criteria:

> One child can complete one coherent five-minute voice lesson.

## Slice 2 — Visuals + Jev

Build:

- emoji renderer;
- scene state;
- Jev evaluation after meaningful child turns;
- next-move selection;
- visual changes.

Exit criteria:

> The lesson reacts appropriately to the child's answers without manually scripted branching.

## Slice 3 — Memory

Build:

- Observer;
- structured observations;
- skill profile;
- next-day lesson generation.

Exit criteria:

> Session two demonstrably uses information learned in session one.

## Slice 4 — Parent view

Build:

- daily summary;
- next lesson preview;
- seven-day history.

Exit criteria:

> Parent can understand what happened without reading the transcript.

---

# 31. Explicit MVP non-goals

Do not build:

- multiple child accounts;
- subscriptions;
- custom hardware;
- local LLM inference;
- custom illustrations;
- image generation;
- camera support;
- comprehensive preschool curriculum;
- teacher dashboards;
- classroom support;
- advanced analytics;
- rewards;
- streaks;
- achievements;
- content marketplace;
- third-party integrations;
- detailed parental controls beyond what is necessary for the prototype.

---

# 32. What comes after the MVP

Only after the one-week loop shows promise should Sprout explore:

- longer-term testing;
- broader skill taxonomy;
- curriculum frameworks;
- richer visual assets;
- dedicated hardware;
- StackChan / MicroDuck experiments;
- local speech and local LLM inference;
- multiple child profiles;
- parent controls;
- offline operation.

---

# 33. MVP decision

At the end of the initial experiment, answer one question:

> **Did Sprout learn enough about the child to make later lessons clearly better than earlier lessons?**

If yes, continue investing in longitudinal learning, curriculum, and eventually dedicated hardware.

If no, improve the learning-memory loop before expanding the product surface.
