# MAE386 evidence provenance

The three October 21, 2026 historical microphone diagnostic extracts are retained
locally in `.sprout-evidence/mae386-historical-2026-10-21/` at the repository root,
which is ignored by Git. They were copied byte-for-byte and their SHA-256 hashes
verified before removal from tracked `docs/evidence/` files. These local copies
are not distributed by a fresh clone; request them from the developer who
retained the run when investigating the original diagnostics. Keep future full
session exports in `.sprout-evidence/`, and commit only curated regression inputs
or bounded replay results. The targeted live-export ignore rules leave regression
fixtures and `mae386-*-replay-*.json` evidence eligible for tracking.

This cleanup verifies artifact bytes only. It does not revalidate historical
recordings, rerun microphone acceptance, or change their recorded outcomes or
limitations. The files below are scrubbed extracts, distinct from the larger
original downloaded exports whose identities are retained separately.

## Locally retained historical extracts

### `mae386-help-live-2026-10-21-a04fe1f9.json`

- Local path: `.sprout-evidence/mae386-historical-2026-10-21/mae386-help-live-2026-10-21-a04fe1f9.json`.
- Extract bytes: `135233`; SHA-256: `9ed40cd190c40b0f144e3a4750f1a4c2da780d34280d2ee327ad5f003ce42d9b`.
- Historical UTC interval: `2026-10-22T00:29:46.442Z` to `2026-10-22T00:31:43.938Z`.
- Tested code SHA: `7a87b3664de5f0f44d28ee8e0d2fabcc8f430c5e`.
- Original downloaded export: `/Users/davidhurley/Downloads/sprout-mae386-a04fe1f9-1932-4e7b-9a9e-ba147b04aa34.json`.
- Original export bytes: `3989621`; recorded SHA-256: `c4f505fc6c4c308d79b2f51695c48b4be80a5218fac3e87919e5ce88295b19ea`.

### `mae386-live-2026-10-21-c7d94b28.json`

- Local path: `.sprout-evidence/mae386-historical-2026-10-21/mae386-live-2026-10-21-c7d94b28.json`.
- Extract bytes: `753849`; SHA-256: `bf261c610b79a0e3a861beb3821dfa32539c49553e39262e3a71c31d65dc517f`.
- Historical UTC interval: `2026-10-21T19:49:55.577Z` to `2026-10-21T20:03:38.808Z`.
- Tested code SHA: `918fccbc5ffbc1df2b3146bf6ddab06023048f20`.
- Original downloaded export: `/Users/davidhurley/Downloads/sprout-mae386-c7d94b28-b76b-4ed1-9493-d008cb58d2d9.json`.
- Original export bytes: `191872443`; recorded SHA-256: `0087844c0cde63217c2d4900ed337eb6e752b4f5d0daae902539a96edf6eb227`.

### `mae386-recovery-live-2026-10-21-8d390e19.json`

- Local path: `.sprout-evidence/mae386-historical-2026-10-21/mae386-recovery-live-2026-10-21-8d390e19.json`.
- Extract bytes: `146374`; SHA-256: `e6e457502d588c2772b723c139bdf4e0a913c06aefcd55fc83719fe21c447dfc`.
- Historical UTC interval: `2026-10-21T20:24:21.073Z` to `2026-10-21T20:26:51.042Z`.
- Tested code SHA: `4bfc6356d3af7c8fec6f78ee24738d5ff13324b4`.
- Original downloaded export: `/Users/davidhurley/Downloads/sprout-mae386-8d390e19-8cb9-4278-8b0f-296c596e86f4.json`.
- Original export bytes: `6702407`; recorded SHA-256: `747daff5e05a0f984bb1dcd7e4322f6219948b45afe25c24352ec1d5c1e78397`.

Original downloaded-export paths and hashes above are historical provenance;
this cleanup checked the retained extracts, not the availability or hashes of
those separate Downloads files. The human-run reports retain their observations
and limits: [initial run](../mae386-demo-validation.md),
[recovery](../mae386-recovery-expiry.md), and [help](../mae386-help-response.md).

## Regression coverage and replay boundaries

- `tests/fixtures/mae386-source-block-2026-10-21.json` preserves the exact Q6
  transcript and classifier outputs at original event 2118, revision 207, from
  the initial extract above. `tests/mae386-source-block.test.ts` now loads this
  bounded fixture instead of the whole diagnostic extract. Its assertions are
  unchanged. New source-locator responses in those tests are synthetic mocks;
  they do not establish provider improvement or fresh microphone acceptance.
- `tests/fixtures/mae386-evidence-2026-10-22.json` and the other existing regression
  fixtures remain unchanged. They retain curated historical text and outputs;
  deterministic tests establish application behavior for those inputs.
- `mae386-evidence-replay-2026-10-22.json` and
  `mae386-q6-replay-2026-10-22.json` remain tracked and unchanged. These record
  Jev text replay results, not new microphone observations. Text replay does not
  exercise capture, speech timing, tutor delivery or the full live session.
