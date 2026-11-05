"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { Figtree } from "next/font/google";
import { useEffect, useRef } from "react";
import { formatExpression } from "@/lib/math-audit/format";
import { MATH_SCRIBE_LESSON } from "@/lib/lesson-runtime/math-scribe-lesson";
import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { getMathScribeProblem, isMathScribeProblemId, type MathScribeProblemId } from "@/lib/math-scribe/problems";
import { MicButton } from "./calculus/mic-button";
import { useMicState } from "./calculus/use-mic-state";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { historyRows, proposalLabel, showDoneHint, spokenTrail } from "./math-steps-model";
import type { PendingVersion } from "@/lib/math-scribe/session";
import theme from "./calculus/calculus-theme.module.css";
import styles from "./math-steps-demo.module.css";

const figtree = Figtree({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-figtree",
});

function Equation({ latex, display = false }: { latex: string; display?: boolean }) {
  let html: string;
  try {
    html = katex.renderToString(latex, {
      trust: false,
      throwOnError: true,
      maxExpand: 100,
      maxSize: 20,
      displayMode: display,
    });
  } catch {
    return <span>{latex}</span>;
  }
  return <span className={styles.equation} dangerouslySetInnerHTML={{ __html: html }} />;
}

function SpokenTrail({ versions, current }: { versions: readonly PendingVersion[]; current: number | undefined }) {
  const trail = spokenTrail(versions, current);
  if (!trail.quotes.length) return null;
  return (
    <div className={styles.detailsText}>
      <p>You said:</p>
      <ol>
        {trail.quotes.map((quote, index) => (
          <li key={index}>“{quote}”</li>
        ))}
      </ol>
      {trail.misheard.map((version, index) => (
        <p key={index}>
          Misheard as <Equation latex={formatExpression(version.expression)} /> “{version.quote}”
        </p>
      ))}
    </div>
  );
}

function problemIds(lesson: LessonDefinition): MathScribeProblemId[] {
  const ids: MathScribeProblemId[] = [];
  let nodeId: string = lesson.initialNodeId;
  while (isMathScribeProblemId(nodeId) && !ids.includes(nodeId)) {
    ids.push(nodeId);
    const next = lesson.nodes[nodeId]?.onSuccess;
    if (!next || next.kind !== "node") break;
    nodeId = next.nodeId;
  }
  return ids;
}

export default function MathStepsDemo({
  debug = false,
  lesson = MATH_SCRIBE_LESSON,
}: {
  debug?: boolean;
  lesson?: LessonDefinition;
}) {
  const { audio, sceneRef, snapshot, live, start, stop, download, skip, supportReady, scribeAction } = useVoiceDemo({
    lesson,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-math-steps",
  });
  const mic = useMicState({ snapshot, live });
  const nodeId = snapshot?.runtime?.nodeId ?? lesson.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const completed = snapshot?.runtime?.phase === "complete" || !isMathScribeProblemId(nodeId);
  const problem = isMathScribeProblemId(nodeId) ? getMathScribeProblem(nodeId) : null;
  const ids = problemIds(lesson);
  const scribe = snapshot?.scribe;
  const session = scribe?.session;
  const pending = session?.pending;
  const discrepancy = session?.lastCheck?.verdict === "not-equivalent" ? session.lastCheck.discrepancy : undefined;
  const role = discrepancy?.status === "localized" ? discrepancy.role : undefined;
  const current = pending?.versions[pending.current];
  const active = live && snapshot?.status === "live";
  const steps = session ? historyRows(session).slice(1) : [];
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [nodeId, current?.at, session?.history.length]);
  const line = scribe?.checking
    ? "Checking…"
    : scribe?.interpreting
      ? "Writing it down…"
      : mic.kind === "before"
        ? "Tap to start"
        : mic.kind === "tutor"
          ? "Sprout is talking"
          : mic.kind === "listening" || mic.kind === "your-turn"
            ? "Listening…"
            : mic.line;
  const microphone = { ...mic, line };
  const trail = pending ? spokenTrail(pending.versions, pending.current) : null;

  return (
    <div className={`${styles.page} ${theme.theme} ${figtree.variable}`}>
      <main className={styles.main}>
        <section
          className={styles.problem}
          aria-label="Current problem"
          ref={sceneRef}
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          {completed ? (
            <>
              <h1>Practice done</h1>
              <p>Thanks for practicing. Problems: {ids.map(id => getMathScribeProblem(id).recapName).join(" and ")}.</p>
            </>
          ) : (
            problem && (
              <>
                <div className={styles.problemHeading}>
                  <h1>Simplify</h1>
                  {ids.length > 1 && (
                    <span>
                      Problem {ids.indexOf(problem.id) + 1} of {ids.length}
                    </span>
                  )}
                </div>
                {problem.statement && <p>{problem.statement}</p>}
                <Equation latex={problem.latex} display={problem.id === "difference-quotient"} />
                {problem.id === "difference-quotient" && (
                  <p className={styles.restrictions}>
                    Required: <Equation latex={String.raw`x\neq-1,\quad x+h\neq-1,\quad h\neq0`} /> (h ≠ 0 given)
                  </p>
                )}
              </>
            )
          )}
        </section>
        {!completed && (
          <section className={styles.working} aria-label="Working" aria-live="polite">
            <h2 className={styles.sectionLabel}>Your working</h2>
            {!steps.length && !pending && (
              <p className={styles.empty}>
                {problem?.id === "difference-quotient"
                  ? "Tap the mic and tell Sprout your first step."
                  : "Tap the mic and tell Sprout your first step — for example, 'flip the second fraction'."}
              </p>
            )}
            <ol className={styles.history}>
              {steps.map((row, index) => (
                <li
                  key={row.id}
                  className={`${styles.historyRow} ${index === steps.length - 1 && !pending ? styles.latest : ""} ${row.withdrawn ? styles.withdrawn : ""}`}
                >
                  <details open={debug || undefined}>
                    <summary>
                      <span className={styles.mathLine}>
                        <span aria-hidden="true">=</span>
                        <Equation latex={row.latex} display={problem?.id === "difference-quotient"} />
                      </span>
                      <span
                        className={styles.badge}
                        title={`${row.badge}${row.withdrawn ? " · Withdrawn" : ""}`}
                        aria-label={`${row.badge}${row.withdrawn ? " · Withdrawn" : ""}`}
                      >
                        {row.badge.startsWith("?") ? "?" : row.badge.includes("Valid ·") ? "⚠" : "✓"}
                      </span>
                    </summary>
                    <div className={styles.detailsText}>
                      <SpokenTrail versions={row.versions} current={row.current} />
                      {row.domainNotes.map(note => (
                        <p key={`${note.label}:${note.latex}`}>
                          {note.label} <Equation latex={note.latex} />
                        </p>
                      ))}
                    </div>
                  </details>
                  {row.retained && (
                    <p className={styles.retained}>
                      Still required by the problem: <Equation latex={row.retained} />
                    </p>
                  )}
                </li>
              ))}
              {pending && current && (
                <li className={styles.pending}>
                  <p className={styles.pendingLabel}>
                    {pending.status === "invalid" || pending.status === "unverified"
                      ? proposalLabel(pending.status, role)
                      : "Not checked yet"}
                  </p>
                  <div className={styles.mathLine}>
                    <span aria-hidden="true">=</span>
                    <Equation latex={session!.workingLine.latex} display={problem?.id === "difference-quotient"} />
                  </div>
                  {trail?.misheard.map((version, index) => (
                    <p className={styles.detailsText} key={index}>
                      Misheard as <Equation latex={formatExpression(version.expression)} /> “{version.quote}”
                    </p>
                  ))}
                  <div className={styles.actions}>
                    <button onClick={() => scribeAction("check")} disabled={!active || !!scribe?.checking}>
                      Check
                    </button>
                    <button onClick={() => scribeAction("undo")} disabled={!active}>
                      Undo
                    </button>
                    {pending.status === "unverified" && (
                      <button onClick={() => scribeAction("continue")} disabled={!active}>
                        Continue anyway
                      </button>
                    )}
                  </div>
                </li>
              )}
            </ol>
            {session && showDoneHint(session) && (
              <p className={styles.hint}>Say &apos;I&apos;m done&apos; to finish.</p>
            )}
            {session?.clarification && (
              <div className={styles.clarification} aria-label="Clarification">
                <p>{session.clarification.question}</p>
                {session.clarification.readings?.map((reading, index) => (
                  <div key={index}>
                    <Equation latex={formatExpression(reading)} />
                  </div>
                ))}
              </div>
            )}
            <div ref={endRef} className={styles.scrollTarget} />
          </section>
        )}
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
      <div className={styles.bottomBar} aria-label="Voice controls">
        <div className={styles.caption} aria-live="polite">
          {current?.quote && <span key={`${nodeId}:${pending?.current}:${current.at}`}>“{current.quote}”</span>}
        </div>
        <MicButton state={microphone} onStart={start} onStop={stop} onAction={start} />
        {active && !completed && ids.length > 1 && (
          <button className={styles.skip} onClick={() => skip("question")} disabled={!supportReady}>
            Next problem
          </button>
        )}
      </div>
      <audio ref={audio} />
    </div>
  );
}
