import { GOODBYE_PHRASE } from "./lesson";

/** Silence longer than this starts a new utterance. */
export const UTTERANCE_GAP_MS = 2500;
/** Enough context for a short request; keeps diagnostics bounded. */
export const WINDOW_CHARS = 500;

/** Speech so far in one utterance, identified by when that utterance began. */
export type Utterance = { text: string; startMs: number };

/** The recent speech of one speaker, rebuilt from provider transcript deltas. */
export class TranscriptWindow {
  private text = "";
  private startMs = 0;
  private lastEndMs = -Infinity;

  /** Returns the current utterance, so a fresh one never inherits an old negation. */
  append(delta: string, startMs: number, endMs: number): Utterance {
    if (startMs - this.lastEndMs > UTTERANCE_GAP_MS) {
      this.text = "";
      this.startMs = startMs;
    }
    this.text = (this.text + delta).slice(-WINDOW_CHARS);
    this.lastEndMs = endMs;
    return { text: this.text, startMs: this.startMs };
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
