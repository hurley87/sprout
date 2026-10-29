"use client";

import type { CalculusSnapshot } from "@/lib/lesson-runtime/calculus-runtime";
import type { NamedRule, WorkItem } from "@/lib/calculus/work-check";
import { renderMathExpression } from "@/lib/calculus/math-rendering";
import styles from "./work-checklist.module.css";

const MARKS: Record<WorkItem["status"], { symbol: string; text: string }> = {
  correct: { symbol: "✓", text: "Correct" },
  incorrect: { symbol: "✗", text: "Needs another look" },
  unsupported: { symbol: "?", text: "Could not check" },
  missing: { symbol: "·", text: "Not shown yet" },
};

function Heard({ item }: { item: WorkItem }) {
  if (!item.expression) return <span className={styles.heard}>Not shown yet</span>;
  const result = renderMathExpression(item.expression);
  if (!result.ok) return <span className={styles.heard}>{result.text}</span>;
  return (
    <span className={styles.heard}>
      {/* KaTeX HTML comes only from our bounded expression vocabulary. */}
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: result.html }} />
      <span className={styles.srOnly}>{result.text}</span>
    </span>
  );
}

function Row({ item, className }: { item: WorkItem; className?: string }) {
  const mark = MARKS[item.status];
  return (
    <li className={`${styles[item.status]} ${className ?? ""}`} data-step={item.id} data-status={item.status}>
      <span className={styles.mark} aria-hidden="true">
        {mark.symbol}
      </span>
      <span className={styles.label}>
        {item.label}
        <span className={styles.srOnly}>: {mark.text}</span>
      </span>
      <Heard item={item} />
    </li>
  );
}

/** A named rule is optional, so it is a note rather than a checklist row. */
function Rule({ rule }: { rule: NamedRule }) {
  const name = `${rule.method[0].toUpperCase()}${rule.method.slice(1)} rule`;
  return (
    <p className={`${styles.rule} ${rule.fits ? styles.correct : styles.incorrect}`} data-rule={rule.method}>
      <span className={styles.mark} aria-hidden="true">
        {rule.fits ? "✓" : "✗"}
      </span>
      Rule you named: {name}
      {rule.fits ? "" : ". Look again at how the function is built."}
    </p>
  );
}

/** Read-out of what was heard and checked. Nothing here needs confirming: if it was
 * misheard, the learner just says it again. */
export function WorkChecklist({ math }: { math: CalculusSnapshot }) {
  const work = math.work;
  return (
    <section aria-label="Your work" className={styles.board}>
      <h2>Your work</h2>
      {work ? (
        <>
          <p className={styles.status} aria-live="polite">
            {math.complete
              ? ""
              : math.checking
                ? "Checking what you said…"
                : "Talk through each step. If something was misheard, just say it again."}
          </p>
          <ol className={styles.steps}>
            {work.steps.map(item => (
              <Row key={item.id} item={item} />
            ))}
            <Row item={work.final} className={styles.final} />
          </ol>
          {work.rule ? <Rule rule={work.rule} /> : null}
          {math.complete ? (
            <p className={styles.done} role="status">
              Every step checks out. Moving to the next problem.
            </p>
          ) : null}
        </>
      ) : (
        <p>No problem in progress.</p>
      )}
    </section>
  );
}
