"use client";

import "katex/dist/katex.min.css";
import Link from "next/link";
import { Figtree } from "next/font/google";
import { CALCULUS_LESSON } from "@/lib/lesson-runtime/calculus-lesson";
import type { CalculusVisit } from "@/lib/lesson-runtime/calculus-runtime";
import {
  CALCULUS_PROBLEM_IDS,
  getCalculusProblem,
  isCalculusProblemId,
  type CalculusProblemId,
} from "@/lib/calculus/problems";
import { renderMathExpression } from "@/lib/calculus/math-rendering";
import { emptyWork } from "@/lib/calculus/work-check";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { CalculusHeader, type CalculusProgressSegment } from "./calculus/calculus-header";
import { WorkChecklist } from "./calculus/work-checklist";
import { MicButton } from "./calculus/mic-button";
import { useMicState } from "./calculus/use-mic-state";
import styles from "./calculus-demo.module.css";
import theme from "./calculus/calculus-theme.module.css";

const figtree = Figtree({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-figtree",
});

function ProblemEquation({ problemId }: { problemId: CalculusProblemId }) {
  const result = renderMathExpression(getCalculusProblem(problemId).functionExpression);
  return (
    <span className={styles.equation}>
      <span aria-hidden="true">
        <span className={styles.functionLabel}>f(x) = </span>
        {result.ok ? <span dangerouslySetInnerHTML={{ __html: result.html }} /> : result.text}
      </span>
      <span className={styles.srOnly}>f of x equals {result.text}</span>
    </span>
  );
}

function recapNote(visit: CalculusVisit) {
  if (visit.outcome === "skipped") return "Skipped";
  if (visit.outcome !== "completed") return "Not finished";
  const corrected = visit.checks.some(check => ["incorrect", "combine", "wrong-rule"].includes(check.outcome ?? ""));
  if (visit.help && corrected) return "Needed a hint and another look";
  if (visit.help) return "Needed a hint";
  if (corrected) return "One step needed another look";
  return "First try";
}

export default function CalculusDemo({ debug = false }: { debug?: boolean }) {
  const { audio, sceneRef, snapshot, live, start, stop, download, support, skip, supportReady } = useVoiceDemo({
    lesson: CALCULUS_LESSON,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-calculus",
  });
  const state = snapshot?.runtime;
  const microphone = useMicState({ snapshot, live });
  const nodeId = state?.nodeId ?? CALCULUS_LESSON.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const completed = nodeId === "recap" || state?.phase === "complete";
  const before = !snapshot;
  const problemId = isCalculusProblemId(nodeId) ? nodeId : null;
  const number = CALCULUS_PROBLEM_IDS.findIndex(id => id === problemId) + 1;
  const visits = snapshot?.math?.visits ?? [];
  const lastVisits = CALCULUS_PROBLEM_IDS.map(id => visits.findLast(visit => visit.problemId === id));
  const progress = CALCULUS_PROBLEM_IDS.map((_, index): CalculusProgressSegment => {
    if (before) return "next";
    if (!completed && index === number - 1) return "current";
    if (lastVisits[index]?.outcome === "skipped") return "skip";
    if (lastVisits[index]?.outcome === "completed") return "done";
    return "next";
  });
  const math =
    snapshot?.math ?? (problemId ? { work: emptyWork(problemId), checking: false, complete: false, visits: [] } : null);

  return (
    <div className={`${styles.page} ${theme.theme} ${figtree.variable}`}>
      <CalculusHeader
        progress={progress}
        label={before ? "3 problems" : completed ? "All problems done" : `Problem ${number} of 3`}
        showStuck={!before && !completed}
        stuckDisabled={!supportReady}
        onHint={() => support("help")}
        onRepeat={() => support("repeat")}
        onSkip={() => skip("question")}
      />
      <main className={styles.main}>
        <section
          aria-label="Current problem"
          className={before ? styles.intro : completed ? styles.recapHeading : styles.prompt}
          ref={sceneRef}
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          {before ? (
            <>
              <p className={styles.eyebrow}>Spoken practice</p>
              <h1 className={styles.title}>Differentiation</h1>
            </>
          ) : completed ? (
            <>
              <span className={styles.doneDisc} aria-hidden="true">
                ✓
              </span>
              <h1 className={styles.recapTitle}>Practice done</h1>
              <p className={styles.recapNote}>Practice finished.</p>
            </>
          ) : problemId ? (
            <>
              <p className={styles.eyebrow}>Differentiate</p>
              <h1 className={styles.problemTitle}>
                <ProblemEquation problemId={problemId} />
              </h1>
              <p className={styles.srOnly}>Problem {number} of 3</p>
              <p className={styles.srOnly}>{CALCULUS_LESSON.nodes[nodeId]?.presentation.prompt}</p>
            </>
          ) : null}
        </section>
        {completed ? (
          <>
            <section className={styles.recapCard} aria-label="Recap">
              {lastVisits.map((visit, index) => {
                if (!visit) return null;
                const items = [...visit.work.steps, visit.work.final];
                return (
                  <div className={styles.recapRow} key={visit.problemId}>
                    <span className={styles.problemNumber}>{index + 1}</span>
                    <div>
                      <div className={styles.recapEquation}>
                        <ProblemEquation problemId={visit.problemId} />
                      </div>
                      <p className={styles.recapNote}>{recapNote(visit)}</p>
                    </div>
                    <div
                      className={styles.dots}
                      role="img"
                      aria-label={items
                        .map(item => `${item.label}: ${item.status === "correct" ? "correct" : "not correct yet"}`)
                        .join("; ")}
                    >
                      {items.map(item => (
                        <span
                          key={item.id}
                          aria-hidden="true"
                          className={`${styles.dot} ${item.status === "correct" ? styles.correctDot : ""}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
            <button className={styles.restart} onClick={start}>
              Practise again
            </button>
          </>
        ) : (
          <>
            {!before && math ? (
              <div className={styles.work}>
                <WorkChecklist math={math} />
              </div>
            ) : null}
            <div className={styles.micArea}>
              <MicButton state={microphone} onStart={start} onStop={stop} onAction={start} />
            </div>
          </>
        )}
        {debug ? (
          <button type="button" className={styles.diagnostics} disabled={!snapshot} onClick={download}>
            Download diagnostics
          </button>
        ) : null}
        {snapshot?.error ? (
          <p className={styles.error} role="alert">
            {snapshot.error}
          </p>
        ) : null}
      </main>
      <Link href="/" className={styles.home}>
        Back to home
      </Link>
      <audio ref={audio} />
      {debug ? (
        <details className={styles.debug}>
          <summary>Session details</summary>
          <p>
            Export includes the transcript, every step check with what was heard and how it was judged, tutor
            instructions and local timing.
          </p>
          <button disabled={!snapshot} onClick={download}>
            Export session
          </button>
          <pre>{JSON.stringify(scrubSecrets(snapshot), null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
