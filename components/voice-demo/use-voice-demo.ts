"use client";

import { useEffect, useRef, useState } from "react";
import { attachLessonObservation, type LessonObservationWindow } from "@/lib/lesson-runtime/browser-observation";
import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { LessonRuntime, type LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { scrubSecrets } from "./diagnostics";

/** Shared browser lifecycle; callers own presentation, progress and diagnostic payloads. */
export function useVoiceDemo({
  lesson,
  exportReport,
  exportPrefix,
}: {
  lesson: LessonDefinition;
  exportReport: (runtime: LessonRuntime) => unknown;
  exportPrefix: string;
}) {
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
      lesson,
    );
    runtime.current = current;
    setSnapshot(current.snapshot());
  }

  function download() {
    if (!runtime.current) return;
    const report = scrubSecrets(exportReport(runtime.current));
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportPrefix}-${runtime.current.snapshot().runtime?.runtimeId ?? "session"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stop() {
    runtime.current?.stop();
  }

  return { audio, sceneRef, snapshot, live, start, stop, download };
}
