"use client";

import { useEffect, useRef, useState } from "react";
import { fetchEvaluateAnswer } from "@/lib/answer";
import { ConvexSessionRecorder } from "@/lib/convex-session-recorder";
import { BrowserTransport, type VoiceActivity } from "@/lib/browser-transport";
import { OBJECTS, objectName, sceneAt } from "@/lib/lesson";
import { LessonSession, type Diagnostic, type Snapshot } from "@/lib/session";
import { SessionInspector } from "./session-inspector";
import type { DurableSessionRef, SessionRecordReader } from "@/lib/session-recorder";
import { JevDiagnostics } from "./jev-diagnostics";
import { readBrowserSessionReference, saveBrowserSessionReference } from "@/lib/durable-session-reference";

function Scene({ index }: { index: number }) {
  const scene = sceneAt(index);
  return (
    <div className="scene" data-scene={scene.id} role="img" aria-label={`A group of ${objectName(scene)} to count`}>
      {Array.from({ length: scene.quantity }, (_, position) => (
        <span aria-hidden="true" key={`${scene.id}-${position}`}>
          {OBJECTS[scene.object].emoji}
        </span>
      ))}
    </div>
  );
}

export default function Lesson({ debug }: { debug: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [diagnosticEvents, setDiagnosticEvents] = useState<readonly Diagnostic[]>([]);
  const [microphoneDiagnostics, setMicrophoneDiagnostics] = useState(false);
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity>("unavailable");
  const [endedAttempt, setEndedAttempt] = useState<{ ref?: DurableSessionRef; reader: SessionRecordReader } | null>(
    null,
  );
  const [savedReferenceIssue, setSavedReferenceIssue] = useState<"missing" | "invalid" | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<LessonSession | null>(null);
  const live = snapshot !== null && snapshot.status !== "ended";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readBrowserSessionReference();
      if (saved.status === "available") {
        setEndedAttempt({ ref: saved.ref, reader: new ConvexSessionRecorder() });
        return;
      }
      setSavedReferenceIssue(saved.status);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) session.current?.dispose();
    };
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
    if (!snapshot || snapshot.status === "ended") return;
    const current = session.current;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => current?.displayed(snapshot.sceneIndex, snapshot.displayToken));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [snapshot]);

  function start(retryOf?: DurableSessionRef) {
    if (!audio.current || (session.current && session.current.snapshot.status !== "ended")) return;
    session.current?.dispose();
    setEndedAttempt(null);
    setVoiceActivity("unavailable");
    const recorder = new ConvexSessionRecorder(ref => {
      if (session.current !== current) return;
      const stored = saveBrowserSessionReference(ref);
      setSavedReferenceIssue(stored ? null : "invalid");
      if (session.current?.snapshot.status === "ended")
        setEndedAttempt(attempt => (attempt ? { ...attempt, ref } : attempt));
    });
    const current = new LessonSession(
      new BrowserTransport(audio.current, microphoneDiagnostics, activity => {
        if (session.current === current) setVoiceActivity(activity);
      }),
      fetchEvaluateAnswer,
      snapshot => {
        if (session.current === current) {
          setSnapshot(snapshot);
          if (snapshot.status === "ended") setEndedAttempt({ ref: snapshot.durableSessionRef, reader: recorder });
        }
      },
      () => {
        if (session.current === current) setDiagnosticEvents([...current.events]);
      },
      recorder,
      retryOf,
    );
    session.current = current;
    setDiagnosticEvents([]);
    void current.start();
  }
  function download() {
    if (!session.current) return;
    const report = session.current.report(navigator.userAgent);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sprout-attempt-${session.current.createdAt}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className={live ? "sprout live" : "sprout"}>
      <audio ref={audio} aria-hidden="true" />
      {snapshot?.recordingError && (
        <p role="alert" className="error">
          {snapshot.recordingError}
        </p>
      )}
      {live ? (
        <>
          <button className="end-button" onClick={() => session.current?.end("parent_stop")}>
            End lesson
          </button>
          <section className="play-space" aria-label="Counting lesson">
            <div className="tutor">
              <div className="character" role="img" aria-label="Sprout">
                <span className="leaf">🌱</span>
                <span className="face">◡</span>
              </div>
              <p
                className="voice-status"
                data-activity={snapshot.status === "starting" ? "unavailable" : voiceActivity}
              >
                <span className="voice-dot" aria-hidden="true" />
                <span>
                  {snapshot.status === "starting"
                    ? "Connecting…"
                    : voiceActivity === "speaking"
                      ? "Speaking"
                      : voiceActivity === "listening"
                        ? "Listening"
                        : "Connected"}
                </span>
              </p>
            </div>
            <Scene index={snapshot.sceneIndex} />
          </section>
        </>
      ) : (
        <section className="welcome">
          <div className="character" role="img" aria-label="Sprout">
            <span className="leaf">🌱</span>
            <span className="face">◡</span>
          </div>
          <h1>{snapshot ? "Bye for now." : "Let’s count together."}</h1>
          {snapshot?.error ? (
            <p className="error" role="alert">
              {snapshot.error}
            </p>
          ) : (
            <p className="intro">
              {snapshot
                ? "The microphone and voice playback are off."
                : "Count ducks, butterflies, and strawberries. Say your answers out loud."}
            </p>
          )}
          {snapshot?.reason === "page_hidden" && (
            <p className="parent-note">
              The lesson ended because the page was hidden. Keep this tab visible during the lesson.
            </p>
          )}
          <button className="start-button" onClick={() => start()}>
            {snapshot ? "Start a new lesson" : "Start counting together"}
            <span aria-hidden="true">↗</span>
          </button>
          <label className="parent-note">
            <input
              type="checkbox"
              checked={microphoneDiagnostics}
              onChange={event => setMicrophoneDiagnostics(event.target.checked)}
            />{" "}
            Include microphone timing in the diagnostic download
          </label>
          <div className="parent-note">
            <p>For a parent and child · About 5 minutes · Count from 1 to 5</p>
            <p>
              Stay with your child, allow microphone access, and keep this tab visible. The tutor uses an AI voice.
              Audio is sent to OpenAI during the lesson and saved in a private session record for review. You can end
              the lesson at any time.
            </p>
          </div>
          {endedAttempt && (
            <SessionInspector
              key={endedAttempt.ref ?? "unavailable"}
              sessionRef={endedAttempt.ref}
              reader={endedAttempt.reader}
              onRetry={ref => start(ref)}
            />
          )}
          {!endedAttempt && savedReferenceIssue === "missing" && (
            <p className="parent-note">No saved session reference is available on this browser.</p>
          )}
          {!endedAttempt && savedReferenceIssue === "invalid" && (
            <p className="parent-note" role="status">
              The saved session reference is invalid or unavailable on this browser.
            </p>
          )}
          {snapshot && (
            <details className="diagnostics">
              <summary>Parent testing notes · Prototype diagnostics</summary>
              <p>
                Ended: {snapshot.reason?.replaceAll("_", " ")}. Download approximate transcripts, displayed scenes,
                timing, and connection events before starting again. These stay in this tab and are lost on reload. The
                private durable session record includes full-session audio when recording succeeds. No learning
                assessment is saved.
              </p>
              <button className="download-button" onClick={download}>
                Download attempt diagnostics
              </button>
            </details>
          )}
        </section>
      )}
      {debug && <JevDiagnostics events={diagnosticEvents} />}
    </main>
  );
}
