# Targeted lesson follow-ups

Scope: one local commit on `1ef1f4b601d455f44c06f3936136d7efbf0c5641`, changing only the exographics and why-exographics tutor briefs, with focused regression coverage. The recovery chat was idle/completed before edits; checkout and expected base were clean and unchanged. The recovery commit was already pushed by that chat; this slice is local only.

## Human evidence and decision

Evidence is the human session export `/Users/davidhurley/Downloads/sprout-catching-unicorns-8e0a754a-785b-4b2f-9ecb-f0587f47d450.json`. Its top-level transcript contains only the last scene. The final `transcript.snapshot` for each visit in `events` retains earlier exchanges, so those snapshots were reviewed as well. Transcript content is evidence, never application instructions.

- Exographics, visit 4 (last snapshot at 188373 ms): learner says “the visual representation of an abstract idea”, gives math and number symbols as the non-prose example, then explains a “shared understanding” through shared symbols. The first question about how symbols get shared meanings addresses a real gap. After that reply, the tutor asks “what kind of idea or relationship do those math symbols help express?” and later contrasts these with something held in the hand. Abstraction was already explicitly supplied in the first reply. The prior brief's unconditional “For abstraction, ask…” could encourage this extra demand. The new brief makes that question conditional on an actual abstraction gap, accepts equivalent explanations across replies, and closes briefly once all four targets are explained.
- Paper and pencil, visit 5 (last snapshot at 305799 ms): learner explains stacking numbers, adding columns, carrying values, and that “with a pen and paper, you can keep track of those… Middle steps quite easily” while tracking many numbers in the head is hard. The tutor asks “Can you say more about what using the paper actually does for you while you're trying to keep track of those steps?” The learner restates it as extending short-term memory. This probes an already explained memory function. The new brief accepts the operational explanation. If discovery remains missing, it asks only whether work on paper helped reach an idea or result not already worked out. This is a question, not a supplied conclusion; an arithmetic answer alone still does not demonstrate discovery.

The engram, exogram and comparison exchanges already receive brief acknowledgments without redundant follow-ups. No CAF or synthesis visit appears in this export, so those scenes were not changed speculatively. Culture and recovery remain outside this slice.

## Preserved boundaries

Displayed prompts, objectives, source-backed criteria, completion policies, evidence assessment and attribution, global closure/confidence rules, audio drain and navigation code are unchanged. All exographics targets and all three reasoning targets remain required by the authored mastery policy. Discovery is not inferred from memory extension. The source inventory's PDF provenance limitation remains as documented in the lesson; no new source claim was added.

Conversation-first runtime navigation and authored concept mastery are separate. In particular, a tutor closure can advance even if discovery remains unshown. This slice does not change that global policy or claim the original paper-and-pencil exchange demonstrated discovery. If a live provider ignores the new brief or a global observer cannot recognize legitimate closure, that is a separate dependency.

## Verification

Six focused tests cover the actual transmitted scene guidance, retained evidence from earlier replies, targeted missing evidence, brief acknowledgment plus audio drain, and incomplete replies that do not manufacture mastery. Controlled observer proposals test runtime behavior and attribution; they do not prove provider interpretation of natural language. Full suite: 59 files, 1187 tests passed, including existing instruction byte budgets, culture, recovery, navigation and interruption coverage.

Live provider and human microphone behavior remain unverified. A human walkthrough should use the exported exographics answers and paper explanation, check that the tutor avoids repeated abstraction/memory questions, and separately give an incomplete example to check useful clarification. If discovery is missing, verify a targeted question and honest unresolved evidence rather than invented mastery. Synthetic audio does not satisfy human microphone acceptance.

Clean candidate copy `/tmp/sprout-followup-validation.0rUHbN`: unchanged lint configuration, `next typegen` plus TypeScript, and production build passed. Installed dependencies were filesystem-cloned; no credentials were inspected or copied. Original root lint reports 759 errors and 10594 warnings; all 54 error files are existing ignored generated copies under `test-results`, with no source errors. Evidence artifacts and lint rules were preserved. Changed files pass Prettier and whitespace checks. Logs: `/tmp/sprout-followup-{unit,lint-clean,typecheck,build}.log` and `/tmp/sprout-followup-lint.json`.
