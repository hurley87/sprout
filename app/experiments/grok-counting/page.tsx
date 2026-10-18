"use client";

import { useEffect, useRef, useState } from "react";
import { GrokVoice, GROK_MODEL, type VoiceSnapshot } from "@/lib/experiments/grok-counting/transport";
import { COUNTING_LESSON_GRAPH, INITIAL_COUNTING_NODE_ID } from "@/lib/lesson-runtime/counting-lesson";

export default function GrokCounting() {
  const voice = useRef<GrokVoice | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const node = COUNTING_LESSON_GRAPH[INITIAL_COUNTING_NODE_ID];
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
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Grok counting experiment</h1>
      <p>Adult or synthetic voice testing only. This session stays on the first scene. Use headphones to avoid echo.</p>
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
        <span role="status">
          {snapshot?.status ?? "Ready"} · Audio: {snapshot?.output ?? "idle"}
        </span>
      </div>
      {snapshot?.error && <p role="alert">{snapshot.error}</p>}
      <div
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
      <p className="text-sm">
        Requested model: {GROK_MODEL} · Server-echoed model:{" "}
        {snapshot?.echoedModel ?? "unavailable (serving identity unverified)"}
      </p>
      <p aria-label="Tool proposal">
        {snapshot?.proposal ?? "No proposal"} · Learner answer recorded:{" "}
        {snapshot?.learnerAnswerAccepted ? "yes" : "no"} · Revision-bound answer:{" "}
        {snapshot?.answerAccepted ? "yes" : "no"}
      </p>
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
