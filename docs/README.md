# Sprout documentation

Start with the [MVP PRD](sprout-mvp-prd.md) for the agreed product scope. These documents describe a private, parent-supervised, seven-day counting experiment in a browser on a MacBook.

| Document | Purpose |
| --- | --- |
| [MVP PRD](sprout-mvp-prd.md) | Product behavior, boundaries, success criteria, and build sequence |
| [Domain glossary](../CONTEXT.md) | Canonical meanings of lesson, session, observation, reviewed evidence, and adaptation |
| [Architecture and evidence flow](architecture.md) | Component authority, session lifecycle, evidence records, review gate, and technical feasibility |
| [Experiment protocol](experiment-protocol.md) | How to run the seven days and evaluate the results |
| [ADR 0001](adr/0001-parent-reviewed-evidence.md) | Why only parent-reviewed evidence may inform future lessons |

The PRD owns product requirements. The architecture document describes how to enforce them; the protocol defines how to evaluate them. The glossary contains terminology, and ADRs preserve decisions and their trade-offs.

The repository currently contains a Next.js starter. The described voice, evidence, review, and planning flows are not yet implemented.
