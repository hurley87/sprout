# Concert counting adventure

The `/concert` route uses the shared counting lesson and voice runtime with a server-owned `counting-concert` lesson. It does not accept lesson prompts or names from the browser. `SPROUT_CHILD_NAME` optionally supplies a name to the tutor on the server; no name appears in the screen copy.

| Node | Count | Foreground |
| --- | ---: | --- |
| `count-1-microphone` | 1 | microphone |
| `count-2-guitars` | 2 | pink and lavender guitars |
| `count-3-bracelets` | 3 | pink, blue and gold bracelets |
| `count-3-stars` | 3 | stars in a triangle |
| `count-4-lights` | 4 | differently coloured stage lights |
| `count-5-beads` | 5 | loose, individually placed beads |
| `count-6-butterflies` | 6 | butterflies in two rows |

Original SVG objects sit separately on an empty-centred stage. The finale uses a separate backdrop, four uncounted friends and gentle confetti. All animation stops under reduced motion. The glow cue holds through short tutor-audio gaps, and the pastel controls and differently sized progress pips fit the stage. The existing one-second quiet window protects transitions.

Run `npm run dev` and open `/concert`, adding `?debug=1` for diagnostics. The provider-free browser test uses a synthetic microphone and mocked session and classifier to exercise progression, correction, Stop, restart, export and replay. These tests cannot establish real provider or child usability.

## Verification

Run `npm run typecheck`, `npx eslint app lib tests`, `npm run format:check`, `npm test`, and `npx playwright test`. Set `CONCERT_SCREENSHOTS=1` to save scene captures in `/tmp/concert-shots/`.

On November 4, 2026, typecheck and ESLint passed, Vitest passed 2,432 tests across 132 files, and Playwright passed 67 tests. The repository-wide Prettier check reported 39 pre-existing unrelated files; the concert changes were checked separately. Screenshots were captured at desktop, phone and two landscape sizes.

## Not performed

Live microphone and GPT-Live/Jev testing with a child, and checks on a real phone, were not performed. Configure provider credentials and test those separately; live provider calls can incur costs.
