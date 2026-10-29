"use client";

import Link from "next/link";
import { Figtree } from "next/font/google";
import { CALCULUS_LESSON } from "@/lib/lesson-runtime/calculus-lesson";
import { CALCULUS_PROBLEM_IDS } from "@/lib/calculus/problems";
import { useVoiceDemo } from "./voice-demo/use-voice-demo";
import { VoiceDemoControls } from "./voice-demo/controls";
import { scrubSecrets } from "./voice-demo/diagnostics";
import { WorkChecklist } from "./calculus/work-checklist";
import styles from "./calculus-demo.module.css";
import theme from "./calculus/calculus-theme.module.css";

const figtree = Figtree({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-figtree",
});

export default function CalculusDemo({ debug = false }: { debug?: boolean }) {
  const { audio, sceneRef, snapshot, live, start, stop, download, support, skip, supportReady } = useVoiceDemo({
    lesson: CALCULUS_LESSON,
    exportReport: runtime => runtime.report(),
    exportPrefix: "sprout-calculus",
  });
  const state = snapshot?.runtime;
  const nodeId = state?.nodeId ?? CALCULUS_LESSON.initialNodeId;
  const identity = snapshot?.display ?? { token: "initial", nodeId, sceneId: nodeId };
  const completed = state?.phase === "complete";
  const number = CALCULUS_PROBLEM_IDS.findIndex(id => id === nodeId) + 1;
  return (
    <main className={`${styles.page} ${theme.theme} ${figtree.variable}`}>
      <header>
        <p>Spoken practice · Three problems</p>
        <h1>Calculus practice</h1>
        <p>Talk through your working out loud. Each step is checked as you go.</p>
      </header>
      <div className={styles.layout}>
        <section
          aria-label="Current problem"
          className={styles.prompt}
          ref={sceneRef}
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          <p>{number ? `Problem ${number} of 3` : "Practice recap"}</p>
          <h2>{CALCULUS_LESSON.nodes[nodeId]?.presentation.prompt ?? "Practice finished"}</h2>
          <p>Show each step as well as your final answer. Ask for help at any point.</p>
        </section>
        <div className={styles.work}>
          {snapshot?.math ? (
            <WorkChecklist math={snapshot.math} />
          ) : (
            <section aria-label="Your work">
              <h2>Your work</h2>
              <p>Start practice, then talk through your steps.</p>
            </section>
          )}
        </div>
      </div>
      <footer>
        <p aria-live="polite">
          {completed
            ? "Practice finished."
            : snapshot?.status === "ended"
              ? "Session stopped. Your work so far is shown above."
              : state?.childSpeaking
                ? "Listening…"
                : live
                  ? "Connected. Talk through your next step when ready."
                  : "Ready to begin."}
        </p>
        {snapshot?.error ? <p role="alert">{snapshot.error}</p> : null}
        {nodeId !== "recap" ? (
          <div className={styles.controls}>
            <button disabled={!supportReady} onClick={() => support("help")}>
              Help
            </button>
            <button disabled={!supportReady} onClick={() => support("repeat")}>
              Repeat problem
            </button>
            <button disabled={!supportReady} onClick={() => skip("question")}>
              Skip problem
            </button>
          </div>
        ) : null}
        <VoiceDemoControls
          snapshot={snapshot}
          showDownload={debug}
          live={live}
          completed={completed}
          start={start}
          stop={stop}
          download={download}
          startLabel="Start practice"
          restartLabel="Restart practice"
          classNames={{ controls: styles.controls, startButton: styles.start, button: styles.button }}
        />
        <p>You can also say “help”, “repeat”, “next”, or “stop”.</p>
      </footer>
      <Link href="/">Back to home</Link>
      <audio ref={audio} />
      {debug ? (
        <details>
          <summary>Session details</summary>
          <p>
            Export includes the transcript, every step check with what was heard and how it was judged, tutor
            instructions and local timing.
          </p>
          <button disabled={!snapshot} onClick={download}>
            Export session
          </button>
          <pre>{JSON.stringify(scrubSecrets(snapshot), null, 2)}</pre>
        </details>
      ) : null}
    </main>
  );
}
