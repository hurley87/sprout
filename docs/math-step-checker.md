# Math step checker

## What it is

`lib/math-audit` is a bounded, deterministic engine for auditing algebraic
transformations. It is independent of modality, tutor, lesson, and transcript;
it is neither final-answer grading nor a fixed authored path. It compares the
proposed expression, not an LLM's or learner's assertion that it is correct.

```ts
import { checkTransformation } from "../lib/math-audit/check";
import { auditSequence } from "../lib/math-audit/audit";

const result = checkTransformation({
  previous: { latex: "x(x+1)" },
  proposed: { latex: "x^2+x" },
  operation: { kind: "algebraic", description: "expand" },
  provenance: { previousId: "a", proposedId: "b", sourceIds: ["source-1"] },
});
const audit = auditSequence(["x(x+1)", "x^2+x"], { ids: ["a", "b"] });
```

`checkTransformation` returns `verdict`, `reason`, `detail`, optional input
location (`which`, `position`), operation and provenance; exact comparisons
also return `domain`, and non-equivalence may include `evidence` and
`discrepancy`. `auditSequence` returns `{ ok: true, trail, summary }` or
`{ ok: false, reason, detail }`. Verdicts are `equivalent`, `not-equivalent`,
`unsupported`, and `ambiguous`.

| Reason                                                                 | Meaning                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `exact-equivalence`                                                    | Equal on the common domain.                                                                                              |
| `exact-difference`                                                     | Cross-multiplied polynomial is nonzero.                                                                                  |
| `previous-undefined`, `proposed-undefined`                             | A denominator is identically zero; a proposed undefined expression is `not-equivalent`, a previous one is `unsupported`. |
| `malformed-input`, `malformed-previous`, `malformed-proposed`          | Invalid input or malformed expression.                                                                                   |
| `ambiguous-previous`, `ambiguous-proposed`                             | Reader cannot uniquely interpret notation.                                                                               |
| `unsupported`, `unsupported-operator`, `unsupported-variable`, `limit` | Unsupported syntax/representation or exhausted bounds.                                                                   |
| `requires-rule-validator`                                              | Operation is not algebraic equivalence.                                                                                  |

The domain report contains `status`, `previousRestrictions`,
`proposedRestrictions`, `lost`, `added`, and `unverified`. Lost/added entries
include exact rational witnesses. A `discrepancy` is either `localized`, with
alignment basis, role, path, description and two formatted parts, or
`not-localized`. Audit summary status is `verified` or `attention`; its counts
separate `verified`, `invalid`, `unverified`, and `domainChanged` transitions.

## Supported mathematics

Integer-coefficient rational expressions in `x` and `y`: integers, variables,
addition, subtraction, multiplication, division, unary negation and integer
powers, including negative powers. Rational _values_ can arise through division;
decimal and rational AST number literals are not supported.

Bounds are 128 AST nodes, depth 16 (root depth 1), 8 operands per add/multiply,
absolute integer at most 999999, absolute exponent at most 12; polynomial total
degree 24, 64 terms, absolute coefficient 10^15, and 4096 term products per
operation budget; LaTeX source length 2000 characters; trail length 200 entries
including the start. Exceeding a bound causes abstention, not approximation.

## How equivalence is decided

The reducer constructs exact BigInt integer polynomials P/Q without cancelling
factors, preserving restrictions from denominators and negative powers. It tests
`P1*Q2 - P2*Q1` for the zero polynomial. A nonzero difference proves the
expressions are not identical on their common domain: a nonzero polynomial
cannot vanish on the entire nonempty open set where the denominators and
restrictions are nonzero. No numerical sampling is used as proof. An exact
rational witness, when found, is illustrative only; its absence does not weaken
the polynomial proof.

## Domain contract

Restrictions require recorded polynomials to be nonzero; `equivalent` means
equality on the **intersection** of the domains, not domain preservation. To
prove restriction `r` retained by the other side's restrictions, the checker
forms their product `M` and proves `r` divides `M^k` within its bounded search.
Otherwise it looks for an exact point satisfying the target restrictions while
violating `r`: a witness proves a restriction lost or added. Without proof or a
witness the restriction is `unverified`. The report's status prioritizes lost,
then unverified, then added, then preserved. The audit categorizes an equivalent
transition with any non-preserved status as `domain-changed`.

For the issue's original fraction divided by a fraction:

- Multiplication by its reciprocal is `equivalent`, `preserved`; both sides
  report `4x + 10y ≠ 0` and `12x^2 - 10xy ≠ 0`.
- Simplifying directly to `3y/(2x)` is `equivalent`, `restriction-lost`.
  The lost restrictions above have witnesses `(x, y) = (-5/2, 1)` and `(1, 6/5)`,
  respectively; the proposed restriction is `2x ≠ 0`.
- `(2 + 3x^2)^3 (x^2 + 2x)^{-2}` versus
  `(2 + 3x^2)^3 / (x^2 + 2x)^2` is `equivalent`, `preserved`. The previous
  restriction is `x^2 + 2x ≠ 0`; the proposed restriction is
  `x^4 + 4x^3 + 4x^2 ≠ 0`.

## LaTeX reader

The bounded reader accepts integers, `x`, `y`, `+`, `-`, `*`, `/`,
juxtaposition, parentheses and braces, `\frac`, `\dfrac`, `\tfrac`, `\times`,
`\cdot`, `\div`, `\left(` / `\right)`, spacing commands, and signed integer
powers with optional braces. Division chains, ungrouped right-hand juxtaposition
after division, `\div` followed by a product, mixed-number notation, separated
digits, and stacked powers are ambiguous. Group the intended expression.
Unsupported tokens include functions, roots, other variables, decimals,
equations, punctuation such as factorial or prime, and non-integer or symbolic
exponents. Malformed notation is rejected separately.

## Localization

Localization requires a defensible alignment with exactly one proven unequal
pair and all other aligned pairs proven equal; uncertain or non-unique
alignments abstain. It supports reciprocal alignment and structural alignment
of matching shapes, including commutative terms and factors. For the issue's
missing `x`, the result is `localized`, basis `reciprocal-alignment`, role
`reciprocal-numerator`, path `["factor 2", "numerator"]`, `previousPart`
`12x+30y`, and `proposedPart` `12+30y`. It does not infer why the difference
occurred. **Do not read `previousPart` to a learner as the answer.**

## Audit trail

`createAuditTrail`, `appendStep`, `appendCorrection`, and `auditSummary` maintain
an immutable append-only ordered history with IDs, expressions, optional
operation/source IDs, results, and provenance. Corrections supersede the target
and its subsequent effective-chain entries; history remains intact. The summary
identifies the earliest invalid, unverified, or domain-changed transition and
lists later effective entries in `dependsOnIssue`. `verified` means the local
transitions were proven under this contract; it is not a guarantee of a correct
final answer or of the learner's intent.

## What it cannot judge (v1)

Differentiation, integration, and solving need separate rule validators;
operation kinds other than `algebraic` abstain. Trigonometric, exponential,
logarithmic and root functions, non-integer powers, decimal or rational
literals, more variables, equations and inequalities are unsupported. It does
not perform general domain sign/case analysis beyond bounded exact witness
search or provide factoring-based simplification guidance. Handwriting, OCR,
speech capture, and live tutor integration are outside this engine; integration
is separate work.

## Acceptance mapping

All paths below are under `tests/`; names are Vitest test titles.

| Issue #90 acceptance item                                | Coverage                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reciprocal valid; missing x invalid                      | `math-audit-check.test.ts`: `checks the reciprocal and detects the missing x`                                                                                                                                                                                                                                       |
| Localize reciprocal numerator only when defensible       | `math-audit-localize.test.ts`: `localizes the missing-x reciprocal numerator without explaining the cause`; `refines an unchanged factor and refuses multiple errors or unrelated shapes`                                                                                                                           |
| Two legal next steps                                     | `math-audit-check.test.ts`: `checks the reciprocal and detects the missing x`; `accepts alternative steps and flags cancellation`                                                                                                                                                                                   |
| Factored and expanded equivalent                         | `math-audit-check.test.ts`: `compares expansion both ways`                                                                                                                                                                                                                                                          |
| Domain and zero denominators                             | `math-audit-check.test.ts`: `detects lost restrictions`; `detects added restrictions and undefined expressions`; `uses exact rational roots and abstains when no witness is found`                                                                                                                                  |
| Unsupported, ambiguous, malformed, oversized fail safely | `math-audit-check.test.ts`: `abstains on malformed, unsupported, ambiguous, and oversized inputs`; `math-audit-latex.test.ts`: `rejects ambiguous %s`, `rejects unsupported %s`, `rejects malformed %s`, `enforces source, integer, exponent, operand, and depth limits`; `math-audit-failsafe.test.ts`: both tests |
| No fixed authored sequence                               | `math-audit-audit.test.ts`: `checks intended valid algebra while flagging domain changes`; `math-audit-check.test.ts`: `accepts alternative steps and flags cancellation`                                                                                                                                           |
| Document support and limits                              | This document; behavior covered by the preceding tests.                                                                                                                                                                                                                                                             |
| Earliest invalid or unverified transition and context    | `math-audit-audit.test.ts`: `reports the earliest error with downstream dependencies`; `places unsupported or ambiguous work before later invalid work`                                                                                                                                                             |
| Negative-exponent fixture and restrictions               | `math-audit-latex.test.ts`: `reads the power fixtures and precedence`; `math-audit-check.test.ts`: `retains negative power domain`; `math-audit-audit.test.ts`: `retains negative-power restrictions`                                                                                                               |
| No transcript or lesson ID required                      | `math-audit-audit.test.ts`: `reports the earliest error with downstream dependencies`; `math-audit-check.test.ts`: `checks the reciprocal and detects the missing x`                                                                                                                                                |
