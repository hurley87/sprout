# Halloween counting adventure

`/halloween` is an interest-led experiment from issue #87: a playful Halloween
counting party using the shared counting theme and runtime, not an engine fork.
The `counting-halloween` lesson is registered in the server allowlist. The garden
at `/` remains unchanged.

| Node | Count | Object | Backdrop |
| --- | ---: | --- | --- |
| `count-1-ghost` | 1 | ghost | porch |
| `count-2-bats` | 2 | bat | porch |
| `count-3-pumpkins` | 3 | pumpkin (a line on the path) | porch |
| `count-3-ghosts` | 3 | ghost (a triangle) | porch |
| `count-4-lanterns` | 4 | lantern | porch |
| `count-5-bats` | 5 | bat | porch |
| `count-6-ghosts` | 6 | ghost (two rows) | porch |

The original PNG illustrations were supplied by the project owner and resized
and cleaned for the app. Every counting scene uses the porch background, which
contains a jack-o'-lantern by the steps, small pumpkin lights in the tree and a
porch lamp. Counted pumpkins and lanterns stay in the open middle, and the tutor
briefs for those scenes name the decorations as not part of the count. The
party-yard background is used only for the celebration, where nothing is counted.

Scene transitions wait for 1,000 ms of tutor-audio quiet (`transitionQuietMs`).
Live attempt `5c98607e` showed 300–800 ms pauses inside a single tutor reply; the
shared 250 ms window changed scenes mid-reply, and the resumed audio ended the
attempt during render confirmation.

Run `npm run dev` and open `/halloween`; append `?debug=1` for diagnostics.
Provider-free `tests/browser/halloween.spec.ts` covers the full adventure,
wrong and unclear answers, correction, Stop and restart, reduced motion,
diagnostics export, route reload, garden availability and live request lesson IDs.
It mocks the session and classifier and uses a synthetic microphone. These tests
do not establish live provider or child usability.

## Not performed

Real microphone and live GPT-Live/Jev provider testing with a child and a
real-device phone check remain outstanding. For manual verification, configure
provider credentials, open `/halloween` on the target device, grant microphone
access, count through each scene, try a correction and Stop, and check Play again.
See `tests/browser/live/README.md` before using `npm run test:browser:live`;
those tests make real provider calls and may incur costs.
