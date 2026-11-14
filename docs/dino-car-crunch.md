# Dino Car Crunch

`/dinos` is a voice-first tens-plus-ones adventure: Rex eats cars counted by the learner. Append `?debug=1` to show diagnostics and export them.

| Node | Scene | Answer |
| --- | --- | --- |
| `warm-up` | 3 cars + 4 cars | 7 |
| `twenty-three` | 2 trucks of 10 + 3 cars | 23 |
| `forty-two` | 4 trucks of 10 + 2 cars | 42 |
| `fifty-six` | 5 trucks of 10 + 6 cars | 56 |
| `thirty-five` | 3 trucks of 10 + 5 cars | 35 |
| `twenty-nine` | 2 trucks of 10 + 9 cars | 29 |

The 30s come after 20, 40 and 50 because “thirteen” and “thirty” are easy to mishear; the learner and classifier have time to settle in first. The hint path counts on from the tens and stops before the total, leaving the child to answer.

Only the lesson reducer accepts an answer. The stage follows the resulting `motion` to chomp; sounds are requested through the runtime effect gate. Tutor words alone do not authorize a chomp.

## Assets and sources

The PNG/JPG art in `public/dinos/` is original artwork generated for this project with ChatGPT image generation from written prompts, then trimmed and cropped. Rex's poses share one crop box; truck parking spots were measured into `app/dino-art.ts`. There are no licensed characters or third-party artwork. Issue #117's suggested `rex-closed`, `rex-open`, `car.png`, `truck.png` and `car-park.jpg` names were superseded by three Rex poses, three car colours, a carrier truck, and road and empty car-park backgrounds.

The sounds are synthesized by `scripts/generate-dino-sfx.mjs`:

- Crunch: three rapidly decaying bursts of seeded noise through a low-pass filter make a soft cartoon chomp.
- Horn: two short, gently enveloped pairs of sine tones make a friendly toy truck beep-beep with harmonic warmth.
- Truck rumble: a low sine and heavily filtered seeded noise fade in and out like a soft engine.
- Success: a rising C-E-G-C sequence of softly decaying sine tones overlaps into a rounded arpeggio.

Run `node scripts/generate-dino-sfx.mjs` to regenerate the WAV files, or pass an output directory as the first argument. A fixed seed, 22050 Hz mono 16-bit PCM, peak normalization and end fades make output deterministic.

## Mic safety

An effect opens a window for its duration plus `EFFECT_TAIL_MS` (1200 ms), allowing for room echo and the local detector's 900 ms quiet period. During the window microphone activity is logged as `microphone.ignored_effect` and does not reach the reducer; provider input tracks are also suspended. The gate refuses effects over tutor output, child speech or a candidate, outside active or complete phases, during another effect, or for invalid durations. Browser echo cancellation is not relied on. The 2.2-second scene hold lets the chomp and crunch window finish before the next scene.

The trade-off is that child speech during the roughly 1.7–2 second window after an effect is ignored. Effects occur at scene arrivals and during the chomp. The finale's success sound is the exception: completing the lesson stops the session, which closes the microphone and tutor audio, so it plays without a window (the stage marks it with `data-finale-sound`).

## Known limitations

- **Late provider transcripts.** The window ignores microphone events but not provider input transcripts. With input tracks suspended the provider hears silence, so none should arrive; but a browser test that injected an input transcript during the crunch window left the lesson waiting on the answered scene. Watch for a stall after a chomp during the #118 live run.
- **Portrait sizing.** The stage reserves room for 5 trucks and 9 loose cars in every scene, so in phone portrait Rex and the cars are small (truck cars about 23 px wide at 390 px). Prefer a tablet or a landscape phone for the playtest.

## Validation and phone check

Provider-free browser tests use synthetic microphone audio and a local peer; they do not prove room acoustics or live recognition. For [#118](https://github.com/hurley87/sprout/issues/118), on the real phone set the volume to full, open `/dinos?debug=1`, and play through the scenes with a parent supervising. Use **Export diagnostics** in the developer diagnostics panel. Inspect each `effect.started` to `effect.ended` window for `microphone.ignored_effect` when sound is picked up, and verify there is no `child.turn.started` within it. Check that speech works again after the window and record the device and result.
