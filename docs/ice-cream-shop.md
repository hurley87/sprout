# Evie's Ice Cream Shop

`/ice-cream` uses the registered `ice-cream-shop` lesson and the shared voice
session and deterministic lesson runtime. Append `?debug=1` for diagnostics and
export. Set `SPROUT_CHILD_NAME` on the server to opt into a child's first name;
the route does not collect it.

| Node | Scene | Question | Skill | Accepted answer |
| --- | --- | --- | --- | --- |
| `count-cones` | `open-shop` | How many cones? | Count | 2 |
| `name-pink` | `pink-scoop` | Pink or yellow? | Colour | pink |
| `count-pink` | `pink-scoops` | How many pink scoops? | Selective count | 2 |
| `order-first` | `build-first` | Which colour first? | Order | pink |
| `order-second` | `build-second` | Which colour next? | Order | yellow |
| `count-scoops` | `tall-cone` | How many scoops? | Count | 3 |

Each node supplies `answerKind` and `answer` as presentation facts. Separate
order nodes make the active step explicit. Only an accepted learner-owned
answer permits progression and scoop placement; tutor suggestions, generic
agreement, unresolved answers and stale results are not placement authority.
The app, not the tutor, renders scoops after acceptance.

Original SVG foreground assets use strawberry, lemon and chocolate motifs so
colour is not the only cue. Backgrounds do not duplicate counted objects.
`preview.png` is not shipped.

## Validation

Provider-free unit replays in `tests/ice-cream-lesson.test.ts` exercise answer
ownership, self-correction and stale evidence; browser tests use a synthetic
microphone, local transport and mocked classifier. These tests do not establish
actual speech recognition, classifier accuracy, tutor behavior or child enjoyment.

Manual checks still needed with a parent supervising:

- [ ] Configure live GPT-Live and Jev providers and use a real microphone.
- [ ] Set `SPROUT_CHILD_NAME` and confirm Evie's name is used appropriately.
- [ ] Play every scene on a real phone, including Stop and Play again.
- [ ] Try wrong, unclear, corrected and help-request answers; observe whether
      colour or order-step misclassifications occur separately from counting errors.
- [ ] Ask whether the child understood the steps and wants to play again.
