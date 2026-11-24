# Sprout — Small Skill Map and Progression Model

**Version:** 0.1 · **Date:** 2026-11-03 · **Status:** proposed authoring rules. No mastery scoring or recommendation system is implemented by these documents.

## Skill map

Research connections identify relevant goals, not equivalent assessments or complete coverage. Sources and limits are in the [Head Start research note](research/01-head-start-framework.md).

| ID | Observable target | Local development opportunities | Relevant goal | Experience |
| --- | --- | --- | --- | --- |
| NUM-01 | Name the quantity of a visible small set | Supported enumeration → fresh quantity response → changed arrangement → later retrieval | P-MATH 3 | Concert; Shop |
| NUM-02 | Select or describe more, fewer, or equal quantities | Pairing/modeling → visible comparison → changed layout → later retrieval | P-MATH 4 | Picnic |
| GEO-01 | Identify a shape despite size/orientation changes | Introduce → recognize → vary orientation → describe properties | P-MATH 9 | Workshop |
| GEO-02 | Understand/use an authored spatial relation | Demonstrate → guided choice → fresh spatial instruction | P-MATH 10 | Delivery |
| PAT-01 | Extend an AB repeating sequence | Copy → extend → change objects while retaining the rule | P-MATH 7 | Parade |
| LIT-01 | Recognize a rhyme among spoken options | Hear contrasts → guided selection → fresh word pairs → later retrieval | P-LIT 1 | Radio |
| LIT-02 | Reconstruct the order of story events | Supported retell → order fresh events → explain a connection | P-LIT 4 | Detective |
| LANG-01 | Follow an ordered instruction | Single instruction → two steps with prompts → reduced prompting | P-LC 2 | Shop; later Delivery |
| SCI-01 | Describe a visible change or comparison | Model observation → describe → predict and inspect → compare observations | P-SCI 1, 4 | Nature Lab |
| SCI-02 | Classify objects under an explicit attribute rule | Demonstrate → classify new items → later change the rule | P-SCI 3 | Sorting Station |

The arrows describe authoring opportunities, not a universal mandatory sequence. More/fewer/same are separately recorded facets of NUM-02. Recognizing rhyme does not require producing rhymes. Counting is not a prerequisite for a sound game, and reading is not a prerequisite for any first-catalog activity.

NUM-01 does not automatically establish one-to-one counting, subitizing, numeral recognition, or arithmetic. A child can name a small quantity through different strategies. Claims about those strategies need separately observable tasks.

## Entry requirements and challenge dimensions

**Entry requirements** concern access to the activity: understanding its vocabulary, distinguishing the representation, and communicating the permitted response. A brief familiarization can establish these without a test or score.

**Skill prerequisites** apply only when necessary for a particular challenge. Quantity comparison can start with matching objects without requiring fluent counting. A numeral task would require a different representation and should not silently replace a visual-quantity task.

Difficulty has several dimensions: set size, spacing, distractors, vocabulary, number of choices, number of remembered steps, amount of support, and abstraction. Change one dimension at a time when interpreting pilot results. Do not reduce them to one opaque difficulty number.

## Evidence categories

| Observation | Meaning | Consequence |
| --- | --- | --- |
| Demonstration / answer supplied | The tutor showed or said the solution | Instruction only; never independent success |
| Supported response | The child succeeded with a substantive cue | Keep support type and depth; offer a fresh opportunity |
| Independent response | No answer-relevant cue was supplied for that attempt | Useful task evidence; not automatic mastery |
| Independent self-correction | The child repaired an answer before substantive feedback | Retain the sequence; avoid treating the initial response as the final outcome |
| Incorrect, interpretable response | The response is clear and mismatches the authored task | Offer bounded support; do not infer a diagnostic cause |
| Unclear / unverified | Speech, vocabulary, scene, or attribution prevents interpretation | Clarify or move on; do not record a skill failure |
| Skipped / stopped | The child did not complete the opportunity | Preserve agency; no failure label |

Tag practiced examples, fresh equivalent examples, and delayed retrieval separately. Also retain the presented scene/word set, actual support delivered, parent help, and whether the response preceded tutor feedback. Neutral repetition of the full prompt is not necessarily substantive teaching, but should still be recorded because it can affect memory tasks.

## Moving forward

For the pilot, **two fresh independent responses at a defined challenge level can justify offering an optional adjacent challenge**. This is a conservative product heuristic, not a validated mastery threshold. Two-choice successes remain vulnerable to guessing. Retain each observation and avoid reporting a percentage-mastery score.

An uncertain skill can remain a review candidate while other experiences stay available. Failed comparison does not lock rhyme, and support in counting does not require repeating the same lesson indefinitely. An introductory supported version can remain eligible even when an independent challenge is not a good recommendation.

## Simple recommendation policy

1. Determine **eligible experiences** from interaction access and genuine prerequisites. Do not exclude solely by age or a missed answer.
2. Offer up to **three recommended choices**, when available: an appropriate new experience, a useful practice/review opportunity, and a different-domain exploration.
3. Prioritize review when interpretable observations show support dependence, uncertain transfer, or a relevant prerequisite worth revisiting. Recency alone does not prove forgetting.
4. Use the child's expressed interest, recent exposure, and variety to rank otherwise suitable choices. Avoid always showing the easiest activity.
5. The child or parent chooses the **selected experience**. Declining a review is allowed. Explain recommendations in ordinary terms, such as “another way to compare groups.”

A small curated list and explicit rules are sufficient for the pilot. There is no need for a generalized scheduling system.

## Worked example across visits

| Occasion | Observation | Next action |
| --- | --- | --- |
| Visit 1: Picnic | Child selects the larger group only after object pairing; a fresh comparison is unclear | Store supported NUM-02 evidence and uncertainty separately; offer Radio or another suitable activity |
| Visit 2 | Picnic appears as an optional review beside Shape Workshop and Radio | Child may choose any; no compulsory remediation |
| Visit 2: review selected | New 2-versus-3 arrangement, no pairing or pre-counting; child chooses correctly | Record fresh independent evidence; do not erase prior support history |
| Later visit | A new comparison is attempted again | Record elapsed time, representation, and support as delayed retrieval evidence |
| Any review | Child disengages or two bounded support cycles remain inconclusive | End the probe and allow another activity; keep the observation inconclusive |

Review changes the example while preserving the intended comparison. It is not simply repeating the last wrong question, nor a claim that the child forgot because time passed.

## Minimum shared and domain boundary

Based on [issue #16](https://github.com/hurley87/sprout/issues/16) and the existing [architecture notes](05-technical-architecture.md); no implementation audit is implied.

| Shared application responsibility | Experience-specific authored material |
| --- | --- |
| Session start/stop/recovery and speech handling | Objective, representation, and valid item bank |
| Active scene/challenge identity and authoritative transitions | Which objects/words are presented and permitted responses |
| Observation records and delivered-support provenance | Evaluation contract, acceptable variants, and domain uncertainty |
| Parent recap infrastructure | What can truthfully be summarized for this skill |
| Eligibility/recommendation plumbing | Entry requirements and allowed next challenges |
| Rendering and conversational interfaces | Scene behavior, hint ladder, and control of error |

For comparison, the minimum new content is two explicit sets, a relation question, and a set-selection/relation answer contract. For rhyme, it is a reviewed spoken-word bank, pronunciation/label handling, and a closed selection contract. A mixed-skill shop needs explicit per-challenge targets; nonnumeric answers must not be hidden inside counting data.

The application owns learning state, accepted responses, and progression. AI may vary bounded conversational wording; it may not invent instructional items, redefine evidence, or promote skills. Reuse existing infrastructure before introducing abstractions; generalize only from demonstrated needs.
