import type { Evidence, ResponseRecognitionContext } from "./session-recorder";
import { GOODBYE_PHRASE } from "./lesson";

/** Silence longer than this starts a new utterance. */
export const UTTERANCE_GAP_MS = 2500;
/** Enough context for a short request; keeps diagnostics bounded. */
export const WINDOW_CHARS = 500;

/** Speech so far in one utterance, identified by when that utterance began. */
type AnswerFragment = { key: string; sourceId?: number };
export type Utterance = {
  text: string;
  startMs: number;
  fragments?: AnswerFragment[];
  fragmentsComplete?: boolean;
  recognitionContext?: ResponseRecognitionContext;
};

/** The recent speech of one speaker, rebuilt from provider transcript deltas. */
export class TranscriptWindow {
  private text = "";
  private startMs = 0;
  private lastEndMs = -Infinity;
  private fragments: { identity?: AnswerFragment; textEnd: number }[] = [];

  /** Returns the current utterance, so a fresh one never inherits an old negation. */
  append(delta: string, startMs: number, endMs: number, identity?: AnswerFragment): Utterance {
    if (startMs - this.lastEndMs > UTTERANCE_GAP_MS) {
      this.text = "";
      this.startMs = startMs;
      this.fragments = [];
    }
    const removed = Math.max(0, this.text.length + delta.length - WINDOW_CHARS);
    if (delta.length) this.fragments.push({ identity, textEnd: this.text.length + delta.length });
    this.fragments = this.fragments
      .map(fragment => ({ ...fragment, textEnd: fragment.textEnd - removed }))
      .filter(fragment => fragment.textEnd > 0);
    this.text = (this.text + delta).slice(-WINDOW_CHARS);
    this.lastEndMs = endMs;
    return {
      text: this.text,
      startMs: this.startMs,
      ...(identity
        ? {
            fragments: this.fragments.flatMap(fragment => (fragment.identity ? [{ ...fragment.identity }] : [])),
            fragmentsComplete: this.fragments.every(fragment => fragment.identity !== undefined),
          }
        : {}),
    };
  }
}

/** "I don't want to stop" is a request to keep playing, not to stop. */
const KEEP_PLAYING = /\b(don't|do not|not|never)\s+(want to\s+)?stop\b/;
const STOP =
  /\b(stop|i(?:'m| am) done|all done|no more|i (?:want|need) to (?:go|quit|finish)|can we (?:finish|end)|(?:don't|do not) want to (?:play|count)(?: anymore)?)\b/;

// Conservative transcript guard, not a semantic classifier. Recognition limits
// are documented; the model is also instructed to acknowledge stop requests.
export function requestsStop(text: string): boolean {
  // Every clause counts, so "Stop, please" is heard as readily as "Please stop".
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[.!?;,]/)
    .some(clause => !KEEP_PLAYING.test(clause) && STOP.test(clause));
}

const NUMBER = /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/;

/**
 * The same trigger the prompt gives GPT-Live for pausing until the app has
 * checked a count. Says nothing about whether the count is right.
 */
export function mentionsNumber(text: string): boolean {
  return NUMBER.test(text.toLowerCase());
}

const GOODBYE = new RegExp(
  `${GOODBYE_PHRASE.replace(/[.!]+$/, "").replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")}[.!]?\\s*$`,
  "i",
);

/** The model ending the lesson itself. Not proof that the child heard it. */
export function saidGoodbye(text: string): boolean {
  return GOODBYE.test(text);
}

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

/** Full canonical text is separate from the bounded diagnostic/answer window. */
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
  retainRecognition(response: Utterance, recognition: ResponseRecognitionContext["recognition"]) {
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
