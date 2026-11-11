"use client";

import { useMemo, type ReactNode, type Ref } from "react";
import Image from "next/image";
import {
  isLessonNodeId,
  lessonNodeOrder,
  type LessonDefinition,
  type LessonNodeDefinition,
} from "@/lib/lesson-runtime/lesson-definition";
import type { PresentationCopy, StageMotion } from "./lesson-presentation";
import {
  LESSON_TIMING,
  transitionQuietMs,
  type LessonRuntime,
  type LessonSnapshot,
} from "@/lib/lesson-runtime/lesson-runtime";
import { useVoiceDemo } from "@/components/voice-demo/use-voice-demo";
import { VoiceDemoControls } from "@/components/voice-demo/controls";
import { lessonPresentation, showsSuccessFeedback, stageMotion, voiceActivity } from "./lesson-presentation";
import { VoiceCue } from "./voice-cue";
import { GlowCue, useHeldVoiceActivity } from "./glow-cue";
import styles from "./lesson.module.css";

export type LessonScreenTheme = {
  readonly lesson: LessonDefinition;
  readonly copy: PresentationCopy;
  readonly statusCue?: "glow";
  /** "night": dark controls for a night-time scene. "pastel": light plum controls for a pastel stage. */
  readonly palette?: "night" | "pastel";
  readonly progressIcons?: Readonly<Record<string, string>>;
  readonly progress: {
    readonly base: string;
    readonly done: string;
    readonly current: string;
    readonly upcoming: string;
  };
  readonly successLabel?: (node: LessonNodeDefinition) => string;
};

export type LessonStageProps = {
  snapshot: LessonSnapshot | null;
  node: LessonNodeDefinition | null;
  renderToken?: string;
  sceneRef: Ref<HTMLDivElement>;
  motion: StageMotion;
};

export function LessonScreen({
  theme,
  debug = false,
  renderStage,
  renderDebug,
  progressOutcome,
  presentationCopy,
  exportReport = runtime => runtime.report(),
  exportPrefix = "sprout-lesson",
  startButtonClassName,
}: {
  theme: LessonScreenTheme;
  debug?: boolean;
  renderStage: (props: LessonStageProps) => ReactNode;
  renderDebug?: (snapshot: LessonSnapshot | null) => ReactNode;
  presentationCopy?: (snapshot: LessonSnapshot | null) => PresentationCopy;
  progressOutcome?: (snapshot: LessonSnapshot | null, id: string) => "succeeded" | "released" | undefined;
  /** Builds the diagnostics download; runs only when the export is requested. */
  exportReport?: (runtime: LessonRuntime) => unknown;
  exportPrefix?: string;
  startButtonClassName?: string;
}) {
  const lessonDefinition = theme.lesson;
  const { audio, sceneRef, snapshot, live, start, stop, download } = useVoiceDemo({
    lesson: lessonDefinition,
    exportReport,
    exportPrefix,
  });
  const display = snapshot?.display;
  const status = snapshot?.status;
  const nodeIds = useMemo(() => lessonNodeOrder(lessonDefinition), [lessonDefinition]);
  const nodeId = display ? display.nodeId : lessonDefinition.initialNodeId;
  const presented = nodeId && isLessonNodeId(lessonDefinition, nodeId) ? lessonDefinition.nodes[nodeId] : null;
  const node = presented;
  const state = snapshot?.runtime;
  const presentation = lessonPresentation(
    snapshot,
    showsSuccessFeedback(snapshot, lessonDefinition) && node
      ? theme.successLabel
        ? { label: theme.successLabel(node) }
        : { quantity: Number(node.presentation.quantity), object: String(node.presentation.object) }
      : null,
    presentationCopy?.(snapshot) ?? theme.copy,
  );
  const completed = presentation.kind === "complete";
  const glow = theme.statusCue === "glow";
  // Hold "speaking" through the same quiet gaps the runtime waits out before changing scenes.
  const activity = useHeldVoiceActivity(voiceActivity(presentation), glow ? transitionQuietMs(lessonDefinition) : 0);
  const shown =
    activity === "speaking" && presentation.kind !== "speaking"
      ? { kind: "speaking", message: "Sprout is talking…" }
      : presentation;
  // The glow replaces the pill only while the conversation is live; other states keep their words.
  const glowing = glow && activity !== "off";
  // Authored order of the rendered scene; the terminal render has no counting node.
  const step = node ? nodeIds.indexOf(node.id) : nodeIds.length;

  return (
    <main className="w-full">
      <section className={styles.screen} data-palette={theme.palette}>
        <div className={styles.scene}>
          {renderStage({
            snapshot,
            node,
            renderToken: display?.token,
            sceneRef,
            motion: stageMotion(snapshot, lessonDefinition),
          })}
        </div>
        <div className={styles.top}>
          <h1 className={styles.title}>Sprout</h1>
          <div className={styles.status} data-status-cue={glowing ? "glow" : undefined}>
            {glow ? <GlowCue activity={activity} palette={theme.palette} /> : <VoiceCue activity={activity} />}
            <p role={shown.kind === "error" ? "alert" : "status"} className={glowing ? "sr-only" : undefined}>
              {shown.message}
            </p>
          </div>
        </div>
        <div className={styles.bottom}>
          <ol aria-label="Adventure progress" className={`flex items-center gap-3 ${styles.progress}`}>
            {nodeIds.map((id, index) => {
              const outcome = progressOutcome?.(snapshot, id);
              const progress =
                outcome === "succeeded"
                  ? "done"
                  : outcome === "released"
                    ? "upcoming"
                    : index < step && !progressOutcome
                      ? "done"
                      : index === step
                        ? "current"
                        : "upcoming";
              const icon = progress === "done" ? theme.progressIcons?.[id] : undefined;
              return (
                <li
                  key={id}
                  data-progress={progress}
                  aria-current={progress === "current" ? "step" : undefined}
                  className={`${theme.progress.base} ${theme.progress[progress]}${icon ? " flex items-center justify-center" : ""}`}
                  style={icon ? { width: 20, height: 20, backgroundColor: "#fffdf6" } : undefined}
                >
                  {icon && <Image src={icon} alt="" aria-hidden="true" width={16} height={16} />}
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
              controls: styles.controls,
              startButton: `${styles.play} ${startButtonClassName ?? ""}`,
              button: styles.stop,
            }}
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
              transition audio drain {transitionQuietMs(lessonDefinition)} ms · tick {LESSON_TIMING.clockTickMs} ms
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
          {renderDebug?.(snapshot)}
        </aside>
      )}
    </main>
  );
}
