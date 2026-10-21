"use client";

import styles from "./catching-unicorns-demo.module.css";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { VoiceDemoControls } from "./voice-demo/controls";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { LESSON_TIMING, type LessonRuntime } from "@/lib/lesson-runtime/lesson-runtime";
import type { RenderIdentity } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { sceneConcepts, EvidenceState, sceneIds, questionIds } from "./catching-unicorns/presentation-helpers";
import { ScenePresentation } from "./catching-unicorns/scene-presentation";

export { ScenePresentation } from "./catching-unicorns/scene-presentation";

function diagnosticReport(runtime: LessonRuntime) {
  const report = runtime.report();
  const current = runtime.snapshot();
  return {
    ...report,
    lesson: {
      id: CATCHING_UNICORNS_LESSON.id,
      sceneId: current.runtime?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId,
    },
    acceptedEvidence: current.runtime?.conceptEvidence ?? {},
    revealContext: Object.fromEntries(
      sceneIds.map(nodeId => [
        nodeId,
        sceneConcepts(current.runtime, nodeId)
          .filter(concept => concept.demonstrated)
          .map(concept => concept.criterionId),
      ]),
    ),
    transcript: current.transcript,
  };
}

export default function CatchingUnicornsDemo({ debug = false }: { debug?: boolean }) {
  const { audio, sceneRef, snapshot, live, start, stop, download } = useVoiceDemo({
    lesson: CATCHING_UNICORNS_LESSON,
    exportReport: diagnosticReport,
    exportPrefix: "sprout-catching-unicorns",
  });
  const display = snapshot?.display;

  const state = snapshot?.runtime;
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const sceneId = String(CATCHING_UNICORNS_LESSON.nodes[nodeId]?.presentation.sceneId ?? nodeId);
  const identity: RenderIdentity | undefined = display ?? { token: "initial", nodeId, sceneId };

  const completed = state?.phase === "complete";
  const inRecap = nodeId === "recap" || completed;
  const questionNumber = nodeId === "recap" ? questionIds.length : questionIds.indexOf(nodeId) + 1;

  const completedQuestions = inRecap ? questionIds.length : questionNumber - 1;
  const progressText = completed
    ? "Session complete"
    : inRecap
      ? "Recap"
      : `Question ${questionNumber} of ${questionIds.length}`;

  return (
    <main className={styles.lesson}>
      <div className={styles.stage}>
        <h1 className="sr-only">Catching Unicorns</h1>
        <div className={styles.progress}>
          <div
            role="progressbar"
            aria-label="Discussion progress"
            aria-valuemin={0}
            aria-valuemax={questionIds.length}
            aria-valuenow={completedQuestions}
            aria-valuetext={progressText}
            className={styles.segments}
          >
            {questionIds.map((id, index) => (
              <div
                aria-hidden="true"
                data-state={
                  index < completedQuestions
                    ? "completed"
                    : index === completedQuestions && !inRecap
                      ? "active"
                      : "upcoming"
                }
                className={`${styles.segment} ${index < completedQuestions ? styles.completedSegment : index === completedQuestions && !inRecap ? styles.activeSegment : ""}`}
                key={id}
              />
            ))}
          </div>
          <span className={styles.counter} aria-hidden="true">
            {inRecap ? progressText : `${questionNumber} of ${questionIds.length}`}
          </span>
        </div>
        <section className={styles.scene} aria-label="Lesson scene">
          <div
            ref={sceneRef}
            className={styles.presentation}
            data-render-token={identity.token}
            data-node-id={identity.nodeId ?? "complete"}
            data-scene-id={identity.sceneId ?? "complete"}
          >
            <ScenePresentation state={state} recapText={snapshot?.recapText} />
          </div>
        </section>
        <footer className={styles.footer}>
          <div className={styles.sessionStatus}>
            <span role="status" className={state?.phase === "complete" ? undefined : "sr-only"}>
              {state?.phase === "complete" ? "Session complete" : (snapshot?.status ?? "Ready")}
              {debug && snapshot?.awaitingSteering ? " · applying the next scene" : ""}
            </span>
            {snapshot?.error && <span role="alert">{snapshot.error}</span>}
          </div>
          <VoiceDemoControls
            snapshot={snapshot}
            live={live}
            completed={completed}
            start={start}
            stop={stop}
            download={download}
            startLabel="Start discussion"
            restartLabel="Restart discussion"
            classNames={{ controls: styles.controls, startButton: styles.startButton, button: styles.button }}
          />
        </footer>
      </div>
      {debug &&
        (nodeId === "recap" || snapshot?.status === "ended") &&
        snapshot?.assessment &&
        snapshot.assessment.status !== "idle" && (
          <section className="rounded border p-4" aria-label="Conversation assessment">
            <h2 className="font-semibold">Conversation assessment</h2>
            <p aria-live="polite">
              {snapshot.assessment.status === "pending"
                ? "Reviewing your full conversation…"
                : snapshot.assessment.status === "unavailable"
                  ? "Assessment unavailable. Your conversation is saved in the export."
                  : "Evidence across your answers; uncertain results remain open."}
            </p>
            {snapshot.assessment.status === "complete" && (
              <ul className="mt-3 space-y-1">
                {Object.entries(snapshot.assessment.results).map(([key, result]) => (
                  <li key={key}>
                    {String(CATCHING_UNICORNS_LESSON.nodes[result.nodeId].presentation.title)} · item{" "}
                    {(CATCHING_UNICORNS_LESSON.nodes[result.nodeId].concepts ?? []).findIndex(
                      concept => concept.id === result.criterionId,
                    ) + 1}
                    :{" "}
                    {
                      {
                        uncertain: "Uncertain",
                        not_yet: "Not yet demonstrated",
                        partial: "Partly explained",
                        demonstrated_independent: "Explained independently",
                        demonstrated_prompted: "Explained after a prompt",
                      }[result.outcome]
                    }
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      <audio ref={audio} />
      {debug && (
        <details className={styles.sessionDetails}>
          <summary>Session details</summary>
          <div className={styles.detailsToolbar}>
            <button className={styles.button} disabled={!snapshot} onClick={download}>
              Export session
            </button>
            <p>Session transcript, accepted evidence, and diagnostics.</p>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border p-4">
              <h2 className="font-semibold">Conversation so far</h2>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-slate-700">
                {snapshot?.transcript || "Your transcript will appear here after the discussion starts."}
              </pre>
            </div>
            <div className="rounded-2xl border p-4">
              <h2 className="font-semibold">Current evidence</h2>
              <div className="mt-3 space-y-2 text-sm">
                {(nodeId === "recap"
                  ? questionIds.flatMap(id => sceneConcepts(state, id))
                  : sceneConcepts(state, nodeId)
                ).map(concept => (
                  <div key={`${concept.nodeId}:${concept.criterionId}`}>
                    <div className="flex justify-between gap-3">
                      <span>{concept.demonstrated ? (concept.item?.title ?? "Concept") : "Unresolved concept"}</span>
                      <EvidenceState evidence={concept.evidence} />
                    </div>
                    {concept.evidence && (
                      <p className="text-xs text-slate-500">
                        {concept.nodeId} · {concept.criterionId} ·{" "}
                        {concept.evidence.understanding ?? "prompting unclear"} ·{" "}
                        {concept.evidence.source?.childTranscript ?? "No learner transcript"}
                      </p>
                    )}
                    {concept.demonstrated && concept.item && (
                      <details>
                        <summary>Authored concept</summary>
                        <p>{concept.item.text}</p>
                        <p>Source: {concept.item.source}</p>
                      </details>
                    )}
                  </div>
                ))}
                {!CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts?.length && (
                  <p className="text-slate-600">This scene gathers evidence across the lesson.</p>
                )}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                A new start begins a separate attempt. Evidence belongs to this session only.
              </p>
            </div>
          </section>
          <details className="rounded-2xl border p-4">
            <summary className="cursor-pointer font-semibold">Session diagnostics</summary>
            <p className="mt-2 text-sm text-slate-600">
              Export includes this lesson identity, scene, accepted evidence, reveal context, transcript, and scrubbed
              diagnostics.
            </p>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
              {snapshot?.diagnostics.map((event, index) => (
                <details key={`${event.atMs}:${index}`}>
                  <summary className="cursor-pointer">
                    {event.atMs.toFixed(0)} ms · {event.type} · {event.nodeId}
                  </summary>
                  <pre className="overflow-auto whitespace-pre-wrap p-2">
                    {JSON.stringify(scrubSecrets(event), null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          </details>
          <p className="text-xs text-slate-500">
            The app advances after conversational closure or a request to move on, with quiet audio and confirmed
            screens. Assessment follows the conversation. Timing thresholds are shared runtime safeguards, not mastery
            timers ({LESSON_TIMING.quietDrainMs} ms audio drain).
          </p>
        </details>
      )}
    </main>
  );
}
