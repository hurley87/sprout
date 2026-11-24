# Gakku.ai — Product Research & Lessons for Sprout

**Researched:** November 11, 2026  
**Product:** [gakku.ai](https://gakku.ai/)  
**Category:** AI-native tutoring / learning companion  
**Primary audience:** Learners ages 6–16 (according to launch announcement)  
**Relevance:** Sprout curriculum, voice interaction, personalized learning, learner engagement, and parent reporting

## Executive summary

Gakku is an AI-native learning coach for writing, speaking, and critical thinking, built around a conversational AI companion called **Raku**. It combines structured learning maps, natural voice conversation, multimodal content, persistent memory, and game-like progression.

The most useful takeaway for Sprout is **the combination of expert-authored learning objectives and adaptive AI interactions**. The underlying curriculum gives sessions pedagogical structure, while the voice tutor makes each interaction responsive and personal.

Gakku is focused on older children and written expression; Sprout's initial focus is preschool learners and foundational skills through short, playful, voice-first sessions. Gakku's young public launch also means there is limited public independent evidence for its efficacy or retention.

## Product overview

Gakku was publicly launched by Algorithm of Learning in October 2026. It positions itself as a coach that helps students **form and explain their own ideas**, rather than generating completed assignments for them.

Its reported product areas include:

| Area | Function |
| --- | --- |
| **Map / Lesson Maps** | Mission-based, sequenced skill lessons with progression and challenges |
| **Cabin** | Open-ended exploration and conversations with Raku |
| **Plaza** | Mini-games, daily challenges, and skill reinforcement |
| **Me / Profile** | Learner progression and identity |
| **Writing Workshop** | Guided brainstorming, planning, drafting, and revision |
| **Learning Notebook** | Saved learning work, progress, and insights |

The Map/Cabin/Plaza/Me navigation is described in a November 2026 hands-on product review. Gakku's own launch materials describe Raku, Lesson Maps, Cabin, Writing Workshop, and Notebook.

### How a lesson works

In an example creative-writing exercise, Raku presents a visual prompt, asks guiding questions, and encourages the student to describe story elements. The student's spoken ideas can become text or evolving visual content, and the tutor can continue asking questions or offering hints. This makes the learning **interaction**—rather than the final generated text—the central product.

Gakku's Opinion Writing Lesson Map was announced in November 2025. Its lessons teach discrete writing skills, culminating in a larger writing challenge. The company states that its curriculum draws on CCSS, CEFR, and GCSE standards.

## Relevant technical and UX capabilities

1. **Real-time, interruptible voice.** Learners can ask follow-ups and redirect the tutor. Gakku's public materials describe full-duplex voice interaction, but do not disclose enough implementation details to compare its speech stack directly with Sprout's.
2. **Multimodal responses.** The product coordinates speech, text, illustrations, and interactive activities as the conversation unfolds.
3. **Personalized memory.** Raku is described as retaining interests, previous work, challenges, and unfinished ideas for future sessions.
4. **Structured progression.** Lessons are organized around defined objectives and milestones, while the conversation within each lesson varies.
5. **Game-like motivation.** Challenges, unlocks, stars, mini-games, and rewards help make structured practice feel playful.
6. **Parent-visible value.** A Learning Notebook and progress insights make learning more tangible outside the session.

**What remains unverified:** The specific foundation models and speech providers, the implementation of memory and mastery measurement, latency in realistic child interactions, and independent evidence of learning outcomes.

## Pricing snapshot (November 2026)

Gakku's website lists the PLUS membership at **US$29.90 per month** or **US$269 per year**, with a **seven-day free trial**. It includes lessons, writing workshops, AI coaching, the Learning Notebook, and member benefits. AI activity is subject to monthly usage allowances; additional Learning Boosts can be used or purchased.

Pricing and terms may change. Source: [Gakku pricing](https://gakku.ai/pricing/).

## Lessons for Sprout

### 1. Move from demos to a real curriculum map

Sprout should define a coherent sequence of mastery goals, not a collection of themed experiences. A proposed introductory counting sequence:

1. Count 1–3 visible objects.
2. Count 1–5 objects.
3. Match spoken numbers to quantities.
4. Recognize missing or changed quantities.
5. Apply the skills in a short adventure/challenge.

Different themes (flowers, dinosaurs, Halloween, etc.) can render the same skill objective without changing its assessment contract.

**Architecture fit:** Keep an authored curriculum and explicit answer-acceptance criteria; use **GPT-Live** for natural tutor dialogue and **Jev** for deterministic lesson progression and assessment decisions. Avoid adding model complexity until evaluation shows a clear need.

### 2. Separate personal memory from learning memory

Maintain two related but different layers:

- **Personalization profile:** name, interests, preferred stories and characters, conversational preferences, previous creative choices.
- **Learning/mastery record:** skills attempted, accuracy, independent performance, hints, retries, disengagement signals, and skills due for review.

The mastery record should influence **what** the learner practises next. Personal memory should influence **how** that practice feels.

### 3. Let answers change the world

Gakku's strongest multimodal idea is that speaking and thinking have visible consequences. Adapt this in a simpler form for ages 3–6:

- Count four stars → four stars appear in the sky.
- Find three flowers → three flowers grow in the garden.
- Correct a count → the character moves closer to a goal.

Use controlled, pre-authored assets at first. Live-generated art is not necessary to test whether contingent visual feedback increases engagement.

### 4. Deliver parent reporting from learning data

At the end of each session or week, communicate:

- What the learner practised.
- What they demonstrated independently.
- Where they needed prompts or retries.
- What comes next.

This should be generated from structured observations, rather than solely from the AI tutor's conversational impression. It creates subscription value beyond the child's five-minute experience.

### 5. Treat "thinking" as the learning product

Gakku's positioning emphasizes that the AI should not do the thinking for the student. For Sprout, that suggests a tutor that:

- Asks a useful follow-up instead of revealing answers immediately.
- Leaves room for the child's own attempt.
- Gives graduated hints when the child is stuck.
- Distinguishes a prompted answer from independently demonstrated understanding.
- Ends with evidence that the target skill was practised.

## Comparison: Gakku vs. Sprout

| Dimension | Gakku | Sprout opportunity |
| --- | --- | --- |
| Primary age group | 6–16 | Initially 3–6 |
| Primary curriculum | Writing, speaking, reasoning | Counting and foundational learning skills |
| Session experience | Mission-based, conversation-driven | Short, voice-first games and adventures |
| Interface | Voice plus writing and dynamic visuals | Spoken interaction with simple visual feedback |
| Persistence | Interests, learning history, saved work (described) | Explicit personal profile **and** structured skill mastery |
| Monetizable value | Learning subscription and workshops | Daily learning habit plus evidence-based parent reports |

## Suggested next steps

- [ ] Run through one complete Gakku lesson, especially a Creative Writing mission.
- [ ] Observe barge-in, silence handling, hints, retries, and transition to the next step.
- [ ] Test whether a returning learner's earlier interests and work are retained.
- [ ] Inspect its end-of-lesson progress summary and parent-facing information.
- [ ] Design a Sprout counting progression with explicit objectives and scoring contracts.
- [ ] Extend Sprout's learner profile to distinguish preference memory from mastery evidence.
- [ ] Prototype one visible world change that is contingent on the child's spoken response.
- [ ] Compare parent-summary usefulness against raw lesson transcripts.

## Sources and reference articles

1. **USA Today (contributor content), October 9, 2026** — [Artificial Intelligence: Why Gakku Wants to Teach Kids to Think and Not Just Write](https://www.usatoday.com/story/special/contributor-content/2026/10/09/artificial-intelligence-why-gakku-wants-to-teach-kids-to-think-and-not-just-write/92176891007/)  
   *Saved reference. Full article text was not accessible during this review; no claims above are attributed to its unread contents. Treat this as contributor content, not independent validation.*
2. **Gakku official website** — [gakku.ai](https://gakku.ai/)
3. **Gakku pricing** — [gakku.ai/pricing](https://gakku.ai/pricing/)
4. **Algorithm of Learning launch announcement, October 14, 2026** — [Introducing Gakku: An AI-Native Learning Coach That Puts Human Thinking First](https://www.digitaljournal.com/pr/news/newsfile/introducing-gakku-ai-native-learning-coach-1887646057.html)
5. **Gakku, November 24, 2025** — [First Lesson Map: Opinion Writing](https://gakku.ai/news/1416/)
6. **Gakku, April 10, 2026** — [Language Foundation Map](https://gakku.ai/news/1586/)
7. **36Kr / Duozhi, November 2026** — [Cosmo Parent Company Unveils AI-Native App Gakku](https://eu.36kr.com/en/p/4057574886085505)

---

**Bottom line:** Gakku is a useful reference for Sprout's longer-term vertically integrated product: authored curriculum, responsive voice tutoring, learner memory, purposeful multimodal interaction, and understandable progress. The most immediate opportunity is to turn Sprout's existing counting game into the first measurable step of a persistent learning journey.
