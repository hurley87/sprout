"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTING_LESSON_GRAPH, INITIAL_COUNTING_NODE_ID, isCountingNodeId } from "@/lib/lesson-runtime/counting-lesson";
import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { LESSON_TIMING, LessonRuntime, type LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { attachLessonObservation, type LessonObservationWindow } from "@/lib/lesson-runtime/browser-observation";

export default function Lesson({ lessonDefinition }: { lessonDefinition: LessonDefinition }) {
  const audio = useRef<HTMLAudioElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const lesson = useRef<LessonRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<LessonSnapshot | null>(null);
  const display = snapshot?.display;
  const status = snapshot?.status;
  const nodeId = display ? display.nodeId : INITIAL_COUNTING_NODE_ID;
  const node = nodeId && isCountingNodeId(nodeId) ? COUNTING_LESSON_GRAPH[nodeId] : null;
  const state = snapshot?.runtime;
  const live = snapshot !== null && status !== "ended";

  useEffect(() => {
    if (!display || status === "ended") return;
    const current = lesson.current;
    let second = 0;
    // This effect runs after React commits. Two frames also allow the scene to paint.
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const element = scene.current;
        if (
          element?.dataset.renderToken === display.token &&
          element.dataset.nodeId === (display.nodeId ?? "complete") &&
          element.dataset.sceneId === (display.sceneId ?? "complete")
        )
          current?.confirmRendered(display);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [display, status]);

  useEffect(() => {
    const detachObservation = attachLessonObservation(window as LessonObservationWindow, () => lesson.current);
    const hidden = () => {
      if (document.hidden) lesson.current?.stop("page_hidden");
    };
    const leave = () => lesson.current?.stop("page_left");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      lesson.current?.stop("unmounted");
      detachObservation();
    };
  }, []);

  function start() {
    if (!audio.current || live) return;
    lesson.current?.stop("restarted");
    const current = new LessonRuntime(audio.current, value => {
      if (lesson.current === current) setSnapshot(value);
    }, lessonDefinition);
    lesson.current = current;
    setSnapshot(current.snapshot());
  }

  function download() {
    const report = lesson.current?.report();
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sprout-lesson-${report.runtimeId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sprout</h1>
        <p className="mt-2">
          Use your microphone to count the displayed group. Stop and export each attempt before restarting.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-40"
          disabled={live}
          onClick={start}
        >
          Start lesson
        </button>
        <button
          className="rounded border px-4 py-2 disabled:opacity-40"
          disabled={!live}
          onClick={() => lesson.current?.stop()}
        >
          Stop
        </button>
        <button className="rounded border px-4 py-2 disabled:opacity-40" disabled={!snapshot} onClick={download}>
          Export diagnostics
        </button>
        <span role="status">
          {status ?? "Ready"}
          {snapshot?.awaitingSteering ? " · waiting for steering acknowledgment" : ""}
        </span>
      </div>
      {snapshot?.error && (
        <p role="alert" className="rounded border border-red-400 p-3">
          {snapshot.error}
        </p>
      )}
      <div
        ref={scene}
        className="flex min-h-64 items-center justify-center gap-6 rounded-2xl bg-emerald-50 p-8 text-7xl"
        role="img"
        aria-label={
          node ? `${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count` : "Lesson complete"
        }
        data-render-token={display?.token}
        data-node-id={nodeId ?? "complete"}
        data-scene-id={node?.sceneId ?? "complete"}
      >
        {node ? (
          Array.from({ length: node.quantity }, (_, index) => (
            <span aria-hidden="true" key={`${node.id}:${index}`}>
              {node.object === "duck" ? "🦆" : "🦋"}
            </span>
          ))
        ) : (
          <span className="text-2xl">Counting complete</span>
        )}
      </div>
      <audio ref={audio} />
      <section className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">Progression gate</h2>
        <p>
          Node: {state?.nodeId ?? INITIAL_COUNTING_NODE_ID} · Phase: {state?.phase ?? "not started"} · Visit:{" "}
          {state?.visitId ?? "—"} · Child turn: {state?.childTurnId ?? "—"} · Revision: {state?.transcriptRevision ?? 0}{" "}
          ({state?.transcriptSource ?? "unknown"})
        </p>
        <p>
          Child speaking: {String(state?.childSpeaking ?? false)} · Child transcript:{" "}
          {String(state?.hasChildTranscript ?? false)} · Correct accepted: {String(state?.answerAccepted ?? false)} ·
          Acknowledgment: {String(state?.acknowledgmentObserved ?? false)}
        </p>
        <p>
          Output: {state?.outputActivity ?? "unavailable"} · Relevant tutor audio:{" "}
          {String(state?.tutorOutputObserved ?? false)} · Drained: {String(state?.tutorOutputDrained ?? false)} · Quiet
          since: {state?.quietSinceMs?.toFixed(0) ?? "—"} ms
        </p>
        <p className="text-sm">
          Timing: child debounce {LESSON_TIMING.childSnapshotDebounceMs} ms after VAD ends · tutor transcript stable{" "}
          {LESSON_TIMING.tutorTranscriptStableMs} ms + classification quiet {LESSON_TIMING.tutorClassificationQuietMs}{" "}
          ms · VAD quiet {LESSON_TIMING.microphoneQuietMs} ms · transition audio drain {LESSON_TIMING.quietDrainMs} ms ·
          tick {LESSON_TIMING.clockTickMs} ms
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
    </main>
  );
}
