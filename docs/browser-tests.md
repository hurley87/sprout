# Browser test suites

`npm run test:browser` selects only the `browser` project. It covers the existing
lesson smoke tests and local WebRTC/Web Audio transport tests. Files under
`tests/browser/live/` are excluded, even when passed as a file filter. The server
starts with empty `OPENAI_API_KEY` and `TYPESAFE_API_KEY` overrides, so these tests
cannot use configured provider credentials. Existing local transport peers and
route mocks remain provider-free.

The separate `lesson-live` project is enabled only by deliberately selecting
`playwright.live.config.ts`, normally through `npm run test:browser:live`. It
discovers only `tests/browser/live/**/*.spec.ts` and cannot select normal browser
tests. **No live scenarios exist yet**; a configured invocation currently reports
“No tests found”. This is suite isolation for future work in
[#30](https://github.com/hurley87/sprout/issues/30), not reactive lesson coverage.

## Live configuration and cost

Supply server-only `OPENAI_API_KEY` (GPT-Live access) and `TYPESAFE_API_KEY` (Jev
access) in the environment invoking Playwright, using your usual secure credential
setup. The live config checks for nonempty values before starting a server and
reports only missing variable names. It does not load `.env.local`; credentials
configured only in that file do not satisfy this check. Never put secrets in
commands, test fixtures, documentation, or `NEXT_PUBLIC_*` variables.

Future live scenarios may make **billed GPT-Live and Jev calls**. Select a small
scenario or tagged subset first; the full live suite is an explicit opt-in. It
runs with one worker, no automatic retries, a two-minute timeout per test,
15-second assertion waits, and a ten-minute total run limit. Server startup is
bounded to two minutes. Do not add the live command to normal CI by default.

Both suites start a fresh local server on port 3100 and refuse to reuse an
existing server. Stop any server on that port before running tests. Run the suites
sequentially.

## Selection commands

These live selection examples apply once matching scenarios are implemented.
Use descriptive test titles and Playwright tags such as `@baseline` for subsets.

```bash
# Normal provider-free browser tests
npm run test:browser

# Discover live tests without starting a server or contacting providers
# (the invoking environment must still contain both configuration names)
npm run test:browser:live -- --list

# One scenario by file and distinctive test title
npm run test:browser:live -- happy-path.spec.ts --grep 'happy path'

# A named subset by Playwright tag
npm run test:browser:live -- --grep '@baseline'

# All implemented live scenarios (may incur provider costs)
npm run test:browser:live
```

`--list` performs discovery only. Test modules must not initiate provider calls
during import. Missing credentials, an unknown project, or an unmatched file/title
filter should fail visibly; do not use `--pass-with-no-tests` to disguise absent
coverage.
