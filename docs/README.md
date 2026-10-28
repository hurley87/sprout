# Sprout documentation

The production prototype is the realtime counting lesson at `/`, backed by
`/api/live` for voice setup and `/api/classify` for semantic observation.

| Document | Purpose |
| --- | --- |
| [Calculus demo validation](calculus-demo-validation.md) | Route/setup, learner walkthrough, finite math domain, diagnostics and PENDING live acceptance matrix/forms |
| [Issue #80 findings](issue-80-findings.md) | Renderer decision, feasibility conclusions, historical automated/provider evidence and remaining human acceptance |
| [Calculus tutor integration](calculus-tutor-integration.md) | Display/confirmation authority, bounded context and conservative assistance evidence |
| [Architecture](architecture.md) | Authority boundaries, current modules, lifecycle and failure behavior |
| [Domain glossary](../CONTEXT.md) | Current lesson/runtime terms |
| [Classifier contract](lesson-classifier.md) | Jev input projection, probabilities and deterministic mapping |
| [Reducer contract](lesson-runtime-reducer.md) | Identity, completion gate, render and steering handoff |
| [Evidence, feedback and delivery tracking](issue-77-tracking-contract.md) | Current lifecycle and proposed behavior-preserving observation contract for issue #77 |
| [Issue #77 preservation replay](issue-77-tracking-replay.md) | Baseline behavior and scheduling verification, provenance and synthetic replay limits |
| [Issue #77 findings](issue-77-findings.md) | Recorded tracking observations, reproducible analysis and deferred policy recommendation |
| [Browser evaluation guide](lesson-browser-guide.md) | Reproduction steps, timing, diagnostic interpretation and limitations |
| [Browser test suites](browser-tests.md) | Provider-free versus live selection, configuration and costs |
| [Catching Unicorns demo validation](catching-unicorns-demo-validation.md) | Demo coverage, source limits, live acceptance status and removal rehearsal |
| [Issue #42 benchmark readiness](issue-42-benchmark-readiness.md) | Evidence gaps, measurement status and a bounded next-test proposal; empirical comparison remains incomplete |
| [Issue #76 rubric review bundle](issue-76-rubric-review.md) | Instructor-facing MAE386 reference answers, source citations, atomic criteria and labeled synthetic examples |

The standalone adult-learning demonstrations are available at
`/demos/catching-unicorns`, `/demos/mae386` and `/demos/calculus`. All are registered
application lessons alongside the production counting lesson. See the
[MAE386 route validation](mae386-demo-validation.md) for bounded UI coverage and
remaining live acceptance work.

Sprout separates pedagogical intent from conversational realization: the authored
lesson specifies the objective and success edge; GPT-Live realizes the conversation
within the displayed node. Jev describes semantic state; application code validates
proposals and owns every scene transition.

[#56](https://github.com/hurley87/sprout/issues/56) records the clean prototype reset.
Historical prototype data is disposable; compatibility and migrations are out of
scope. Repository docs describe the surviving system. Broader behavioral evaluation
belongs to [#57](https://github.com/hurley87/sprout/issues/57).

The [issue #42 decision](issue-42-decision.md) retains active Jev 1.14 after a
limited reviewed comparison; the experimental Decisions tooling stays isolated.
