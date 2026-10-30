"use client";

import type { CalculusSnapshot } from "@/lib/lesson-runtime/calculus-runtime";
import type { NamedRule, WorkItem } from "@/lib/calculus/work-check";
import type { MathExpression } from "@/lib/calculus/math-expression";
import { renderMathExpression } from "@/lib/calculus/math-rendering";
import theme from "./calculus-theme.module.css";
import styles from "./work-checklist.module.css";

const MARKS: Record<WorkItem["status"], { symbol: string; text: string; note?: string }> = {
  correct: { symbol: "✓", text: "correct" },
  incorrect: { symbol: "×", text: "needs another look", note: "Have another look" },
  unsupported: { symbol: "?", text: "not understood", note: "Didn’t catch that. Say it again" },
  missing: { symbol: "", text: "not shown yet" },
};

function MathText({ expression }: { expression: MathExpression }) {
  const result = renderMathExpression(expression);
  if (!result.ok) return <span>{result.text}</span>;
  return (
    <>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: result.html }} />
      <span className={styles.srOnly}>{result.text}</span>
    </>
  );
}

function Row({ item, checking }: { item: WorkItem; checking: boolean }) {
  const mark = MARKS[item.status];
  return (
    <li
      className={`${styles.row} ${styles[checking ? "checking" : item.status]}`}
      data-step={item.id}
      data-status={item.status}
    >
      <span className={styles.mark} aria-hidden="true">
        {checking ? "" : mark.symbol}
      </span>
      <span className={styles.label}>
        {item.labelMath ? (
          <>
            {item.labelMath.text}{" "}
            <span className={styles.labelMath}>
              <MathText expression={item.labelMath.expression} />
            </span>
          </>
        ) : (
          item.label
        )}
        <span className={styles.srOnly}>: {checking ? "checking" : mark.text}</span>
      </span>
      <span className={styles.heard}>
        <span className={styles.expression}>
          {item.expression ? (
            <MathText expression={item.expression} />
          ) : (
            <span className={styles.placeholder} aria-hidden="true">
              —
            </span>
          )}
        </span>
        {checking ? (
          <span className={theme.checkDots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </span>
      {!checking && mark.note ? <span className={styles.note}>{mark.note}</span> : null}
    </li>
  );
}

function Rule({ rule }: { rule: NamedRule }) {
  const name = `${rule.method[0].toUpperCase()}${rule.method.slice(1)} rule`;
  return (
    <p className={`${styles.rule} ${rule.fits ? styles.ruleFits : styles.ruleMisfit}`} data-rule={rule.method}>
      <span className={styles.ruleMark} aria-hidden="true">
        {rule.fits ? "✓" : "×"}
      </span>
      <strong>Rule: {name}</strong>
      {rule.fits ? null : <span className={styles.ruleMessage}>Look again at how the function is built.</span>}
      <span className={styles.srOnly}>{rule.fits ? "Rule fits" : "Rule does not fit"}</span>
    </p>
  );
}

/** Checking highlights the first missing/unsupported item, falling back to the final answer. */
export function WorkChecklist({ math }: { math: CalculusSnapshot }) {
  const work = math.work;
  const items = work ? [...work.steps, work.final] : [];
  const checkingId =
    math.checking && !math.complete
      ? (items.find(item => item.status === "missing" || item.status === "unsupported") ?? work?.final)?.id
      : undefined;
  return (
    <section aria-label="Your work" className={`${styles.board} ${math.complete ? styles.complete : ""}`}>
      <h2 className={styles.srOnly}>Your work</h2>
      {work ? (
        <>
          {math.complete ? (
            <div className={styles.done} role="status">
              <span className={styles.doneMark} aria-hidden="true">
                ✓
              </span>
              <span>Every step checks out.</span>
              <span className={styles.advanceTrack} aria-hidden="true">
                <span className={theme.advanceBar} />
              </span>
            </div>
          ) : null}
          <ol className={styles.steps}>
            {items.map(item => (
              <Row key={item.id} item={item} checking={item.id === checkingId} />
            ))}
          </ol>
          {work.rule ? <Rule rule={work.rule} /> : null}
        </>
      ) : (
        <p>No problem in progress.</p>
      )}
    </section>
  );
}
