# Halloween counting adventure

`/halloween` is an interest-led experiment from issue #87: a playful Halloween
counting party using the shared counting theme and runtime, not an engine fork.
The `counting-halloween` lesson is registered in the server allowlist. The garden
at `/` remains unchanged.

| Node | Count | Object | Backdrop |
| --- | ---: | --- | --- |
| `count-1-helper` | 1 | helper | porch |
| `count-2-helpers` | 2 | helper | porch |
| `count-3-bats` | 3 | bat | porch |
| `count-3-pumpkins` | 3 | pumpkin | plain twilight |
| `count-4-lanterns` | 4 | lantern | plain twilight |
| `count-5-helpers` | 5 | helper | porch |
| `count-6-ghosts` | 6 | ghost | porch |

The original PNG illustrations were supplied by the project owner and resized
and cleaned for the app. The backgrounds contain decorations, so pumpkin and
lantern scenes use the plain twilight backdrop instead.

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
