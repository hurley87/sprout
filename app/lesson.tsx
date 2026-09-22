"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserTransport } from "@/lib/browser-transport";
import { EMOJI } from "@/lib/lesson";
import { LessonSession, type Snapshot } from "@/lib/session";

export default function Lesson() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<LessonSession | null>(null);
  const live = snapshot !== null && snapshot.status !== "ended";

  useEffect(() => {
    const hide = () => { if (document.hidden) session.current?.dispose(); };
    const leave = () => session.current?.dispose();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      session.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!snapshot || !["active", "wrapping", "goodbye"].includes(snapshot.status)) return;
    const current = session.current;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => current?.displayed(snapshot.scene.id));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [snapshot]);

  function start() {
    if (!audio.current || (session.current && session.current.snapshot.status !== "ended")) return;
    session.current?.dispose();
    const current = new LessonSession(new BrowserTransport(audio.current), setSnapshot);
    session.current = current;
    void current.start();
  }
  function download() {
    if (!session.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(session.current.report(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sprout-attempt-${session.current.createdAt}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className={live ? "sprout live" : "sprout"}>
      <audio ref={audio} aria-hidden="true" />
      <header className="brand"><span aria-hidden="true">✳</span> sprout</header>
      {live ? (
        <>
          <button className="end-button" onClick={() => session.current?.end("parent_stop")}>End lesson</button>
          <section className="play-space" aria-label="Counting garden">
            <div className="character" role="img" aria-label="Sprout"><span className="leaf">🌱</span><span className="face">◡</span></div>
            {snapshot.status === "starting" ? <p className="connecting" role="status">Getting ready to play…</p> : (
              <div className="scene" data-scene={snapshot.scene.id} role="img" aria-label={`A group of ${snapshot.scene.object}s to count`}>
                {Array.from({ length: snapshot.scene.quantity }, (_, index) => <span aria-hidden="true" key={`${snapshot.scene.id}-${index}`}>{EMOJI[snapshot.scene.object]}</span>)}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="welcome">
          <div className="character" role="img" aria-label="Sprout"><span className="leaf">🌱</span><span className="face">◡</span></div>
          <p className="eyebrow">A LITTLE TIME TO WONDER</p>
          <h1>{snapshot ? "Bye for now." : "Small discoveries.\nTogether."}</h1>
          {snapshot?.error ? <p className="error" role="alert">{snapshot.error}</p> : (
            <p className="intro">{snapshot ? "The microphone and voice playback are off." : "A gentle counting adventure with Sprout. Just your voice, a few little friends, and room to think."}</p>
          )}
          {snapshot?.reason === "page_hidden" && <p className="parent-note">The lesson ended because the page was hidden. Keep this window open during play.</p>}
          <button className="start-button" onClick={start}>{snapshot ? "Start a new lesson" : "Start counting together"}<span aria-hidden="true">↗</span></button>
          <div className="parent-note">
            <p>For a parent and child · About 5 minutes · Quantities 1–5</p>
            <p>Stay together, allow the microphone, and keep this tab visible. Sprout is an AI voice; audio is sent to OpenAI during play. You can end at any time.</p>
          </div>
          {snapshot && <details className="diagnostics">
            <summary>Parent testing notes</summary>
            <p>Ended: {snapshot.reason?.replaceAll("_", " ")}. Download approximate transcripts, displayed scenes, timing, and connection events before starting again. These stay in this tab and are lost on reload. No audio recording or learning assessment is saved.</p>
            <button className="download-button" onClick={download}>Download attempt diagnostics</button>
          </details>}
        </section>
      )}
      {!live && <footer>One small adventure at a time.</footer>}
    </main>
  );
}
