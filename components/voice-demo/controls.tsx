import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";

/** The lesson supplies copy and styling while the session owns control availability. */
export function VoiceDemoControls({
  snapshot,
  live,
  completed,
  start,
  stop,
  download,
  startLabel,
  restartLabel,
  classNames,
  showDownload = true,
  showStop = true,
}: {
  showDownload?: boolean;
  showStop?: boolean;
  snapshot: LessonSnapshot | null;
  live: boolean;
  completed: boolean;
  start: () => void;
  stop: () => void;
  download: () => void;
  startLabel: string;
  restartLabel: string;
  classNames: { controls: string; startButton: string; button: string };
}) {
  return (
    <div className={classNames.controls}>
      {!live && (
        <button className={classNames.startButton} onClick={start}>
          {completed ? restartLabel : startLabel}
        </button>
      )}
      {snapshot?.status === "ended" ? (
        showDownload ? (
          <button className={classNames.button} onClick={download}>
            Download diagnostics
          </button>
        ) : null
      ) : (
        showStop &&
        !completed && (
          <button className={classNames.button} disabled={!live} onClick={stop}>
            Stop
          </button>
        )
      )}
    </div>
  );
}
