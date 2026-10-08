import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_PRESENTATION } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { evidenceFor, revealText, type SceneProps } from "./presentation-helpers";

export function MemoryPromptScene({
  state,
  nodeId,
  node,
}: Pick<SceneProps, "state" | "node"> & { nodeId: "engram" | "exogram" }) {
  const criterionId = nodeId === "engram" ? "engram-biological" : "exogram-non-biological";
  const accepted = evidenceFor(state, nodeId, criterionId)?.status === "demonstrated";
  const definition = revealText(nodeId, criterionId);
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
    { from: "engram", id: "engram-biological", title: "Engram" },
    { from: "exogram", id: "exogram-non-biological", title: "Exogram" },
  ] as const;
  const differences = revealCards.filter(({ criterionId }) =>
    ["exogram-durability", "exogram-shareability", "exogram-revisability"].includes(criterionId),
  );
  const explained = differences.filter(({ evidence }) => evidence?.status === "demonstrated");
  const shownDefinitions = definitions.filter(({ id }) => evidenceFor(state, nodeId, id)?.status === "demonstrated");
  return (
    <div className={styles.comparison} data-scene={nodeId}>
      <header className={styles.comparisonHeader}>
        <p className={styles.sceneTitle}>Engrams &amp; exograms</p>
        <h2 className={styles.question}>How are they different?</h2>
        <p className={styles.comparisonIntro}>Compare the two kinds of memory using the manuscript.</p>
      </header>
      {shownDefinitions.length > 0 && (
        <div className={styles.memoryPair} aria-label="Concepts you have explained">
          {shownDefinitions.map(({ from, id, title }) => {
            const original = revealText(from, id)!;
            return (
              <section className={styles.memoryReference} key={id}>
                <h3>{title}</h3>
                <p>{original.text}</p>
              </section>
            );
          })}
        </div>
      )}
      <section className={styles.comparisonEvidence} aria-labelledby="comparison-evidence-title">
        <div className={styles.comparisonEvidenceHeader}>
          <h3 id="comparison-evidence-title">Your comparison</h3>
          <span className={styles.comparisonCount}>
            {explained.length} of {differences.length} differences explored
          </span>
        </div>
        {explained.length ? (
          <ul className={styles.differenceList}>
            {explained.map(({ criterionId, item }) => (
              <li className={styles.difference} key={criterionId}>
                <span className={styles.differenceCheck} aria-hidden="true">
                  ✓
                </span>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
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
