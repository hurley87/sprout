import styles from "../catching-unicorns-demo.module.css";
import { conceptPresentation, type SceneProps } from "./presentation-helpers";

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
