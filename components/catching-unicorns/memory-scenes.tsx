import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_PRESENTATION } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { conceptPresentation, hasReveal, ExplanationList, type SceneProps } from "./presentation-helpers";

export function MemoryPromptScene({
  state,
  nodeId,
  node,
}: Pick<SceneProps, "state" | "node"> & { nodeId: "engram" | "exogram" }) {
  const criterionId = nodeId === "engram" ? "engram-biological" : "exogram-non-biological";
  const { demonstrated: accepted, item: definition } = conceptPresentation(state, nodeId, criterionId);
  return (
    <div className={styles.flashcard} data-scene={nodeId}>
      <h2 className={styles.question}>{String(node.presentation.prompt)}</h2>
      <p className={styles.answer}>
        {accepted
          ? nodeId === "engram"
            ? "Biological memory"
            : "Non-biological memory"
          : "Explain it in your own words."}
      </p>
      {accepted && definition && (
        <details className={styles.definition}>
          <summary>Explore the definition</summary>
          <p>{definition.text}</p>
          <p className="mt-2 text-xs">Source: {definition.source}</p>
        </details>
      )}
    </div>
  );
}

export function MemoryComparisonScene({ state, nodeId, revealCards }: SceneProps) {
  const definitions = [
    { from: "engram", id: "engram-biological" },
    { from: "exogram", id: "exogram-non-biological" },
  ] as const;
  const explained = revealCards.filter(concept => concept.demonstrated);
  const shownDefinitions = definitions
    .map(({ from, id }) => conceptPresentation(state, nodeId, id, from))
    .filter(hasReveal)
    .filter(concept => concept.demonstrated);
  return (
    <div className={styles.comparison} data-scene={nodeId}>
      <header className={styles.comparisonHeader}>
        <p className={styles.sceneTitle}>Engrams &amp; exograms</p>
        <h2 className={styles.question}>How are they different?</h2>
        <p className={styles.comparisonIntro}>Compare the two kinds of memory using the manuscript.</p>
      </header>
      {shownDefinitions.length > 0 && (
        <div className={styles.memoryPair} aria-label="Concepts you have explained">
          {shownDefinitions.map(({ criterionId, item }) => (
            <section className={styles.memoryReference} key={criterionId}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </section>
          ))}
        </div>
      )}
      <section className={styles.comparisonEvidence} aria-labelledby="comparison-evidence-title">
        <div className={styles.comparisonEvidenceHeader}>
          <h3 id="comparison-evidence-title">Your comparison</h3>
          <span className={styles.comparisonCount}>
            {explained.length} of {revealCards.length} differences explored
          </span>
        </div>
        {explained.length ? (
          <ExplanationList concepts={explained} />
        ) : (
          <p className={styles.comparisonEmpty}>
            Describe the differences in your own words. The ideas you explain will appear here.
          </p>
        )}
      </section>
      {(shownDefinitions.length > 0 || explained.length > 0) && (
        <details className={styles.comparisonSources}>
          <summary>Source notes</summary>
          <p>{CATCHING_UNICORNS_PRESENTATION.engram.reveals["engram-biological"].source}</p>
        </details>
      )}
    </div>
  );
}
