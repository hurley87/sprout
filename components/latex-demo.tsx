"use client";

import "katex/dist/katex.min.css";
import { renderToString } from "katex";
import { useDeferredValue, useMemo, useState } from "react";
import {
  auditText,
  builtOnLine,
  category,
  discrepancyText,
  labels,
  presets,
  restrictions,
  verifiedText,
} from "./latex-demo-model";
import styles from "./latex-demo.module.css";

export default function LatexDemo() {
  const [text, setText] = useState(presets[0].lines.join("\n"));
  const deferredText = useDeferredValue(text);
  const { lines, result } = useMemo(() => auditText(deferredText), [deferredText]);
  const summary = result?.ok ? result.summary : null;
  const unreadableStart = result?.ok && result.trail.entries[0].kind === "start" && !result.trail.entries[0].read.ok;

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>SPROUT · MATH PLAYGROUND</p>
        <h1>Step checker</h1>
        <p>Checks each line against the previous one with exact algebra — no fixed solution path, no grading.</p>
      </header>
      <section className={styles.panel} aria-labelledby="input-heading">
        <h2 id="input-heading">Your working</h2>
        <p>Choose an example or write one LaTeX expression per line. Blank lines are ignored.</p>
        <div className={styles.examples} aria-label="Examples">
          {presets.map(preset => (
            <button key={preset.label} type="button" onClick={() => setText(preset.lines.join("\n"))}>
              {preset.label}
            </button>
          ))}
        </div>
        <label htmlFor="expressions">LaTeX expressions</label>
        <textarea id="expressions" spellCheck={false} value={text} onChange={event => setText(event.target.value)} />
      </section>
      <section className={styles.panel} aria-labelledby="results-heading">
        <h2 id="results-heading">Results</h2>
        <div className={styles.summary} aria-live="polite">
          {!result
            ? "Enter at least one expression to begin."
            : !result.ok
              ? result.detail
              : unreadableStart
                ? "First issue: line 1 — Unverified"
                : summary?.firstIssue
                  ? `First issue: line ${summary.firstIssue.index + 1} — ${labels[summary.firstIssue.category].slice(2)}`
                  : verifiedText(summary?.counts.verified ?? 0)}
        </div>
        {result?.ok && (
          <>
            <ol className={styles.results}>
              {result.trail.entries.map((entry, index) => {
                const lineRestrictions = restrictions(lines[index]);
                const transition = entry.kind === "start" ? null : entry.result;
                const dependent = builtOnLine(result.summary, entry.id);
                return (
                  <li key={entry.id} className={styles.row}>
                    <div className={styles.rowHeader}>
                      <strong>Line {index + 1}</strong>
                      {transition && (
                        <span className={`${styles.badge} ${styles[category(transition)]}`}>
                          {labels[category(transition)]}
                        </span>
                      )}
                      {dependent && <span className={styles.muted}>built on line {dependent}</span>}
                    </div>
                    <div
                      className={styles.math}
                      dangerouslySetInnerHTML={{ __html: renderToString(lines[index], { throwOnError: false }) }}
                    />
                    <p className={styles.muted}>
                      Restrictions:{" "}
                      {lineRestrictions === null
                        ? "unavailable"
                        : lineRestrictions.length
                          ? lineRestrictions.join(", ")
                          : "none"}
                    </p>
                    {entry.kind === "start" && !entry.read.ok && <p>{entry.read.detail}</p>}
                    {transition && category(transition) === "invalid" && <p>{discrepancyText(transition)}</p>}
                    {transition && category(transition) === "unverified" && (
                      <p>
                        {transition.detail}
                        {transition.position !== undefined ? ` (position ${transition.position})` : ""}
                      </p>
                    )}
                    {transition?.domain &&
                      [
                        ...transition.domain.lost.map(item => ({ ...item, action: "Drops" })),
                        ...transition.domain.added.map(item => ({ ...item, action: "Adds" })),
                      ].map(item => (
                        <p key={`${item.action}-${item.restriction}`}>
                          {item.action} {item.restriction} — e.g. at x = {item.witness.x}, y = {item.witness.y}
                        </p>
                      ))}
                    {transition?.domain?.unverified.map(restriction => (
                      <p key={`unverified-${restriction}`}>Could not prove whether {restriction} is kept</p>
                    ))}
                  </li>
                );
              })}
            </ol>
            <details>
              <summary>Raw result</summary>
              <pre>{JSON.stringify(result.summary, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
