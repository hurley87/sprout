# Issue #47, commit 4: acknowledgment variation and help provenance

## Scope

This slice varies completed-count acknowledgments with bounded, pre-rendered audio, keeps child-directed prompts grounded in the currently displayed scene, and records uncertain generated-help evidence for conservative review. It does not add a production instructional-help playback route; production audio requests use the acknowledgment role.

## Acknowledgment assets

Five versioned alternate WAVs are paired with the existing five baseline acknowledgments. Stable answer identity selects the baseline or alternate, so replaying the same answer identity keeps its text and audio while different identities can vary. Startup preflight validates the finite catalog. No per-answer TTS generation is used during a session.

All alternate audio was generated with `gpt-4o-mini-tts` (`marin`), mono 16-bit PCM at 24 kHz. Each sentence was independently transcribed with `gpt-4o-transcribe` and compared with the catalog text. The motion sentences are explicitly imaginative and do not assert unobserved scene activity.

| Asset | Catalog sentence | Render SHA-256 | Final WAV SHA-256 | TTS request |
| --- | --- | --- | --- | --- |
| `hello-duck-variation.wav` | You found that little duck! What a careful count. | `5fa29573cd5d9a42f644511c41e105fec0c96a52903bddc47b249b7625d8d0d3` | `5f9aa14d779e1b99b997f64f4f7d609ff603d24216757be09beb5d4c906fd8c2` | `req_c36d89154d024dd3b0de04feba27ff3c` |
| `duck-friends-variation.wav` | Those two ducks make a fine team! | `c141ca994664a5f5b2d563ab01d024f398bcbb5be9c03ee1840e88c9bfa89b26` | `83bc854c75e5734ca5cd61176ebf80751313112d7a740e1a3aa6ba27414293f3` | `req_41d0342044f54d92a90b104d6cb5298b` |
| `butterfly-garden-variation.wav` | You counted three butterflies! Imagine they are playing follow-the-leader! | `ea603d270e2bcd235d8b64e0cfc57ae5143fffcdb363c3a8932c22c6593a5490` | `02981933e57a132799872f39a3ce3f8715e052ea6f9add52cd9b9dd737bed720` | `req_27c22860aaa648a9a057ee6fd754a35c` |
| `picnic-variation.wav` | You counted those strawberries so carefully! | `dfaad125646aebf1ca155709bc3c883814364100bfd20f0bf34ef4492e877057` | `8fce9c0fa265fcb2ef5eb7ffede893a0401d1334b4bfd43fd12c4d598591ccac` | `req_2e08201228884887a3ec5fd04e44b7fd` |
| `pond-variation.wav` | You counted four ducks! Imagine they are waddling in a parade! | `fb059057dee304a2aed9e11ef5ca30b6f5778271bcb4a68a3421592b72e1c719` | `88137c915a084bff571362d826c2097bb201b96fa0c3b1b961445df98c0065c9` | `req_927e92b655044a79a84d8970001164aa` |

## Prompt and evidence boundaries

Scene context identifies the current object and confirmed count, asks for one short varied question about the displayed group, and avoids revealing another scene's count. Instructional help is classified separately from neutral clarification; actionable help wins when a transcript includes both. Candidate transcript text and provider observation time are not proof of heard speech or acoustic order. Delivery and display association are recorded separately, including unknown/changed states. Neither a missing candidate nor a provider transcript alone establishes independence or completed support. Parent review shows the candidate and recording context without presenting the transcript as confirmed speech.

## Verification

- Unit tests: `npm test` (final run recorded with this commit's checks).
- TypeScript and generated route types: `npm run typecheck`.
- ESLint: `npm run lint`.
- Default Chromium suite: `npm run test:browser` — 131 passed.
- Transport Chromium suite: `npx playwright test --config=playwright.transport.config.ts` — 52 passed.
- Production build: `NEXT_PUBLIC_CONVEX_URL=https://synthetic-public.convex.cloud npm run build` passed. The value was synthetic; no deployment was performed.
- Catalog and delivery-candidate focused tests cover stable asset selection, transcript and delivery distinctions, source/display capture at transcript arrival, invalid Convex event rejection, and conservative observation handling.

## Remaining human review

Automated browser playback and audio-file checks do not establish voice quality on a physical device, intelligibility in the intended room, or perceived continuity across baseline and alternate clips. Those listening checks remain for parent review. Transcript and scene timing remain approximate evidence; the recording is needed to assess actual delivery.
