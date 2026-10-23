"use client";

import { useState } from "react";
import Link from "next/link";
import { CALCULUS_LESSON } from "@/lib/lesson-runtime/calculus-lesson";
import { CALCULUS_PROBLEM_IDS } from "@/lib/calculus/problems";
import type { MathPendingProposal } from "@/lib/calculus/math-controller";
import type { MathOperation } from "@/lib/calculus/spoken-confirmation";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { VoiceDemoControls } from "./voice-demo/controls";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { MathWhiteboard } from "./calculus/math-whiteboard";
import styles from "./calculus-demo.module.css";

function Confirmation({
  pending,
  disabled,
  confirm,
}: {
  pending: MathPendingProposal;
  disabled: boolean;
  confirm: (id: string, revision: number, operations: MathOperation[]) => void;
}) {
  const [operations, setOperations] = useState<MathOperation[]>(pending.batch.actions.map(() => "unassessed"));
  return (
    <fieldset disabled={disabled || !pending.displayed} className={styles.confirmation}>
      <legend>Confirm your intended actions</legend>
      <p>
        For one action, say “confirm differentiation”, “confirm rewrite”, or “confirm without checking”. For several,
        use the controls below, or say “action 1 confirm rewrite; action 2 confirm differentiation”, in order.
      </p>
      {operations.map((operation, index) => (
        <label key={index}>
          Action {index + 1} operation
          <select
            value={operation}
            onChange={event =>
              setOperations(previous =>
                previous.map((value, i) => (i === index ? (event.target.value as MathOperation) : value)),
              )
            }
          >
            <option value="unassessed">Without checking the operation</option>
            <option value="differentiate">Differentiation</option>
            <option value="rewrite">Rewrite</option>
          </select>
        </label>
      ))}
      <button onClick={() => confirm(pending.id, pending.boardRevision, operations)}>Confirm displayed actions</button>
      <p>
        Confirmation records your intended notation and operation. It does not show your reasoning or independent
        understanding.
      </p>
    </fieldset>
  );
}

export default function CalculusDemo({ debug = false }: { debug?: boolean }) {
  const {
    audio,
    sceneRef,
    snapshot,
    live,
    start,
    stop,
    download,
    support,
    skip,
    supportReady,
    proposalDisplayed,
    feedbackDisplayed,
    confirmProposal,
  } = useVoiceDemo({
    lesson: CALCULUS_LESSON,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-calculus",
  });
  const state = snapshot?.runtime;
  const nodeId = state?.nodeId ?? CALCULUS_LESSON.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const completed = state?.phase === "complete";
  const ready =
    live && state?.phase === "active" && !snapshot?.awaitingSteering && !state.childSpeaking && !state.childCandidate;
  const number = CALCULUS_PROBLEM_IDS.findIndex(id => id === nodeId) + 1;
  return (
    <main className={styles.page}>
      <header>
        <p>Spoken practice · Three problems</p>
        <h1>Calculus practice</h1>
        <p>Speak your steps, review what we heard, then confirm your intended actions.</p>
      </header>
      <div className={styles.layout}>
        <section
          aria-label="Current problem"
          className={styles.prompt}
          ref={sceneRef}
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          <p>{number ? `Problem ${number} of 3` : "Practice recap"}</p>
          <h2>{CALCULUS_LESSON.nodes[nodeId]?.presentation.prompt ?? "Practice finished"}</h2>
          <p>
            Say the full expression, including signs and every term. You can correct a step or ask to undo your latest
            edit.
          </p>
        </section>
        <div className={styles.work}>
          {snapshot?.math ? (
            <MathWhiteboard
              math={snapshot.math}
              onProposalDisplayed={proposalDisplayed}
              onFeedbackDisplayed={feedbackDisplayed}
            />
          ) : (
            <section aria-label="Mathematical work">
              <h2>Your mathematical work</h2>
              <p>Start to record your own steps here.</p>
            </section>
          )}
          {snapshot?.math?.pending ? (
            <Confirmation
              key={snapshot.math.pending.id}
              pending={snapshot.math.pending}
              disabled={!ready}
              confirm={confirmProposal}
            />
          ) : null}
        </div>
      </div>
      <footer>
        <p aria-live="polite">
          {completed
            ? "Practice finished."
            : snapshot?.status === "ended"
              ? "Session stopped. Your recorded work is retained."
              : state?.childSpeaking
                ? "Listening. Finish your turn before confirming."
                : live
                  ? "Connected. Say your next step when ready."
                  : "Ready to begin."}
        </p>
        {snapshot?.error ? <p role="alert">{snapshot.error}</p> : null}
        {nodeId !== "recap" ? (
          <div className={styles.controls}>
            <button disabled={!supportReady} onClick={() => support("help")}>
              Help
            </button>
            <button disabled={!supportReady} onClick={() => support("repeat")}>
              Repeat problem
            </button>
            <button disabled={!supportReady} onClick={() => skip("question")}>
              Skip problem
            </button>
          </div>
        ) : null}
        <VoiceDemoControls
          snapshot={snapshot}
          showDownload={debug}
          live={live}
          completed={completed}
          start={start}
          stop={stop}
          download={download}
          startLabel="Start practice"
          restartLabel="Restart practice"
          classNames={{ controls: styles.controls, startButton: styles.start, button: styles.button }}
        />
        <p>
          You can also say “help”, “repeat”, “next”, or “stop”. A correct equation alone does not establish
          understanding.
        </p>
      </footer>
      <Link href="/">Back to home</Link>
      <audio ref={audio} />
      {debug ? (
        <details>
          <summary>Session details</summary>
          <button disabled={!snapshot} onClick={download}>
            Export session
          </button>
          <pre>{JSON.stringify(scrubSecrets(snapshot), null, 2)}</pre>
        </details>
      ) : null}
    </main>
  );
}
