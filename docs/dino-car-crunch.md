# Dino Car Crunch

`/dinos` is a voice-first tens-plus-ones adventure: Rex eats cars counted by the learner. Append `?debug=1` to show diagnostics and export them.

Hosted runs save a diagnostics report when the lesson ends if session saving is enabled. See [Saving test sessions](../README.md#saving-test-sessions).

| Node | Scene | Answer |
| --- | --- | --- |
| `warm-up` | 3 cars + 4 cars | 7 |
| `twenty-three` | 2 trucks of 10 + 3 cars | 23 |
| `forty-two` | 4 trucks of 10 + 2 cars | 42 |
| `fifty-six` | 5 trucks of 10 + 6 cars | 56 |
| `thirty-five` | 3 trucks of 10 + 5 cars | 35 |
| `twenty-nine` | 2 trucks of 10 + 9 cars | 29 |

The 30s come after 20, 40 and 50 because “thirteen” and “thirty” are easy to mishear; the learner and classifier have time to settle in first. The hint path counts on from the tens and stops before the total, leaving the child to answer. If the child misses again, the tutor does not repeat the count; it asks what comes after the last ones number (“What comes after one?”), then “So after forty-one comes…?”

Only the lesson reducer accepts an answer. The stage follows the resulting `motion` to chomp; sounds are requested through the runtime effect gate. Tutor words alone do not authorize a chomp.

## Two-digit answers

In one local live session, the child answered the warm-up and the first two truck scenes correctly. On the next scene, after a wrong answer and a count-on hint, the child counted on and paused within a two-digit number. GPT-Live ended the turn at the tens word; the tutor said “Yes,” before the child finished the ones. The classifier abstained and the app asked for a repeat. GPT-Live transcribed the two-digit answers as hyphenated words; this session did not show a teen/-ty mishearing.

The lesson alone opts into a deterministic reader and server-side check after the classifier. The reader finds the latest child-owned number, including counting on, corrections, pauses and a short tutor interjection. The check vetoes a proposed correct answer if the reader disagrees, and rescues an abstained or unclear decision only when the child clearly supplied the matching answer. It never rescues a confident incorrect, no-attempt or unresolved-help judgment. The reducer remains responsible for acceptance. Tutor guidance now asks for silence while the child counts or pauses at a tens word, including after a hint, and prohibits praise or confirmation until a complete number is finished.

The reader also joins counting on said with bare ones ("twenty, one, two, three" is 23). Ownership follows the child's first attempt at the answer: a number is an echo only when the tutor said it before the child first tried it. A tutor talking over a child mid-number ("fifty" / "Yes! Fifty-six" / "-six") does not take the answer away, and neither do the tutor's later confirmations; a live session stalled on fifty-six that way. When the tutor did disclose the answer first, one repeat stays an echo, but the child's second separate repeat is accepted as `assisted` (`diagnostic.spokenNumber.action`), so a tutor slip cannot trap the child on a scene. It is still never accepted over a confident incorrect, no-attempt or unresolved-help judgement. GPT-Live-1.1 still sometimes says "Yes" or the total at a tens word despite the tutor guidance.

Unnormalised pronunciations such as “firty-five” remain unresolved and the tutor asks again; they are not silently interpreted as the target. Teen/-ty recognition still needs more live data in #118. This repository documents local VAD but no GPT-Live `gpt-live-1` turn-detection, VAD or eagerness tuning field in the session configuration; investigate supported provider tuning as a follow-up rather than assuming an API setting.

In `/dinos?debug=1`, export diagnostics and inspect classification entries for `diagnostic.spokenNumber`: `action` is `agree`, `veto`, `rescue`, `assisted` or `none`; `reader` describes the parsed number, ownership and status; `classifierOutcome` records the original proposal outcome (or null for an abstention). The exported provider scores remain the original scores, including when a rescue occurs.

## Assets and sources

The PNG/JPG art in `public/dinos/` is original artwork generated for this project with ChatGPT image generation from written prompts, then trimmed and cropped. Rex's poses share one crop box; truck parking spots were measured into `app/dino-art.ts`. There are no licensed characters or third-party artwork. Issue #117's suggested `rex-closed`, `rex-open`, `car.png`, `truck.png` and `car-park.jpg` names were superseded by three Rex poses, three car colours, a carrier truck, and road and empty car-park backgrounds.

The sounds are synthesized by `scripts/generate-dino-sfx.mjs`:

- Horn: two short, gently enveloped pairs of sine tones make a friendly toy truck beep-beep with harmonic warmth.
- Truck rumble: a low sine and heavily filtered seeded noise fade in and out like a soft engine.
- Success: a rising C-E-G-C sequence of softly decaying sine tones overlaps into a rounded arpeggio.

Run `node scripts/generate-dino-sfx.mjs` to regenerate the WAV files, or pass an output directory as the first argument. A fixed seed, 22050 Hz mono 16-bit PCM, peak normalization and end fades make output deterministic.

## Mic safety

An effect opens a window for its duration plus `EFFECT_TAIL_MS` (1200 ms), allowing for room echo and the local detector's 900 ms quiet period. During the window microphone activity is logged as `microphone.ignored_effect` and does not reach the reducer; provider input tracks are also suspended. The gate refuses effects over tutor output, child speech or a candidate, outside active or complete phases, during another effect, or for invalid durations. Browser echo cancellation is not relied on. The 2.2-second scene hold lets the chomp and crunch window finish before the next scene.

The trade-off is that child speech during the roughly 1.7–2 second window after an effect is ignored. Effects occur only at scene arrivals; the chomp is silent (a generated noise crunch was removed as harsh). The finale's success sound is the exception: completing the lesson stops the session, which closes the microphone and tutor audio, so it plays without a window (the stage marks it with `data-finale-sound`).

## Known limitations

- **Late provider transcripts.** The window ignores microphone events but not provider input transcripts. With input tracks suspended the provider hears silence, so none should arrive; but a browser test that injected an input transcript during an effect window (then the chomp's crunch, since removed) left the lesson waiting on the answered scene. Arrival sounds still open windows, so watch for a stall at scene arrivals during the #118 live run.
- **Portrait sizing.** Rex and the cars stand together on the road edge, sized to the scene, with the warm-up's first and joining cars as two separate groups. In phone portrait the five-truck scene is still small (about a fifth of the width per truck). Prefer a tablet or a landscape phone for the playtest.

## Validation and phone check

Provider-free browser tests use synthetic microphone audio and a local peer; they do not prove room acoustics or live recognition. For [#118](https://github.com/hurley87/sprout/issues/118), on the real phone set the volume to full, open `/dinos?debug=1`, and play through the scenes with a parent supervising. Use **Export diagnostics** in the developer diagnostics panel. Inspect each `effect.started` to `effect.ended` window for `microphone.ignored_effect` when sound is picked up, and verify there is no `child.turn.started` within it. Check that speech works again after the window and record the device and result.
