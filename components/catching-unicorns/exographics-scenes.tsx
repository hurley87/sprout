import styles from "../catching-unicorns-demo.module.css";
import { CATCHING_UNICORNS_PRESENTATION } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { conceptPresentation, ExplanationList, EvidenceState, type SceneProps } from "./presentation-helpers";

export function ExographicsPromptScene({ state, nodeId, node, revealCards }: SceneProps) {
  const examples = [
    { kind: "writing", symbol: "Aa", caption: "Writing" },
    { kind: "equation", symbol: "∑ x²", caption: "Equation" },
    { kind: "graph", symbol: "⌁", caption: "Graph" },
    { kind: "map", symbol: "◇ · · ◇", caption: "Map" },
  ];
  const beyond = conceptPresentation(state, nodeId, "beyond-prose").demonstrated;
  const acceptedReveals = revealCards.filter(concept => concept.demonstrated);
  return (
    <div className={styles.flashcard} data-scene={nodeId}>
      <h2 className={styles.question}>{String(node.presentation.prompt)}</h2>
      <p className={styles.answer}>Explain it in your own words, using examples.</p>
      {acceptedReveals.length > 0 && (
        <details className={styles.definition}>
          <summary>Explore the definition</summary>
          {acceptedReveals.map(({ criterionId, item }) => (
            <section key={criterionId}>
              <h3 className="font-semibold">{item.title}</h3>
              <p>{item.text}</p>
              <p className="mt-2 text-xs">Source: {item.source}</p>
            </section>
          ))}
        </details>
      )}
      {beyond && (
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {examples.map(example => (
            <div aria-label={example.caption} className="p-4 text-center" key={example.kind}>
              <div className="text-3xl" aria-hidden="true">
                {example.symbol}
              </div>
              <p className="mt-2">{example.caption}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExographicsReasoningScene({ nodeId, revealCards }: SceneProps) {
  const explained = revealCards.filter(concept => concept.demonstrated);
  const unresolved = revealCards.filter(concept => !concept.demonstrated);
  return (
    <div className={styles.reasoning} data-scene={nodeId}>
      <header className={styles.reasoningHeader}>
        <p className={styles.sceneTitle}>A thought experiment</p>
        <h2 className={styles.reasoningQuestion}>What changes when you put it on paper?</h2>
        <p className={styles.comparisonIntro}>
          Focus on how you think through the problem. You don’t need to give the total.
        </p>
      </header>
      <section className={styles.reasoningExercise} aria-labelledby="mental-exercise-title">
        <h3 id="mental-exercise-title" className={styles.exerciseLabel}>
          01 · Try it in your head
        </h3>
        <p className={styles.exerciseInstruction}>Reason through this without writing anything down.</p>
        <p className={styles.arithmetic} aria-label="Arithmetic example">
          {CATCHING_UNICORNS_PRESENTATION["why-exographics"].promptVisual.arithmetic}
        </p>
      </section>
      <section className={styles.reasoningReflection} aria-labelledby="paper-reflection-title">
        <h3 id="paper-reflection-title" className={styles.exerciseLabel}>
          02 · Now imagine paper and a pencil
        </h3>
        <p>What changes in how you reason through it? Talk it through in your own words.</p>
      </section>
      <section className={styles.comparisonEvidence} aria-labelledby="reasoning-evidence-title">
        <div className={styles.comparisonEvidenceHeader}>
          <h3 id="reasoning-evidence-title">Your explanation</h3>
          <span className={styles.comparisonCount}>
            {explained.length} of {revealCards.length} ideas explored
          </span>
        </div>
        {explained.length > 0 ? (
          <ExplanationList concepts={explained} />
        ) : (
          <p className={styles.comparisonEmpty}>The ideas you explain will appear here as you talk.</p>
        )}
        {unresolved.length > 0 && (
          <div className={styles.reasoningPending}>
            {unresolved.map(({ criterionId, evidence }) => (
              <div className={styles.reasoningPendingItem} key={criterionId}>
                <span>Idea {revealCards.findIndex(card => card.criterionId === criterionId) + 1}</span>
                <EvidenceState evidence={evidence} />
              </div>
            ))}
          </div>
        )}
        {explained.length > 0 && (
          <details className={styles.comparisonSources}>
            <summary>Source notes</summary>
            <p>{explained[0].item.source}</p>
          </details>
        )}
      </section>
    </div>
  );
}
