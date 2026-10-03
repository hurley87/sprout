import type { Evidence } from "./session-recorder";
/** Silence longer than this starts a new utterance. */
export const UTTERANCE_GAP_MS = 2500;
export type RecordedUtterance = {
  text: string;
  startMs: number;
  endMs: number;
  delivered: boolean;
  context?: Pick<
    Extract<Evidence, { type: "utterance" }>,
    "providerTiming" | "sessionTiming" | "responseScene" | "recognition"
  >;
  firstObservedAtMs: number;
  lastObservedAtMs: number;
  transcriptFragments?: Extract<Evidence, { type: "utterance" }>["transcriptFragments"];
};

/** Full canonical evidence text, including fragment identity and timing provenance. */
export class UtteranceAccumulator {
  private open: RecordedUtterance | null = null;
  append(
    delta: string,
    startMs: number,
    endMs: number,
    delivered: boolean,
    observedAtMs = 0,
    context?: RecordedUtterance["context"],
    fragmentKey?: string,
  ): RecordedUtterance | null {
    let completed: RecordedUtterance | null = null;
    if (
      this.open &&
      (startMs - this.open.endMs > UTTERANCE_GAP_MS ||
        this.open.context?.providerTiming?.sourceId !== context?.providerTiming?.sourceId)
    )
      completed = this.take();
    if (!this.open)
      this.open = {
        text: "",
        startMs,
        endMs,
        delivered,
        context: context ? structuredClone(context) : undefined,
        firstObservedAtMs: observedAtMs,
        lastObservedAtMs: observedAtMs,
      };
    // A new fragment invalidates the prior revision until its complete answer
    // context is established. Ignored transition fragments never inherit it.
    if (this.open.context && context?.recognition) this.open.context.recognition = context.recognition;
    if (
      this.open.context?.responseScene &&
      (this.open.context.responseScene.sceneId !== context?.responseScene?.sceneId ||
        this.open.context.responseScene.displayedAtMs !== context?.responseScene?.displayedAtMs)
    )
      this.open.context.responseScene.status = "changed";
    if (this.open.context?.providerTiming) {
      this.open.context.providerTiming.startMs = Math.min(this.open.startMs, startMs);
      this.open.context.providerTiming.endMs = Math.max(this.open.endMs, endMs);
    }
    // Every fragment must have the same independently fenced source. Never
    // recover trust after one fragment lacks a bound or changes its identity.
    const prior = this.open.context?.sessionTiming;
    const next = context?.sessionTiming;
    if (
      prior &&
      next &&
      prior.provenance === "source_input_bound" &&
      next.provenance === "source_input_bound" &&
      prior.sourceId === next.sourceId &&
      prior.startMs === next.startMs
    ) {
      prior.endMs = Math.max(prior.endMs, next.endMs);
    } else if (
      prior?.provenance === "source_timeline_bound" &&
      next?.provenance === "source_timeline_bound" &&
      prior.sourceId === next.sourceId &&
      prior.sourceRequestedAtMs === next.sourceRequestedAtMs &&
      prior.inputOpenedAtMs === next.inputOpenedAtMs &&
      prior.inputScene.sceneId === next.inputScene.sceneId &&
      prior.inputScene.displayedAtMs === next.inputScene.displayedAtMs
    ) {
      prior.startMs = Math.min(prior.startMs, next.startMs);
      prior.endMs = Math.max(prior.endMs, next.endMs);
    } else if (prior?.provenance === "mapped_provider" && next?.provenance === "mapped_provider") {
      prior.startMs = Math.min(prior.startMs, next.startMs);
      prior.endMs = Math.max(prior.endMs, next.endMs);
    } else if (this.open.context) delete this.open.context.sessionTiming;
    this.open.lastObservedAtMs = observedAtMs;
    if (fragmentKey && delta.length) {
      (this.open.transcriptFragments ??= []).push({
        key: fragmentKey,
        textStart: this.open.text.length,
        textEnd: this.open.text.length + delta.length,
      });
    }
    this.open.text += delta;
    this.open.startMs = Math.min(this.open.startMs, startMs);
    this.open.endMs = Math.max(this.open.endMs, endMs);
    this.open.delivered &&= delivered;
    return completed;
  }
  /** Answer windows and durable utterances have many-to-many fragment joins.
   * A policy result for different/partial text cannot clarify this utterance. */
  retainRecognition(
    response: {
      text: string;
      startMs?: number;
      fragmentsComplete?: boolean;
      fragments?: { key: string; sourceId?: number }[];
    },
    recognition: NonNullable<Extract<Evidence, { type: "utterance" }>["recognition"]>,
  ) {
    const open = this.open;
    const fragments = response.fragments ?? [];
    const sourceId = open?.context?.providerTiming?.sourceId;
    const matches = Boolean(
      open &&
      response.fragmentsComplete &&
      fragments.length &&
      Number.isSafeInteger(sourceId) &&
      sourceId! > 0 &&
      fragments.every(fragment => fragment.sourceId === sourceId) &&
      open.text === response.text &&
      open.transcriptFragments?.length === fragments.length &&
      open.transcriptFragments.every((fragment, index) => fragment.key === fragments[index].key) &&
      open.context?.responseScene?.status === "stable",
    );
    const retained = matches ? recognition : "needs_confirmation";
    if (open?.context) open.context.recognition = retained;
    return retained;
  }
  take() {
    const utterance = this.open;
    this.open = null;
    return utterance;
  }
  invalidateDelivery() {
    if (this.open) this.open.delivered = false;
  }
}
