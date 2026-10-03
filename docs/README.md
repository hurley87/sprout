# Sprout documentation

Start with the [MVP PRD](sprout-mvp-prd.md) for the agreed product scope. These documents describe a private, parent-supervised, seven-day counting experiment in a browser on a MacBook.

| Document | Purpose |
| --- | --- |
| [MVP PRD](sprout-mvp-prd.md) | Product behavior, boundaries, success criteria, and build sequence |
| [Domain glossary](../CONTEXT.md) | Canonical meanings of lesson, session, observation, reviewed evidence, and adaptation |
| [Architecture and evidence flow](architecture.md) | Component authority, session lifecycle, evidence records, review gate, and technical feasibility |
| [Transcript-state steering findings](transcript-state-steering-findings.md) | Completed architecture spike, final live-run evidence, authority boundaries, and productionization/evaluation follow-ups |
| [Experiment protocol](experiment-protocol.md) | How to run the seven days and evaluate the results |
| [ADR 0001](adr/0001-parent-reviewed-evidence.md) | Why only parent-reviewed evidence may inform future lessons |
| [Issue #5 verification](issue-5-verification.md) | Acceptance matrix, reproducible local checks, synthetic visual evidence and remaining live/manual gates |
| [GPT-Live baseline](gpt-live-baseline.md) | Slice 1 test matrix, observed shortcomings, and problems for the live-control decision |
| [Jev answer experiment](jev-answer-experiment.md) | Whether one Jev question can drive scene advancement, measured against that baseline |
| [Response-gate latency baseline](response-gate-latency-experiment.md) | Post-decision gate holds, provider lifecycle limits, and the next measured release-policy hypothesis |
| [Microphone turn investigation baseline](microphone-turn-investigation.md) | Pre-evaluation fallback evidence, detector policy, and pending comparison protocol |

## Tutoring principle

Sprout separates **pedagogical intent** from **conversational realization**: the lesson/curriculum determines what needs to happen and why; the live voice model has freedom over how the conversation unfolds inside those bounds. Application control owns deterministic state and validated commits. See [Architecture and evidence flow](architecture.md#tutoring-principle-what-vs-how).

## Learning principles

Sprout is built around a simple hypothesis: **personalized feedback, mastery, active practice, adaptive pacing, and sustained one-to-one intellectual interaction are serious candidate mechanisms for improving learning. AI may make those mechanisms dramatically more scalable.**

Sprout should therefore optimize for those mechanisms—not for AI novelty itself. The tutor should help the learner practice, receive timely feedback, progress when ready, revisit weaknesses, and engage in an ongoing intellectual relationship that builds on prior sessions.

Evidence supports the learning value of several of these mechanisms individually and in combination. What remains much less established is what happens when they can be delivered cheaply, continuously, and personally over years. **Whether that changes the upper tail of human intellectual accomplishment is an open experiment.**

The PRD owns product requirements. The architecture document describes how to enforce them; the protocol defines how to evaluate them. The glossary contains terminology, and ADRs preserve decisions and their trade-offs.

The repository contains the slice 1 voice prototype: one hardcoded GPT-Live-1 counting lesson with in-tab diagnostics. Durable recording, saved-file Observer analysis, parent review and the reviewed-evidence gate are implemented and locally tested. Observer/provider/manual acceptance remains open; profile inference and planning are not implemented. See the [verification results](issue-5-verification.md).
