"use client";

import { useMemo } from "react";
import { isLessonNodeId, lessonNodeOrder } from "@/lib/lesson-runtime/lesson-definition";
import type { CountingTheme } from "./counting-themes";
import { LESSON_TIMING } from "@/lib/lesson-runtime/lesson-runtime";
import { useVoiceDemo } from "@/components/voice-demo/use-voice-demo";
import { VoiceDemoControls } from "@/components/voice-demo/controls";
import { lessonPresentation, showsSuccessFeedback, stageMotion, voiceActivity } from "./lesson-presentation";
import { CountingStage } from "./counting-stage";
import { VoiceCue } from "./voice-cue";
import styles from "./lesson.module.css";

export default function Lesson({ theme, debug = false }: { theme: CountingTheme; debug?: boolean }) {
  const lessonDefinition = theme.lesson;
  const { audio, sceneRef, snapshot, live, start, stop, download } = useVoiceDemo({
    lesson: lessonDefinition,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-lesson",
  });
  const display = snapshot?.display;
  const status = snapshot?.status;
  const nodeIds = useMemo(() => lessonNodeOrder(lessonDefinition), [lessonDefinition]);
  const nodeId = display ? display.nodeId : lessonDefinition.initialNodeId;
  const presented = nodeId && isLessonNodeId(lessonDefinition, nodeId) ? lessonDefinition.nodes[nodeId] : null;
  const node = presented
    ? {
        id: presented.id,
        sceneId: String(presented.presentation.sceneId),
        object: String(presented.presentation.object),
        quantity: Number(presented.presentation.quantity),
      }
    : null;
  const state = snapshot?.runtime;
  const presentation = lessonPresentation(
    snapshot,
    showsSuccessFeedback(snapshot, lessonDefinition) ? node : null,
    theme.copy,
  );
  const completed = presentation.kind === "complete";
  // Authored order of the rendered scene; the terminal render has no counting node.
  const step = node ? nodeIds.indexOf(node.id) : nodeIds.length;

  return (
    <main className="w-full">
      <section className={styles.screen}>
        <div className={styles.scene}>
          <CountingStage
            theme={theme}
            node={node}
            renderToken={display?.token}
            sceneRef={sceneRef}
            motion={stageMotion(snapshot, lessonDefinition)}
          />
        </div>
        <div className={styles.top}>
          <h1 className={styles.title}>Sprout</h1>
          <div className={styles.status}>
            <VoiceCue activity={voiceActivity(presentation)} />
            <p role={presentation.kind === "error" ? "alert" : "status"}>{presentation.message}</p>
          </div>
        </div>
        <div className={styles.bottom}>
          <ol aria-label="Adventure progress" className={`flex items-center gap-3 ${styles.progress}`}>
            {nodeIds.map((id, index) => {
              const progress = index < step ? "done" : index === step ? "current" : "upcoming";
              return (
                <li
                  key={id}
                  data-progress={progress}
                  aria-current={progress === "current" ? "step" : undefined}
                  className={`${theme.progress.base} ${theme.progress[progress]}`}
                >
                  <span className="sr-only">
                    Scene {index + 1}
                    {progress === "done" ? ", done" : progress === "current" ? ", playing now" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <VoiceDemoControls
            snapshot={snapshot}
            live={live}
            completed={completed}
            start={start}
            stop={stop}
            download={download}
            startLabel="Play"
            restartLabel="Play again"
            showDownload={false}
            showStop={live}
            classNames={{ controls: styles.controls, startButton: styles.play, button: styles.stop }}
          />
        </div>
      </section>
      <audio ref={audio} />
      {debug && (
        <aside aria-label="Developer diagnostics" className={`space-y-6 text-left ${styles.debug}`}>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded border px-4 py-2 disabled:opacity-40" disabled={!snapshot} onClick={download}>
              Export diagnostics
            </button>
            <span>
              {status ?? "Ready"}
              {snapshot?.awaitingSteering ? " · waiting for steering acknowledgment" : ""}
            </span>
          </div>
          {snapshot?.error && <p>{snapshot.error}</p>}
          <section className="space-y-2 rounded border p-4">
            <h2 className="font-semibold">Progression gate</h2>
            <p>
              Node: {state?.nodeId ?? lessonDefinition.initialNodeId} · Phase: {state?.phase ?? "not started"} · Visit:{" "}
              {state?.visitId ?? "—"} · Child turn: {state?.childTurnId ?? "—"} · Revision:{" "}
              {state?.transcriptRevision ?? 0} ({state?.transcriptSource ?? "unknown"})
            </p>
            <p>
              Child speaking: {String(state?.childSpeaking ?? false)} · Child transcript:{" "}
              {String(state?.hasChildTranscript ?? false)} · Correct accepted: {String(state?.answerAccepted ?? false)}{" "}
              · Acknowledgment: {String(state?.acknowledgmentObserved ?? false)}
            </p>
            <p>
              Output: {state?.outputActivity ?? "unavailable"} · Relevant tutor audio:{" "}
              {String(state?.tutorOutputObserved ?? false)} · Drained: {String(state?.tutorOutputDrained ?? false)} ·
              Quiet since: {state?.quietSinceMs?.toFixed(0) ?? "—"} ms
            </p>
            <p className="text-sm">
              Timing: child debounce {LESSON_TIMING.childSnapshotDebounceMs} ms after VAD ends · tutor transcript stable{" "}
              {LESSON_TIMING.tutorTranscriptStableMs} ms + classification quiet{" "}
              {LESSON_TIMING.tutorClassificationQuietMs} ms · VAD quiet {LESSON_TIMING.microphoneQuietMs} ms ·
              transition audio drain {LESSON_TIMING.quietDrainMs} ms · tick {LESSON_TIMING.clockTickMs} ms
            </p>
            <p className="text-sm">
              All gates must agree on the current revision. Abstention holds the scene. Renewed speech clears completion
              authority.
            </p>
          </section>
          <section className="rounded border p-4">
            <h2 className="font-semibold">Current visit transcript</h2>
            <pre className="mt-2 whitespace-pre-wrap">{snapshot?.transcript || "No transcript yet."}</pre>
          </section>
          <section className="rounded border p-4">
            <h2 className="font-semibold">Diagnostics (latest 100 events; export includes all)</h2>
            <p className="mt-2 text-sm">
              The export contains conversation text. It stays in this page until you download it; refreshing clears it.
            </p>
            <div className="mt-3 max-h-96 space-y-2 overflow-auto text-sm">
              {snapshot?.diagnostics.map((event, index) => (
                <details key={`${event.atMs}:${index}`}>
                  <summary className="cursor-pointer">
                    {event.atMs.toFixed(0)} ms · {event.type} · visit {event.visitId ?? "—"}, turn{" "}
                    {event.childTurnId ?? "—"}, rev {event.transcriptRevision}
                  </summary>
                  <pre className="overflow-auto whitespace-pre-wrap p-2">{JSON.stringify(event, null, 2)}</pre>
                </details>
              ))}
            </div>
          </section>
        </aside>
      )}
    </main>
  );
}
