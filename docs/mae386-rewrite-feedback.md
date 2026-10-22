# Q10 spoken meaning feedback

One bounded follow-up to parent `94e2e227b10edde511e63dfcda25a2fb46026906`.

The checked-in human microphone extract
`docs/evidence/mae386-live-2026-10-21-c7d94b28.json`, original events 6206 and
6341, records Q10-3: “He uses habits, heuristics, and external scaffolds, to
think.” The tutor nevertheless says it keeps the meaning and trims extra words.
The final recap stays unresolved; meaning judgments of incorrect at .61 and .52
remain below the existing acceptance threshold. The original Downloads JSON was
unavailable in this checkout session; this confirmation uses the checked-in
extract and `docs/mae386-demo-validation.md`.

Provider context is not universally missing the rubric. `createLiveSessionConfig`
serializes the initial node's complete context, including criterion descriptions;
starting at Q10 would carry those requirements. MAE386 normally starts at Q1.
Subsequent speech updates use `mae386TeachingInstruction`, whose Q10 focus was
generic. Assessment requests independently carry the current sentence criteria.

Each Q10 unit now supplies a compact private preservation cue to the actual
spoken scene update. Q10-3 explicitly covers toolkit composition, all three
categories and building for thinking; use alone is insufficient. Shared Q10
feedback guidance compares retained/omitted meaning before praise, names one gap
or asks one clarification for lost/unclear meaning, and accepts paraphrases.
No reference solution is supplied. Feedback stays brief and criteria stay private.
Closure wording is compressed to retain the existing append budget; settled
discussion and explicit navigation still permit closure without mastery.

Assessment thresholds/policy, proposal selection/withdrawal, attribution,
recovery/help and frozen recap logic are unchanged. Deferred attribution
limitations and full issue #76 acceptance remain outside this fix.

Provider-free regressions check all three delivered sentence cues, missing-meaning
feedback guidance, paraphrase acceptance, reference-example privacy, full initial
context and browser scene-update delivery. They verify instruction contracts and
transport, not the provider's semantic judgments or generated speech.

Fresh human microphone validation remains required. In separate fresh Q10-3
attempts, compare a complete shorter paraphrase retaining composition and building
for thinking against “He uses habits, heuristics, and external scaffolds, to
think.” Expect brief specific acknowledgment for the valid revision; for the
meaning-changing revision, expect a targeted gap/clarification without blanket
meaning-preservation praise or a supplied solution. Allow next/skip/stop normally;
inspect exported speech and frozen outcomes separately. Also spot-check Q10-1
causal reversal and Q10-2 “They worked on the project” against valid paraphrases.
Do not equate tutor approval with independently demonstrated assessment evidence.

Validation: 1,872 provider-free unit tests, ESLint, Next type generation plus
TypeScript, production build, changed-file formatting and diff whitespace checks
pass. Offline `o200k_base`/`cl100k_base` recalibration changes only the three Q10
teaching messages. The maximum is 393 proxy tokens and 1,984 bytes, below the
unchanged 450-token/2,000-byte regression caps and documented 500-token append
limit. These counters are proxies, not an exact provider token count.
