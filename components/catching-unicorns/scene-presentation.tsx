import styles from "../catching-unicorns-demo.module.css";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import {
  evidenceFor,
  revealText,
  sceneIds,
  Revealed,
  EvidenceState,
  SceneHeader,
  type RevealItem,
} from "./presentation-helpers";
import { MemoryPromptScene, MemoryComparisonScene } from "./memory-scenes";
import { ExographicsPromptScene, ExographicsReasoningScene } from "./exographics-scenes";
import { CultureScene, ApplicationScene, SynthesisScene } from "./culture-scenes";
import { RecapPresentation } from "./recap-presentation";

export function ScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const learned = sceneIds.slice(0, sceneIds.indexOf(nodeId)).flatMap(id =>
    (CATCHING_UNICORNS_LESSON.nodes[id].concepts ?? []).flatMap(concept => {
      const item = revealText(id as keyof typeof CATCHING_UNICORNS_PRESENTATION, concept.id);
      return item && evidenceFor(state, id, concept.id)?.status === "demonstrated"
        ? [{ criterionId: concept.id, item }]
        : [];
    }),
  );

  return (
    <>
      <CurrentScenePresentation state={state} />
      {nodeId !== "recap" && learned.length > 0 && (
        <section className={styles.learned} aria-labelledby="learned-so-far-title">
          <h3 id="learned-so-far-title">Learned so far</h3>
          <ul className={styles.learnedList}>
            {learned.map(({ criterionId, item }) => (
              <li key={criterionId}>
                <details className={styles.learnedConcept}>
                  <summary>{item.title}</summary>
                  <p>{item.text}</p>
                  <p className={styles.learnedSource}>Source: {item.source}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CurrentScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const node = CATCHING_UNICORNS_LESSON.nodes[nodeId];
  const scene = CATCHING_UNICORNS_PRESENTATION[nodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION];

  if (nodeId === "recap") return <RecapPresentation state={state} />;

  const currentReveals = (scene as { readonly reveals?: Readonly<Record<string, RevealItem>> }).reveals ?? {};
  const revealCards = Object.entries(currentReveals).map(([criterionId, item]) => ({
    criterionId,
    item,
    evidence: evidenceFor(state, nodeId, criterionId),
  }));

  const props = { state, nodeId, node, revealCards };

  if (nodeId === "engram" || nodeId === "exogram") return <MemoryPromptScene {...props} nodeId={nodeId} />;
  if (nodeId === "compare") return <MemoryComparisonScene {...props} />;
  if (nodeId === "exographics") return <ExographicsPromptScene {...props} />;
  if (nodeId === "techno-literate-culture") return <CultureScene {...props} />;
  if (nodeId === "caf-application") return <ApplicationScene {...props} />;
  if (nodeId === "synthesis") return <SynthesisScene {...props} />;
  if (nodeId === "why-exographics") return <ExographicsReasoningScene {...props} />;

  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        {revealCards.map(({ criterionId, item, evidence }) =>
          evidence?.status === "demonstrated" ? (
            <Revealed key={criterionId} item={item} />
          ) : (
            <article className="rounded-xl border bg-white p-4" key={criterionId}>
              <h3 className="font-medium">Concept not yet revealed</h3>
              <EvidenceState evidence={evidence} />
            </article>
          ),
        )}
      </div>
    </div>
  );
}
