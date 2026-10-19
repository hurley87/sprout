"use client";

import { useEffect, useRef, useState } from "react";
import { GrokVoice, GROK_MODEL, type VoiceSnapshot } from "@/lib/experiments/grok-counting/transport";
import {
  COUNTING_LESSON_GRAPH,
  INITIAL_COUNTING_NODE_ID,
  type CountingNodeId,
} from "@/lib/lesson-runtime/counting-lesson";

export default function GrokCounting() {
  const scene = useRef<HTMLDivElement | null>(null);
  const voice = useRef<GrokVoice | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const node = COUNTING_LESSON_GRAPH[(snapshot?.nodeId ?? INITIAL_COUNTING_NODE_ID) as CountingNodeId];
  const render = snapshot?.render;
  useEffect(() => {
    const element = scene.current;
    if (
      render &&
      element?.dataset.renderToken === render.token &&
      element.dataset.nodeId === (render.nodeId ?? "complete") &&
      element.dataset.sceneId === (render.sceneId ?? "complete")
    )
      voice.current?.confirmRender(render);
  }, [render]);
  const live = snapshot?.status === "connecting" || snapshot?.status === "listening";
  useEffect(() => {
    const stop = () => voice.current?.stop();
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
      const current = voice.current;
      voice.current = null;
      current?.stop();
    };
  }, []);
  function start() {
    if (live) return;
    voice.current?.stop();
    const current = new GrokVoice(value => {
      if (voice.current === current) setSnapshot(value);
    });
    voice.current = current;
    void current.start();
  }
  function downloadDiagnostics() {
    if (!snapshot) return;
    // Explicit export projection: never serialize the transport or opaque IDs.
    const report = {
      version: 1,
      experiment: "grok-counting",
      exportedAt: new Date().toISOString(),
      requestedModel: GROK_MODEL,
      echoedModel: snapshot.echoedModel ?? null,
      status: snapshot.status,
      error: snapshot.error ?? null,
      output: snapshot.output,
      nodeId: snapshot.nodeId ?? INITIAL_COUNTING_NODE_ID,
      complete: snapshot.complete ?? false,
      proposal: snapshot.proposal ?? "No proposal",
      learnerAnswerAccepted: snapshot.learnerAnswerAccepted ?? false,
      answerAccepted: snapshot.answerAccepted ?? false,
      pendingRender: snapshot.render ? { nodeId: snapshot.render.nodeId, sceneId: snapshot.render.sceneId } : null,
      transcripts: snapshot.transcripts.map(({ speaker, text, final }) => ({ speaker, text, final })),
      diagnostics: snapshot.diagnostics ?? [],
      decisionTimeline: snapshot.decisionTimeline ?? [],
      decisionTimelineDropped: Math.max(0, (snapshot.decisionTimeline?.[0]?.sequence ?? 1) - 1),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sprout-grok-counting-${report.exportedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Let the browser begin the download before releasing its object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Grok counting experiment</h1>
      <p>
        Adult or synthetic voice testing only. Count one duck, two ducks, then three butterflies. “Move on” ends this
        small experiment without answer credit. Use headphones to avoid echo.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-40"
          disabled={live}
          onClick={start}
        >
          Start
        </button>
        <button
          className="rounded border px-4 py-2 disabled:opacity-40"
          disabled={!live}
          onClick={() => voice.current?.stop()}
        >
          Stop
        </button>
        <button
          className="rounded border px-4 py-2 disabled:opacity-40"
          disabled={!snapshot}
          onClick={downloadDiagnostics}
        >
          Download diagnostics
        </button>
        <span role="status">
          {snapshot?.status ?? "Ready"} · Audio: {snapshot?.output ?? "idle"}
        </span>
      </div>
      <p className="text-sm">
        Diagnostics downloads include captions, the latest 64 correlation events, and up to 256 lesson decision events,
        without audio.
      </p>
      {snapshot?.error && <p role="alert">{snapshot.error}</p>}
      {snapshot?.complete ? (
        <div
          ref={scene}
          data-complete="true"
          data-node-id="complete"
          data-scene-id="complete"
          data-render-token={render?.token}
        >
          Lesson complete. Thanks for counting!
        </div>
      ) : (
        <div
          ref={scene}
          data-render-token={render?.token}
          className="flex min-h-64 items-center justify-center gap-6 rounded-2xl bg-emerald-50 p-8 text-7xl"
          role="img"
          aria-label={`${node.quantity} ${node.object} to count`}
          data-node-id={node.id}
          data-scene-id={node.sceneId}
        >
          {Array.from({ length: node.quantity }, (_, index) => (
            <span aria-hidden="true" key={index}>
              {node.object === "duck" ? "🦆" : "🦋"}
            </span>
          ))}
        </div>
      )}
      <p className="text-sm">
        Requested model: {GROK_MODEL} · Server-echoed model:{" "}
        {snapshot?.echoedModel ?? "unavailable (serving identity unverified)"}
      </p>
      <p aria-label="Tool proposal">
        {snapshot?.proposal ?? "No proposal"} · Learner answer recorded:{" "}
        {snapshot?.learnerAnswerAccepted ? "yes" : "no"} · Revision-bound answer:{" "}
        {snapshot?.answerAccepted ? "yes" : "no"}
      </p>
      <details>
        <summary>Correlation diagnostics</summary>
        <ol aria-label="Correlation diagnostics">
          {snapshot?.diagnostics?.map(entry => (
            <li key={entry.sequence}>
              {entry.sequence}: {entry.stage} → {entry.code} · visit {entry.visit}, turn {entry.turn}, revision{" "}
              {entry.revision}
            </li>
          ))}
        </ol>
      </details>
      <section className="space-y-2 rounded border p-4" aria-label="Conversation transcript">
        <h2 className="font-semibold">Transcript</h2>
        <p className="text-sm">
          Generated captions may change and may include tutor speech interrupted before playback.
        </p>
        {snapshot?.transcripts.map(turn => (
          <p key={turn.id}>
            <strong>{turn.speaker}:</strong> {turn.text}
            {turn.final ? "" : " …"}
          </p>
        ))}
      </section>
    </main>
  );
}
