"use client";

import { useEffect, useRef, useState } from "react";
import { attachLessonObservation, type LessonObservationWindow } from "@/lib/lesson-runtime/browser-observation";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
} from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { LESSON_TIMING, LessonRuntime, type LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import type {
  ConceptEvidenceRecord,
  LessonRuntimeState,
  RenderIdentity,
} from "@/lib/lesson-runtime/lesson-runtime-reducer";

const sceneIds = Object.keys(CATCHING_UNICORNS_LESSON.nodes);
type RevealItem = { readonly title: string; readonly text: string; readonly source: string };
const recapSceneLabel = (id: string) =>
  ({
    engram: "Engram prompt",
    exogram: "Exogram prompt",
    compare: "Comparison scene",
    exographics: "Visual practice scene",
    "why-exographics": "Arithmetic example",
    "techno-literate-culture": "Culture framework",
    "caf-application": "Transfer scene",
    synthesis: "Connections scene",
    recap: "Recap",
  })[id] ?? "Lesson scene";
const keyFor = (nodeId: string, criterionId: string) => `${nodeId}:${criterionId}`;
const evidenceFor = (state: LessonRuntimeState | null | undefined, nodeId: string, criterionId: string) =>
  state?.conceptEvidence[keyFor(nodeId, criterionId)];

function revealText(nodeId: keyof typeof CATCHING_UNICORNS_PRESENTATION, criterionId: string): RevealItem | undefined {
  const item = CATCHING_UNICORNS_PRESENTATION[nodeId] as { readonly reveals?: Readonly<Record<string, RevealItem>> };
  return item.reveals?.[criterionId];
}

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

function Revealed({ item }: { item: RevealItem }) {
  return (
    <article className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-emerald-950">{item.title}</h3>
      <p className="mt-2 text-slate-700">{item.text}</p>
      <p className="mt-3 text-xs text-slate-500">Source: {item.source}</p>
    </article>
  );
}

function EvidenceState({ evidence }: { evidence?: ConceptEvidenceRecord }) {
  if (evidence?.status === "demonstrated")
    return (
      <span className="text-xs font-medium text-emerald-800">
        {evidence.understanding === "prompted" ? "After a prompt" : "Demonstrated"}
      </span>
    );
  return (
    <span className="text-xs text-slate-500">
      {evidence?.status === "partial" ? "Partly explained" : "Not yet demonstrated"}
    </span>
  );
}

export function ScenePresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  const nodeId = state?.nodeId ?? CATCHING_UNICORNS_LESSON.initialNodeId;
  const node = CATCHING_UNICORNS_LESSON.nodes[nodeId];
  const scene = CATCHING_UNICORNS_PRESENTATION[nodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION];
  const concepts = node.concepts ?? [];

  if (nodeId === "recap") {
    const evidenceGroups = [
      {
        id: "independent",
        title: "Demonstrated independently",
        filter: (item: ConceptEvidenceRecord) => item.status === "demonstrated" && item.understanding === "independent",
      },
      {
        id: "prompted",
        title: "Demonstrated after a prompt",
        filter: (item: ConceptEvidenceRecord) => item.status === "demonstrated" && item.understanding === "prompted",
      },
      { id: "partial", title: "Partly explained", filter: (item: ConceptEvidenceRecord) => item.status === "partial" },
    ];
    const all = sceneIds.flatMap(id =>
      (CATCHING_UNICORNS_LESSON.nodes[id].concepts ?? []).map(concept => ({
        nodeId: id,
        criterionId: concept.id,
        evidence: evidenceFor(state, id, concept.id),
        reveal: revealText(id as keyof typeof CATCHING_UNICORNS_PRESENTATION, concept.id),
      })),
    );
    const groups = evidenceGroups.map(group => ({
      ...group,
      entries: all.filter(item => item.evidence && group.filter(item.evidence)),
    }));
    const unresolved = all.filter(item => item.evidence?.status !== "demonstrated");
    return (
      <div className="space-y-5" data-scene="recap">
        <header>
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-800">Catching Unicorns · recap</p>
          <h2 className="mt-2 text-3xl font-semibold">What this conversation showed</h2>
          <p className="mt-3 max-w-3xl text-slate-600">
            A record of accepted evidence from this session. Transfer reasoning is kept separate from source-backed
            concepts.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(group => (
            <section className="rounded-2xl border bg-white p-4" key={group.id}>
              <h3 className="font-semibold">{group.title}</h3>
              {group.entries.length ? (
                <ul className="mt-3 space-y-3">
                  {group.entries.map(item => (
                    <li key={`${item.nodeId}:${item.criterionId}`}>
                      <p className="font-medium">
                        {item.evidence?.status === "demonstrated"
                          ? (item.reveal?.title ?? recapSceneLabel(item.nodeId))
                          : recapSceneLabel(item.nodeId)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {item.evidence?.source?.childTranscript
                          ? `“${item.evidence.source.childTranscript}”`
                          : "Accepted evidence recorded."}
                      </p>
                      {item.nodeId === "caf-application" && (
                        <p className="mt-1 text-xs font-medium text-indigo-800">Transfer/application reasoning</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Nothing recorded in this group.</p>
              )}
            </section>
          ))}
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 md:col-span-2">
            <h3 className="font-semibold text-amber-950">Still unresolved or skipped</h3>
            {unresolved.length ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {unresolved.map(item => (
                  <li className="rounded-xl bg-white/80 p-3 text-sm" key={`${item.nodeId}:${item.criterionId}`}>
                    <span className="font-medium">{recapSceneLabel(item.nodeId)}</span>
                    <span className="text-slate-600">
                      {" "}
                      · {item.evidence?.status === "partial" ? "partial evidence" : "one unresolved item"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm">Every authored criterion has accepted evidence.</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  const currentReveals = (scene as { readonly reveals?: Readonly<Record<string, RevealItem>> }).reveals ?? {};
  const revealCards = Object.entries(currentReveals).map(([criterionId, item]) => ({
    criterionId,
    item,
    evidence: evidenceFor(state, nodeId, criterionId),
  }));

  if (nodeId === "compare") {
    const definitions = [
      { from: "engram", id: "engram-biological" },
      { from: "exogram", id: "exogram-non-biological" },
    ];
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        <div className="grid gap-4 md:grid-cols-2">
          {definitions.map(({ from, id }) => {
            const prior = evidenceFor(state, nodeId, id);
            const original = revealText(from as keyof typeof CATCHING_UNICORNS_PRESENTATION, id);
            return prior?.status === "demonstrated" && original ? <Revealed key={id} item={original} /> : null;
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {concepts
            .filter(concept => concept.id.startsWith("exogram-") && concept.id !== "exogram-non-biological")
            .map((concept, index) => {
              const result = revealCards.find(item => item.criterionId === concept.id);
              return (
                <article className="rounded-xl border bg-white p-4" key={concept.id}>
                  {result?.evidence?.status === "demonstrated" && result.item ? (
                    <Revealed item={result.item} />
                  ) : (
                    <>
                      <h3 className="font-medium">Comparison {index + 1}</h3>
                      <p className="mt-2 text-sm text-slate-500">Awaiting evidence</p>
                      <EvidenceState evidence={result?.evidence} />
                    </>
                  )}
                </article>
              );
            })}
        </div>
      </div>
    );
  }

  if (nodeId === "exogram") {
    const carried = evidenceFor(state, nodeId, "engram-biological");
    const engramReveal = revealText("engram", "engram-biological");
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        {carried?.status === "demonstrated" && engramReveal && (
          <section aria-label="Previously demonstrated concept">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-800">
              Carried forward from your earlier explanation
            </p>
            <Revealed item={engramReveal} />
          </section>
        )}
        {revealCards.map(({ criterionId, item, evidence }) =>
          evidence?.status === "demonstrated" ? (
            <Revealed key={criterionId} item={item} />
          ) : (
            <article className="rounded-2xl border border-dashed bg-white p-5" key={criterionId}>
              <p className="font-medium">Exogram</p>
              <p className="mt-2 text-sm text-slate-500">Definition not yet revealed</p>
              <EvidenceState evidence={evidence} />
            </article>
          ),
        )}
      </div>
    );
  }

  if (nodeId === "exographics") {
    const examples = [
      { kind: "writing", symbol: "Aa", caption: "Writing" },
      { kind: "equation", symbol: "∑ x²", caption: "Equation" },
      { kind: "graph", symbol: "⌁", caption: "Graph" },
      { kind: "map", symbol: "◇ · · ◇", caption: "Map" },
    ];
    const beyond = evidenceFor(state, nodeId, "beyond-prose")?.status === "demonstrated";
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {examples.map(example => (
            <div
              aria-label={beyond ? example.caption : "Unrevealed visual example"}
              className="rounded-xl border bg-white p-4 text-center"
              key={example.kind}
            >
              <div className="text-3xl font-semibold text-emerald-800" aria-hidden="true">
                {beyond ? example.symbol : "◇"}
              </div>
              <p className="mt-2 font-medium">{beyond ? example.caption : "Visual form"}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {revealCards.map(({ criterionId, item, evidence }) =>
            evidence?.status === "demonstrated" ? (
              <Revealed key={criterionId} item={item} />
            ) : (
              <article className="rounded-xl border bg-white p-4" key={criterionId}>
                <h3 className="font-medium">Concept not yet revealed</h3>
                <EvidenceState evidence={evidence} />
              </article>
            ),
          )}
        </div>
      </div>
    );
  }

  if (nodeId === "techno-literate-culture") {
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        <div className="grid gap-3 md:grid-cols-2">
          {concepts.map((concept, index) => {
            const result = revealCards.find(item => item.criterionId === concept.id);
            return result?.evidence?.status === "demonstrated" && result.item ? (
              <Revealed key={concept.id} item={result.item} />
            ) : (
              <article className="rounded-xl border border-slate-200 bg-white p-4" key={concept.id}>
                <h3 className="font-medium">Characteristic {index + 1}</h3>
                <div className="mt-3">
                  <EvidenceState evidence={result?.evidence} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  if (nodeId === "caf-application") {
    const application = CATCHING_UNICORNS_PRESENTATION["caf-application"];
    const references = application.framework.map(reference => ({
      ...reference,
      evidence: evidenceFor(state, reference.sourceNodeId, reference.criterionId),
      item: revealText(reference.sourceNodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION, reference.criterionId),
    }));
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800">
            Transfer prompt · not a source-canonical answer
          </p>
          <h3 className="mt-2 text-xl font-semibold">Assess the institution</h3>
          <p className="mt-2 text-sm text-indigo-950">
            A yes, no, or qualified conclusion can be defensible when it follows from evidence.
          </p>
        </section>
        <section className="rounded-2xl border bg-white p-4">
          <h3 className="font-semibold">Previously demonstrated framework</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {references.map((reference, index) => (
              <div className="rounded-xl border p-3" key={reference.criterionId}>
                {reference.evidence?.status === "demonstrated" && reference.item ? (
                  <Revealed item={reference.item} />
                ) : (
                  <p className="text-sm text-slate-500">
                    Framework item {index + 1} is not yet available from accepted evidence.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          {concepts.map((concept, index) => {
            const result = revealCards.find(item => item.criterionId === concept.id);
            return result?.evidence?.status === "demonstrated" && result.item ? (
              <Revealed key={concept.id} item={result.item} />
            ) : (
              <article className="rounded-xl border border-indigo-200 bg-white p-4" key={concept.id}>
                <h3 className="font-medium">Application evidence {index + 1}</h3>
                <div className="mt-2">
                  <EvidenceState evidence={result?.evidence} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  if (nodeId === "synthesis") {
    return (
      <div className="space-y-5" data-scene={nodeId}>
        <SceneHeader node={node} nodeId={nodeId} state={state} />
        <div className="grid gap-3 sm:grid-cols-2">
          {revealCards.map(({ criterionId, item, evidence }) => (
            <div className="relative" key={criterionId}>
              {evidence?.status === "demonstrated" ? (
                <Revealed item={item} />
              ) : (
                <article className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed bg-white p-4 text-sm text-slate-500">
                  Unresolved connection
                </article>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-scene={nodeId}>
      <SceneHeader node={node} nodeId={nodeId} state={state} />
      {nodeId === "why-exographics" && (
        <section
          className="rounded-2xl bg-slate-950 p-6 text-center font-mono text-2xl tracking-wide text-white sm:text-4xl"
          aria-label="Arithmetic example"
        >
          84 + 1,045 + 693 + 719
        </section>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {revealCards.map(({ criterionId, item, evidence }) =>
          evidence?.status === "demonstrated" ? (
            <Revealed key={criterionId} item={item} />
          ) : (
            <article className="rounded-xl border bg-white p-4" key={criterionId}>
              <h3 className="font-medium">Concept not yet revealed</h3>
              <EvidenceState evidence={evidence} />
            </article>
          ),
        )}
      </div>
    </div>
  );
}

function SceneHeader({
  node,
  nodeId,
  state,
}: {
  node: (typeof CATCHING_UNICORNS_LESSON.nodes)[string];
  nodeId: string;
  state: LessonRuntimeState | null | undefined;
}) {
  const title =
    nodeId === "exographics"
      ? evidenceFor(state, nodeId, "visual-symbols")?.status === "demonstrated"
        ? "Exographics"
        : "A broader visual practice"
      : nodeId === "techno-literate-culture"
        ? (node.concepts ?? []).every(concept => evidenceFor(state, nodeId, concept.id)?.status === "demonstrated")
          ? "Techno-literate culture"
          : "Culture and literacy"
        : String(node.presentation.title);
  return (
    <header>
      <p className="text-sm uppercase tracking-[0.2em] text-emerald-800">Catching Unicorns</p>
      <h2 className="mt-2 text-3xl font-semibold">{title}</h2>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-700">{String(node.presentation.prompt)}</p>
    </header>
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
  const canContinue = Boolean(
    live &&
    !snapshot?.awaitingSteering &&
    state?.transitionReady &&
    state.outputActivity === "quiet" &&
    state.tutorOutputDrained &&
    state.quietSinceMs !== null &&
    state.nowMs - state.quietSinceMs >= state.quietDrainMs &&
    !state.childSpeaking &&
    state.childCandidate === null,
  );
  const identity: RenderIdentity | undefined = display ?? { token: "initial", nodeId, sceneId };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:py-10">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">An interactive reading</p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Catching Unicorns</h1>
          <p className="mt-3 text-slate-600">
            Talk through the ideas. Source-backed concepts appear as the conversation demonstrates them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-full bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 disabled:opacity-40"
            disabled={live}
            onClick={start}
          >
            Start discussion
          </button>
          <button
            className="rounded-full border border-slate-300 px-4 py-2.5 font-medium disabled:opacity-40"
            disabled={!live}
            onClick={() => runtime.current?.stop()}
          >
            Stop
          </button>
          <button
            className="rounded-full border border-slate-300 px-4 py-2.5 font-medium disabled:opacity-40"
            disabled={!snapshot}
            onClick={download}
          >
            Export session
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
        <span role="status">
          {snapshot?.status ?? "Ready"}
          {snapshot?.awaitingSteering ? " · applying the next scene" : ""}
        </span>
        {snapshot?.error && (
          <span role="alert" className="text-red-700">
            {snapshot.error}
          </span>
        )}
        <span>
          Scene {sceneIds.indexOf(nodeId) + 1} of {sceneIds.length}
        </span>
      </div>
      <nav aria-label="Lesson scenes" className="grid grid-cols-3 gap-2 sm:grid-cols-9">
        {sceneIds.map((id, index) => (
          <div
            aria-current={id === nodeId ? "step" : undefined}
            className={`h-1.5 rounded-full ${id === nodeId ? "bg-emerald-700" : index < sceneIds.indexOf(nodeId) ? "bg-emerald-200" : "bg-slate-200"}`}
            key={id}
          />
        ))}
      </nav>
      <section
        className="rounded-[1.75rem] border border-emerald-100 bg-[#f6faf7] p-5 shadow-sm sm:p-8"
        aria-label="Lesson scene"
      >
        <div
          ref={sceneRef}
          className="min-h-[27rem]"
          data-render-token={identity.token}
          data-node-id={identity.nodeId ?? "complete"}
          data-scene-id={identity.sceneId ?? "complete"}
        >
          <ScenePresentation state={state} />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-100 pt-5">
          <p className="max-w-2xl text-sm text-slate-600">
            {state?.transitionReady
              ? "Current evidence is validated. Continue when you are ready."
              : "You can stop or skip at any time; skipped ideas remain unresolved."}
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={!live}
              onClick={() => runtime.current?.skipScene()}
            >
              Skip scene
            </button>
            <button
              className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={!canContinue}
              onClick={() => runtime.current?.continueAfterPresentation()}
            >
              {nodeId === "recap" ? "Finish recap" : "Continue"}
            </button>
          </div>
        </div>
      </section>
      <audio ref={audio} />
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
        Scene transitions wait for quiet audio, acknowledged steering, accepted evidence, and your confirmation. Timing
        thresholds are shared runtime safeguards, not mastery timers ({LESSON_TIMING.quietDrainMs} ms audio drain).
      </p>
    </main>
  );
}
