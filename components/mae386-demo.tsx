"use client";

import { useEffect, useState } from "react";
import styles from "./catching-unicorns-demo.module.css";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { VoiceDemoControls } from "./voice-demo/controls";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { MAE386_LESSON, MAE386_QUESTION_GROUPS } from "@/lib/lesson-runtime/mae386-lesson";
import { authoredQuestionProgress } from "@/lib/lesson-runtime/lesson-definition";
import { LESSON_TIMING, type LessonRuntime } from "@/lib/lesson-runtime/lesson-runtime";
import { Mae386Presentation } from "./mae386/presentation";

export function mae386DiagnosticReport(runtime: LessonRuntime) {
  const snapshot = runtime.snapshot();
  return {
    ...runtime.report(),
    lesson: { id: MAE386_LESSON.id, nodeId: snapshot.runtime?.nodeId ?? MAE386_LESSON.initialNodeId },
    questionOutcomes: snapshot.questionOutcomes,
    questionRecap: snapshot.questionRecap,
  };
}

export default function Mae386Demo({ debug = false }: { debug?: boolean }) {
  const { audio, sceneRef, snapshot, live, start, stop, download, support, skip } = useVoiceDemo({
    lesson: MAE386_LESSON,
    exportReport: mae386DiagnosticReport,
    exportPrefix: "sprout-mae386",
  });
  const state = snapshot?.runtime;
  const nodeId = state?.nodeId ?? MAE386_LESSON.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const progress = authoredQuestionProgress(MAE386_LESSON, nodeId);
  const completed = state?.phase === "complete";
  const recap = snapshot?.questionRecap;
  const progressText = recap ? recap.label : progress ? `Question ${progress.questionNumber} of 8` : "Recap";
  // Early Stop reports the reached position, never eight completed questions.
  const position = completed || nodeId === "recap" ? 8 : (progress?.questionNumber ?? 8) - 1;
  const quietControlKey =
    live &&
    state?.phase === "active" &&
    nodeId !== "recap" &&
    !snapshot?.awaitingSteering &&
    !state.childSpeaking &&
    !state.childCandidate &&
    state.outputActivity === "quiet" &&
    state.quietSinceMs !== null
      ? `${state.runtimeId}:${state.visitId}:${state.quietSinceMs}`
      : null;
  const [readyControlKey, setReadyControlKey] = useState<string | null>(null);
  useEffect(() => {
    if (!quietControlKey) return;
    // Initial silent playback need not publish clock ticks. Enable the UI after
    // quiet even then; the runtime independently rechecks every action.
    const timer = setTimeout(
      () => setReadyControlKey(quietControlKey),
      Math.max(LESSON_TIMING.quietDrainMs, LESSON_TIMING.tutorClassificationQuietMs),
    );
    return () => clearTimeout(timer);
  }, [quietControlKey]);
  const controlsReady = quietControlKey !== null && quietControlKey === readyControlKey;

  return (
    <main className={styles.lesson}>
      <div className={styles.stage}>
        <header className="mx-auto mb-8 w-full max-w-[1064px]">
          <h1 className="text-xl font-semibold">MAE386 spoken practice</h1>
          <p className="mt-2 text-sm">Eight questions · Speak in your own words · Formative feedback</p>
        </header>
        <div className={styles.progress}>
          <div
            role="progressbar"
            aria-label="Discussion progress"
            aria-valuemin={0}
            aria-valuemax={8}
            aria-valuenow={position}
            aria-valuetext={progressText}
            className={styles.segments}
          >
            {MAE386_QUESTION_GROUPS.map((group, index) => (
              <div
                key={group.questionId}
                aria-hidden="true"
                data-state={index < position ? "completed" : index === position && !recap ? "active" : "upcoming"}
                className={`${styles.segment} ${index < position ? styles.completedSegment : index === position && !recap ? styles.activeSegment : ""}`}
              />
            ))}
          </div>
          <span className={styles.counter}>{progress ? `${progress.questionNumber} of 8` : "Recap"}</span>
        </div>
        <section className={styles.scene} aria-label="Lesson scene">
          <div
            ref={sceneRef}
            className={styles.presentation}
            data-render-token={identity.token}
            data-node-id={identity.nodeId ?? "complete"}
            data-scene-id={identity.sceneId ?? "complete"}
          >
            <Mae386Presentation nodeId={nodeId} recap={recap} />
          </div>
        </section>
        <footer className="space-y-5">
          <div role="status">{completed ? "Session complete" : (recap?.label ?? snapshot?.status ?? "Ready")}</div>
          {snapshot?.error && <p role="alert">{snapshot.error}</p>}
          {!recap && nodeId !== "recap" && (
            <div className={styles.controls}>
              <button className={styles.button} disabled={!controlsReady} onClick={() => support("help")}>
                Help
              </button>
              <button className={styles.button} disabled={!controlsReady} onClick={() => support("repeat")}>
                Repeat question
              </button>
              <button className={styles.button} disabled={!controlsReady} onClick={() => skip("subpart")}>
                {progress && progress.subpartCount > 1 ? "Skip this part" : "Skip question"}
              </button>
              {progress && progress.subpartCount > 1 && (
                <button className={styles.button} disabled={!controlsReady} onClick={() => skip("question")}>
                  Skip whole question
                </button>
              )}
            </div>
          )}
          <VoiceDemoControls
            snapshot={snapshot}
            live={live}
            completed={completed}
            start={start}
            stop={stop}
            download={download}
            startLabel="Start practice"
            restartLabel="Restart practice"
            classNames={{ controls: styles.controls, startButton: styles.startButton, button: styles.button }}
          />
          {!recap && (
            <p className="text-sm">
              You can also ask for help or repetition aloud. “Next” moves one part; “next question” skips remaining
              parts. Say “stop” to end. Controls become available when speech is quiet.
            </p>
          )}
        </footer>
      </div>
      <audio ref={audio} />
      {debug && (
        <details className={styles.sessionDetails}>
          <summary>Session details</summary>
          <button className={styles.button} disabled={!snapshot} onClick={download}>
            Export session
          </button>
          <h2 className="mt-5 font-semibold">Conversation so far</h2>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
            {snapshot?.transcript || "Your transcript will appear here."}
          </pre>
          <h2 className="mt-5 font-semibold">Assessment diagnostics</h2>
          <p>Secondary review does not change the frozen recap. Unavailable assessment remains uncertain.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(scrubSecrets(snapshot?.assessment ?? { status: "idle" }), null, 2)}
          </pre>
          <details>
            <summary>Runtime diagnostics</summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(
                snapshot?.diagnostics.map(event => ({ atMs: event.atMs, type: event.type, nodeId: event.nodeId })) ??
                  [],
                null,
                2,
              )}
            </pre>
          </details>
          <p>
            Export includes original conversation, evidence provenance, navigation, current rewrite history and frozen
            outcomes. Quiet audio drain: {LESSON_TIMING.quietDrainMs} ms minimum.
          </p>
        </details>
      )}
    </main>
  );
}
