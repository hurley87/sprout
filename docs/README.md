# Sprout documentation

The production prototype is the realtime counting lesson at `/`, backed by
`/api/live` for voice setup and `/api/classify` for semantic observation.

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Authority boundaries, current modules, lifecycle and failure behavior |
| [Domain glossary](../CONTEXT.md) | Current lesson/runtime terms |
| [Classifier contract](lesson-classifier.md) | Jev input projection, probabilities and deterministic mapping |
| [Reducer contract](lesson-runtime-reducer.md) | Identity, completion gate, render and steering handoff |
| [Browser evaluation guide](lesson-browser-guide.md) | Reproduction steps, timing, diagnostic interpretation and limitations |
| [Browser test suites](browser-tests.md) | Provider-free versus live selection, configuration and costs |

Sprout separates pedagogical intent from conversational realization: the authored
lesson specifies the objective and success edge; GPT-Live realizes the conversation
within the displayed node. Jev describes semantic state; application code validates
proposals and owns every scene transition.

[#56](https://github.com/hurley87/sprout/issues/56) records the clean prototype reset.
Historical prototype data is disposable; compatibility and migrations are out of
scope. Repository docs describe the surviving system. Broader behavioral evaluation
belongs to [#57](https://github.com/hurley87/sprout/issues/57).
