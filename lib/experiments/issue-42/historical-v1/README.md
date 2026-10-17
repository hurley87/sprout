# Issue #42 historical contract v1

These TypeScript files are byte-for-byte copies from the immutable benchmark baseline
`fd40c9bc631770ab1220f85767ee2f6cdd56ab9a`. The Decisions adapter is copied from
its separately reviewed baseline `1223826b3708627bbc5326ec249e05e3a827cf9c`.

`loadBenchmark()` checks the copies against the existing manifest and Git objects
before building any run plan. Keep their bytes unchanged, including formatting.
The preserved directory layout keeps their relative imports within this snapshot.
The only bridge, `lib/events.ts`, re-exports a TypeScript type and emits no code.

The snapshot includes response mapping and reducer dependencies so offline replay
and authorized provider runs evaluate the same historical contract. It is used
only by experiment tooling and tests. Production must continue importing the
active `lib/lesson-runtime/` modules. Current source hashes are recorded as run
provenance; current behavioral tests protect the active contract.

No provider execution is authorized by loading this snapshot. Existing reviewed
plan, calibration, credential and finite request-budget gates still apply.
