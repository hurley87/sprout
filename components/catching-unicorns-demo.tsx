"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./catching-unicorns-demo.module.css";
import { attachLessonObservation, type LessonObservationWindow } from "@/lib/lesson-runtime/browser-observation";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { LESSON_TIMING, LessonRuntime, type LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import type { RenderIdentity } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import { evidenceFor, EvidenceState, keyFor, revealText, sceneIds } from "./catching-unicorns/presentation-helpers";
import { ScenePresentation } from "./catching-unicorns/scene-presentation";

export { ScenePresentation } from "./catching-unicorns/scene-presentation";

function ScrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ScrubSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:secret|credential|authorization|api.?key|sdp|raw.?body|provider.?body|access.?token)/iu.test(key),
      )
      .map(([key, nested]) => [key, ScrubSecrets(nested)]),
  );
}

function safeExport(runtime: LessonRuntime) {
  const report = runtime.report();
  const current = runtime.snapshot();
  return ScrubSecrets({
    ...report,
    lesson: {
      id: CATCHING_UNICORNS_LESSON.id,
      sceneId: current.runtime?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId,
    },
    acceptedEvidence: current.runtime?.conceptEvidence ?? {},
    revealContext: Object.fromEntries(
      sceneIds.map(nodeId => [
        nodeId,
        (CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? [])
          .filter(concept => current.runtime?.conceptEvidence[keyFor(nodeId, concept.id)]?.status === "demonstrated")
          .map(concept => concept.id),
      ]),
    ),
    transcript: current.transcript,
  });
}

export default function CatchingUnicornsDemo() {
  const audio = useRef<HTMLAudioElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<LessonRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<LessonSnapshot | null>(null);
  const display = snapshot?.display;
  const live = snapshot !== null && snapshot.status !== "ended";

  useEffect(() => {
    if (!display || snapshot?.status === "ended") return;
    const current = runtime.current;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const element = sceneRef.current;
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
  }, [display, snapshot?.status]);

  useEffect(() => {
    const detach = attachLessonObservation(window as LessonObservationWindow, () => runtime.current);
    const hidden = () => {
      if (document.hidden) runtime.current?.stop("page_hidden");
    };
    const leave = () => runtime.current?.stop("page_left");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      runtime.current?.stop("unmounted");
      detach();
    };
  }, []);

  function start() {
    if (!audio.current || live) return;
    runtime.current?.stop("restarted");
    const current = new LessonRuntime(
      audio.current,
      value => {
        if (runtime.current === current) setSnapshot(value);
      },
      CATCHING_UNICORNS_LESSON,
    );
    runtime.current = current;
    setSnapshot(current.snapshot());
  }

  function download() {
    if (!runtime.current) return;
    const report = safeExport(runtime.current);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sprout-catching-unicorns-${runtime.current.snapshot().runtime?.runtimeId ?? "session"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const state = snapshot?.runtime;
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const sceneId = String(CATCHING_UNICORNS_LESSON.nodes[nodeId]?.presentation.sceneId ?? nodeId);
  const identity: RenderIdentity | undefined = display ?? { token: "initial", nodeId, sceneId };

  return (
    <main className={styles.lesson}>
      <div className={styles.stage}>
        <h1 className="sr-only">Catching Unicorns</h1>
        <div className={styles.progress}>
          <nav aria-label="Lesson scenes" className={styles.segments}>
            {sceneIds.map((id, index) => (
              <div
                aria-current={id === nodeId ? "step" : undefined}
                className={`${styles.segment} ${index <= sceneIds.indexOf(nodeId) ? styles.activeSegment : ""}`}
                key={id}
              />
            ))}
          </nav>
          <span className={styles.counter} aria-label={`Scene ${sceneIds.indexOf(nodeId) + 1} of ${sceneIds.length}`}>
            {sceneIds.indexOf(nodeId) + 1} / {sceneIds.length}
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
            <ScenePresentation state={state} />
          </div>
        </section>
        <footer className={styles.footer}>
          <div className={styles.sessionStatus}>
            <span role="status" className={live && !snapshot?.error ? "sr-only" : undefined}>
              {snapshot?.status ?? "Ready"}
              {snapshot?.awaitingSteering ? " · applying the next scene" : ""}
            </span>
            {snapshot?.error && <span role="alert">{snapshot.error}</span>}
          </div>
          <div className={styles.controls}>
            {!live && (
              <button className={styles.startButton} onClick={start}>
                Start discussion
              </button>
            )}
            {snapshot?.status === "ended" ? (
              <button className={styles.button} onClick={download}>
                Download diagnostics
              </button>
            ) : (
              <button className={styles.button} disabled={!live} onClick={() => runtime.current?.stop()}>
                Stop
              </button>
            )}
          </div>
        </footer>
      </div>
      {(nodeId === "recap" || snapshot?.status === "ended") && snapshot?.assessment && snapshot.assessment.status !== "idle" && (
        <section className="rounded border p-4" aria-label="Conversation assessment">
          <h2 className="font-semibold">Conversation assessment</h2>
          <p aria-live="polite">{snapshot.assessment.status === "pending" ? "Reviewing your full conversation…" : snapshot.assessment.status === "unavailable" ? "Assessment unavailable. Your conversation is saved in the export." : "Evidence across your answers; uncertain results remain open."}</p>
          {snapshot.assessment.status === "complete" && (
            <ul className="mt-3 space-y-1">
              {Object.entries(snapshot.assessment.results).map(([key, result]) => (
                <li key={key}>{String(CATCHING_UNICORNS_LESSON.nodes[result.nodeId].presentation.title)} · item {(CATCHING_UNICORNS_LESSON.nodes[result.nodeId].concepts ?? []).findIndex(concept => concept.id === result.criterionId) + 1}: {{ uncertain: "Uncertain", not_yet: "Not yet demonstrated", partial: "Partly explained", demonstrated_independent: "Explained independently", demonstrated_prompted: "Explained after a prompt" }[result.outcome]}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <audio ref={audio} />
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
              {(CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? []).map(concept => (
                <div className="flex justify-between gap-3" key={concept.id}>
                  <span>
                    {evidenceFor(state, nodeId, concept.id)?.status === "demonstrated"
                      ? (revealText(nodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION, concept.id)?.title ??
                        "Concept")
                      : "Unresolved concept"}
                  </span>
                  <EvidenceState evidence={evidenceFor(state, nodeId, concept.id)} />
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
                  {JSON.stringify(ScrubSecrets(event), null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </details>
        <p className="text-xs text-slate-500">
          The app advances after conversational closure or a request to move on, with quiet audio and confirmed screens. Assessment follows the conversation.
          Timing thresholds are shared runtime safeguards, not mastery timers ({LESSON_TIMING.quietDrainMs} ms audio
          drain).
        </p>
      </details>
    </main>
  );
}
