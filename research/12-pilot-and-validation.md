# Sprout — First Catalog Pilot

**Date:** 2026-11-03. **Status:** proposed formative pilot, not an efficacy study. No participant data or test results exist in this deliverable.

## Questions

1. Can children understand and enjoy a short purposeful activity?
2. Can the app reliably interpret their contributions?
3. Does provided support help on a fresh equivalent example?
4. Is the experience appropriate across the proposed age range?
5. Do children choose to return after the novelty of the theme?

## Before child sessions

- Have an early-childhood educator review the three [worked experiences](10-experience-catalog.md) for vocabulary, representations, and evidence claims.
- Run adult/provider-free checks for every authored item, answer, hint, transition, stop, and recovery path. These do not establish child usability or live-speech reliability.
- Check actual rendered scenes and spoken audio for accidental answers, ambiguous objects, emphasis cues, and reduced-motion behavior.
- Implement the common session/evidence measurement required by [#19](https://github.com/hurley87/sprout/issues/19) before the first new-domain experiments. The existing counting prototype is the baseline. Documentation work need not wait for instrumentation.
- Use caregiver permission and supervised sessions under the product's existing privacy process. This proposal does not introduce a new recording requirement. Do not collect birthdates or gender solely to rank experiences; age band and volunteered interests are sufficient for this formative design question.

## Suggested small sample

Recruit approximately **6–9 families**, aiming for a spread across ages 3, 4–5, and 6 rather than a representative sample. Include varied interests and communication backgrounds where the current prototype can support participation. This sample size is a planning choice for discovering usability problems, not a statistical power calculation.

Do not require each child to try every experience or fill a demographic quota before learning from the first sessions. Document who the pilot did and did not serve.

## Session sequence

1. Caregiver describes relevant familiarity with the task and language. Avoid coaching the target answers.
2. Adult sets up the device and remains available. Check an easy, non-target spoken choice.
3. Child chooses an eligible experience. Start with counting; run comparison and then rhyme as separate domain experiments once ready.
4. Observe the initial attempt where available, delivered support, and a fresh example. Do not force an unproductive sequence to finish.
5. End naturally. Ask whether the child wants to stop or try something else without pressure.
6. On a later visit, offer a new-context review among other choices. A return roughly 2–7 days later is a practical pilot window, not an optimized spacing schedule. Record actual elapsed time and whether the opportunity was offered.

The three worked cards have bounded teaching variants. Preserve the existing seven-round concert specification as its own condition; do not pool a shortened teaching version with it without labeling the difference.

## Observation sheet

One row per meaningful challenge; reuse existing evidence records where possible.

| Field | Record |
| --- | --- |
| Context | Pseudonymous participant reference, age band, language context, experience/version, session |
| Opportunity | Skill, item/scene ID, representation, practiced/fresh/delayed, time presented |
| Initial response | Interpretable response, uncertainty, or no response; no diagnostic inference |
| Support | Repetition, hint, demonstration, caregiver assistance; delivered rather than merely planned |
| Follow-up | Response on same or new item, assistance, self-correction |
| Interaction | Misheard answer, false correction, answer giveaway, interruption, recovery |
| Ending | Child stop, parent stop, planned completion, technical failure, optional continuation |
| Session totals | Duration, useful opportunities, provider usage/cost where measured |

Keep observer interpretation separate from application evidence. “Seemed bored” is a hypothesis; “declined another round and asked to stop” is an observation.

## Decisions after the pilot

| Finding | Decision |
| --- | --- |
| Repeated misunderstanding of the task | Rewrite instructions or representation before adding content |
| Repeated speech/classification failures despite clear child intent | Fix interaction reliability; do not lower the child's skill estimate |
| Supported success without fresh independent evidence | Revise the teaching move or transfer task; retain uncertainty |
| Fresh independent success on first exposure | Consider a harder suitable entry point; do not claim the lesson caused learning |
| Purposeful participation and interpretable new-example responses recur | Continue testing the experience; add a few controlled variants |
| One age band consistently needs more help or finds content too easy | Reconsider its entry design and audience claim |
| Child declines return | Explore interest, difficulty, setting, and interface; do not assume a single cause |

Small samples can identify promising designs and recurring problems. Claims about learning gain, broad transfer, age suitability, or improved executive function require stronger evaluation. Report completion, enjoyment, independent performance, later retrieval, and delivery cost separately.
