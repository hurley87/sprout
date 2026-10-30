"use client";

import {
  COUNTING_LESSON_GRAPH,
  COUNTING_NODE_IDS,
  INITIAL_COUNTING_NODE_ID,
  isCountingNodeId,
} from "@/lib/lesson-runtime/counting-lesson";
import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { LESSON_TIMING } from "@/lib/lesson-runtime/lesson-runtime";
import { useVoiceDemo } from "@/components/voice-demo/use-voice-demo";
import { VoiceDemoControls } from "@/components/voice-demo/controls";
import { lessonPresentation, stageMotion, voiceActivity } from "./lesson-presentation";
import { CountingStage } from "./counting-stage";
import { VoiceCue } from "./voice-cue";

// Shape and size, not only colour, distinguish finished, current and upcoming scenes.
const PROGRESS_LEAF = {
  done: "h-4 w-4 bg-emerald-600",
  current: "h-6 w-6 bg-emerald-300 ring-2 ring-emerald-800 ring-offset-2",
  upcoming: "h-4 w-4",
} as const;

export default function Lesson({
  lessonDefinition,
  debug = false,
}: {
  lessonDefinition: LessonDefinition;
  debug?: boolean;
}) {
  const { audio, sceneRef, snapshot, live, start, stop, download } = useVoiceDemo({
    lesson: lessonDefinition,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-lesson",
  });
  const display = snapshot?.display;
  const status = snapshot?.status;
  const nodeId = display ? display.nodeId : INITIAL_COUNTING_NODE_ID;
  const node = nodeId && isCountingNodeId(nodeId) ? COUNTING_LESSON_GRAPH[nodeId] : null;
  const state = snapshot?.runtime;
  const presentation = lessonPresentation(snapshot);
  const completed = presentation.kind === "complete";
  // Authored order of the rendered scene; the terminal render has no counting node.
  const step = node ? COUNTING_NODE_IDS.indexOf(node.id) : COUNTING_NODE_IDS.length;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-3 py-6 text-center sm:p-6">
      <h1>Sprout</h1>
      <div className="flex items-center justify-center gap-3">
        <VoiceCue activity={voiceActivity(presentation)} />
        <p role={presentation.kind === "error" ? "alert" : "status"} className="text-xl">
          {presentation.message}
        </p>
      </div>
      <CountingStage
        node={node}
        renderToken={display?.token}
        sceneRef={sceneRef}
        motion={stageMotion(snapshot, lessonDefinition)}
      />
      <ol aria-label="Adventure progress" className="flex items-center justify-center gap-3">
        {COUNTING_NODE_IDS.map((id, index) => {
          const progress = index < step ? "done" : index === step ? "current" : "upcoming";
          return (
            <li
              key={id}
              data-progress={progress}
              aria-current={progress === "current" ? "step" : undefined}
              className={`rounded-[0_80%] border-2 border-emerald-700 ${PROGRESS_LEAF[progress]}`}
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
        classNames={{
          controls: "flex justify-center",
          startButton: "min-h-20 min-w-48 rounded-full bg-emerald-800 px-12 py-5 text-3xl font-semibold text-white",
          button: "min-h-11 rounded-full border px-6 py-2 text-sm",
        }}
      />
      <audio ref={audio} />
      {debug && (
        <aside aria-label="Developer diagnostics" className="space-y-6 text-left">
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
              Node: {state?.nodeId ?? INITIAL_COUNTING_NODE_ID} · Phase: {state?.phase ?? "not started"} · Visit:{" "}
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
