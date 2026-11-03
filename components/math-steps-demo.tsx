"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { Figtree } from "next/font/google";
import { formatExpression } from "@/lib/math-audit/format";
import { MATH_SCRIBE_LESSON } from "@/lib/lesson-runtime/math-scribe-lesson";
import { getMathScribeProblem, isMathScribeProblemId, MATH_SCRIBE_PROBLEM_IDS } from "@/lib/math-scribe/problems";
import { MicButton } from "./calculus/mic-button";
import { useMicState } from "./calculus/use-mic-state";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { historyRows, proposalLabel } from "./math-steps-model";
import theme from "./calculus/calculus-theme.module.css";
import styles from "./math-steps-demo.module.css";

const figtree = Figtree({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-figtree",
});

function Equation({ latex }: { latex: string }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { trust: false, throwOnError: true, maxExpand: 100, maxSize: 20 });
  } catch {
    return <span>{latex}</span>;
  }
  return <span className={styles.equation} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function MathStepsDemo({ debug = false }: { debug?: boolean }) {
  const { audio, sceneRef, snapshot, live, start, stop, download, skip, supportReady, scribeAction } = useVoiceDemo({
    lesson: MATH_SCRIBE_LESSON,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-math-steps",
  });
  const calculusMic = useMicState({ snapshot, live });
  // The shared mic states are written for the three-problem calculus demo.
  const microphone =
    calculusMic.kind === "before"
      ? { ...calculusMic, line: `Tap to start · ${MATH_SCRIBE_PROBLEM_IDS.length} problems` }
      : calculusMic;
  const nodeId = snapshot?.runtime?.nodeId ?? MATH_SCRIBE_LESSON.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const completed = nodeId === "recap" || snapshot?.runtime?.phase === "complete";
  const problem = isMathScribeProblemId(nodeId) ? getMathScribeProblem(nodeId) : null;
  const scribe = snapshot?.scribe;
  const session = scribe?.session;
  const pending = session?.pending;
  const discrepancy = session?.lastCheck?.verdict === "not-equivalent" ? session.lastCheck.discrepancy : undefined;
  const role = discrepancy?.status === "localized" ? discrepancy.role : undefined;
  const current = pending?.versions[pending.current];
  const active = live && snapshot?.status === "live";
  // The problem card already shows the starting line; history lists only the steps after it.
  const steps = session ? historyRows(session).slice(1) : [];

  return (
    <div className={`${styles.page} ${theme.theme} ${figtree.variable}`}>
      <main className={styles.main}>
        <p className={styles.lead}>
          Tell Sprout what to change; it writes the line and checks it when you say &apos;check&apos;.
        </p>
        <section
          className={styles.card}
          aria-label="Current problem"
          ref={sceneRef}
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          {completed ? (
            <>
              <h2>Practice done</h2>
              <p>
                Thanks for practicing. Problems:{" "}
                {MATH_SCRIBE_PROBLEM_IDS.map(id => getMathScribeProblem(id).recapName).join(" and ")}.
              </p>
            </>
          ) : problem ? (
            <>
              <p className={styles.eyebrow}>
                Problem {MATH_SCRIBE_PROBLEM_IDS.indexOf(problem.id) + 1} of {MATH_SCRIBE_PROBLEM_IDS.length}
              </p>
              <Equation latex={problem.latex} />
            </>
          ) : null}
        </section>
        {!completed && (
          <>
            {steps.length > 0 && (
              <section className={styles.card} aria-label="Working history">
                <h2>Working history</h2>
                <ol className={styles.history}>
                  {steps.map(row => (
                    <li key={row.id} className={row.withdrawn ? styles.withdrawn : ""}>
                      <div>
                        <Equation latex={row.latex} />
                        {row.versions.map(
                          (version, index) =>
                            index !== row.current && (
                              <p className={styles.earlier} key={index}>
                                You corrected: <Equation latex={formatExpression(version.expression)} />{" "}
                                <span>“{version.quote}”</span>
                              </p>
                            ),
                        )}
                      </div>
                      <span className={styles.badge}>
                        {row.badge}
                        {row.withdrawn ? " · Withdrawn" : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <section className={styles.card} aria-label="What I heard" aria-live="polite">
              <h2>What I heard</h2>
              {pending && current ? (
                <>
                  <Equation latex={session!.workingLine.latex} />
                  <p className={styles.status}>{proposalLabel(pending.status, role)}</p>
                  <p>“{current.quote}”</p>
                  {pending.versions.map(
                    (version, index) =>
                      index !== pending.current && (
                        <p className={styles.earlier} key={index}>
                          You corrected: <Equation latex={version.latex} /> <span>“{version.quote}”</span>
                        </p>
                      ),
                  )}
                </>
              ) : (
                <p>Tell Sprout what you want to change.</p>
              )}
              <div className={styles.actions}>
                <button onClick={() => scribeAction("confirm")} disabled={!active || !pending || pending.confirmed}>
                  Confirm
                </button>
                <button onClick={() => scribeAction("undo")} disabled={!active || !session}>
                  Undo
                </button>
                <button onClick={() => scribeAction("check")} disabled={!active || !pending || !!scribe?.checking}>
                  Check step
                </button>
                {pending?.status === "unverified" && (
                  <button onClick={() => scribeAction("continue")} disabled={!active}>
                    Continue anyway
                  </button>
                )}
              </div>
            </section>
            <div aria-live="polite">
              {session?.clarification && (
                <section className={`${styles.card} ${styles.clarification}`} aria-label="Clarification">
                  <h2>Let&apos;s clarify</h2>
                  <p>{session.clarification.question}</p>
                  {session.clarification.readings?.map((reading, index) => (
                    <div key={index}>
                      <Equation latex={formatExpression(reading)} />
                    </div>
                  ))}
                </section>
              )}
            </div>
            <div className={styles.mic}>
              <p aria-live="polite">
                {scribe?.checking ? "Checking…" : scribe?.interpreting ? "Interpreting…" : live ? "Listening" : ""}
              </p>
              <MicButton state={microphone} onStart={start} onStop={stop} onAction={start} />
              {active && (
                <button className={styles.next} onClick={() => skip("question")} disabled={!supportReady}>
                  Next problem
                </button>
              )}
            </div>
          </>
        )}
        {completed && (
          <button className={styles.next} onClick={start} disabled={live}>
            Practise again
          </button>
        )}
        <p className={styles.note}>Sprout checks what you tell it, not your paper.</p>
        {snapshot?.error && <p role="alert">{snapshot.error}</p>}
        {debug && (
          <details className={styles.debug}>
            <summary>Session details</summary>
            <button disabled={!snapshot} onClick={download}>
              Export session
            </button>
            <h2>Session metrics</h2>
            <pre>
              {JSON.stringify(
                scrubSecrets({
                  metrics: scribe?.metrics,
                  speechEndToProposalMs: scribe?.speechEndToProposalMs,
                  checkRequestToInstructionMs: scribe?.checkRequestToInstructionMs,
                }),
                null,
                2,
              )}
            </pre>
          </details>
        )}
      </main>
      <audio ref={audio} />
    </div>
  );
}
