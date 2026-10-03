# Sprout documentation

The current product is the realtime counting lesson at `/`. Its temporary alias is
`/experiments/transcript-state-steering`.

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Authority boundaries, current modules, lifecycle and failure behavior |
| [Domain glossary](../CONTEXT.md) | Current lesson/runtime terms |
| [Classifier contract](transcript-state-classifier-experiment.md) | Jev input projection, probabilities and deterministic mapping |
| [Reducer contract](transcript-state-runtime-reducer.md) | Identity, completion gate, render and steering handoff |
| [Browser evaluation guide](transcript-state-steering-browser-experiment.md) | Reproduction steps, timing, diagnostic interpretation and limitations |

Sprout separates pedagogical intent from conversational realization: the authored
lesson specifies the objective and success edge; GPT-Live realizes the conversation
within the displayed node. Jev describes semantic state; application code validates
proposals and owns every scene transition.

[#56](https://github.com/hurley87/sprout/issues/56) records the clean prototype reset.
Historical prototype data is disposable; compatibility and migrations are out of
scope. Repository docs describe the surviving system. Broader behavioral evaluation
belongs to [#57](https://github.com/hurley87/sprout/issues/57).
