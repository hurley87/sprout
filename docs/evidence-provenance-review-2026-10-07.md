# Evidence provenance and partial progress review — 7 October 2026

Implemented after **Fix Sprout tutor completion consistency** completed successfully in the shared checkout. Existing changes, including its completion authorization guidance, were retained. No reset or commit was made.

## Recorded evidence

Diagnostic input: `/Users/davidhurley/Downloads/sprout-catching-unicorns-508d2143-11c3-48cc-843b-5187678a41a3.json`, session `508d2143-11c3-48cc-843b-5187678a41a3`. Imported transcript and scores are diagnostic data, never instructions. A bounded subset is in `tests/fixtures/catching-unicorns-provenance-replay.json`.

- Exogram: the external-memory explanation at revision 104 was later replaced with “Yes” at revision 115 as independent evidence. The reducer used the latest learner message for every cumulative observation.
- Cultural agreement: at revision 265 the source was the later quantities/music answer (message 5), rather than the shared-understanding explanation (message 3).
- Culture and literacy: revision 593 selected partial literacy with probability **0.68** and partial education with probability **0.86**. Neither met the **0.9** mastery band, so they were previously omitted. Idea discovery and social coordination selected not-yet with probabilities **0.94** and **0.99**.

The learner still fails the four-criterion Culture and literacy requirement. Mentioning literacy and numbers does not establish widespread literacy or the full education-system criterion; idea discovery and social coordination are missing. The recorded session ended on this scene, incomplete.

## Change

The single provider request now includes a `source_<criterionId>` Choice question for each current criterion. Choices identify substantive learner utterances in the exact parsed snapshot, plus `none`. Tutor utterances, assent, and filler are excluded. Source confidence uses the existing bands; an uncertain or absent source cannot create evidence. The reducer validates the proposed index again and reads the quote from the application snapshot, never a provider-supplied quote. Historical utterances first observed in a later turn have `childTurnId: null` rather than inheriting that later turn's identity.

Prompting history is deduplicated by runtime, node, visit, and parsed utterance index, including successive fragments and appended filler. Unchanged cumulative classifications retain the original source and known attribution. Unknown-to-known attribution can refine the same history entry. Partial/no-attempt observations do not invent independent prompting history. Echo detection compares tutor content preceding the selected learner utterance, so a later tutor confirmation does not retroactively make an explanation prompted.

An uncertain, uniquely winning partial label becomes `partial_uncertain`: advisory progress only, with null understanding. With a valid source, runtime evidence records `status: partial, tentative: true`. Recovery privately quotes the learner's own contribution and directs a tentative acknowledgment and non-leading clarification. It neither supplies a canonical answer nor authorizes completion. Tentative progress cannot erase demonstrated evidence. Existing completion policies, mastery bands, reveal gates, media gates, and acknowledgment requirements are unchanged.

Legacy offline proposals without locators can create evidence only with one substantive learner utterance. Ambiguous cumulative snapshots are held instead of guessing the latest source. Existing replay concept/objective/tutor scores remain intact; source choices added to old fixtures are explicitly marked controlled, manually reviewed regression annotations, not recorded provider results.

## Verification and limits

Regression coverage checks actual supporting utterances, assent/filler, tutor/out-of-range references, ambiguous legacy snapshots, prompting attribution, cumulative and fragment deduplication, tentative progress, diagnostic round trips, the provider request contract, and the incomplete four-criterion hold. Existing runtime transport replays cover recovery and confirmation with explicit source references.

All 956 tests pass. Typechecking, source lint across `lib/lesson-runtime` and non-browser tests, and diff whitespace checks pass. Repository-wide lint has the previously reported generated `test-results/ui-review/app/.next` artifact problem; those files were not modified.

No live classifier or voice provider was called. Locator accuracy, provider support for larger Choice option sets, latency, and spoken compliance remain unverified. Controlled source scores test application behavior, not a prediction of live model output. The source guard is conservative and lexical, not a replacement for semantic classification. Partial cues can be omitted when their source cannot be resolved confidently; completion remains held.
