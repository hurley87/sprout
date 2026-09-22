import { GOODBYE_PHRASE } from "./lesson";

/** Silence longer than this starts a new utterance. */
export const UTTERANCE_GAP_MS = 2500;
/** Enough context for a short request; keeps diagnostics bounded. */
export const WINDOW_CHARS = 500;

/** The recent speech of one speaker, rebuilt from provider transcript deltas. */
export class TranscriptWindow {
  private text = "";
  private lastEndMs = -Infinity;

  /** Returns the current utterance, so a fresh one never inherits an old negation. */
  append(delta: string, startMs: number, endMs: number): string {
    if (startMs - this.lastEndMs > UTTERANCE_GAP_MS) this.text = "";
    this.text = (this.text + delta).slice(-WINDOW_CHARS);
    this.lastEndMs = endMs;
    return this.text;
  }
}

// Conservative transcript guard, not a semantic classifier. Recognition limits
// are documented; the model is also instructed to acknowledge stop requests.
export function requestsStop(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  const clause = normalized.split(/[.!?;,]/).map(part => part.trim()).filter(Boolean).at(-1) || "";
  if (/\b(don't|do not|not|never)\s+(want to\s+)?stop\b/.test(clause)) return false;
  return /\b(stop|i(?:'m| am) done|all done|no more|i (?:want|need) to (?:go|quit|finish)|can we (?:finish|end)|(?:don't|do not) want to (?:play|count)(?: anymore)?)\b/.test(clause);
}

const GOODBYE = new RegExp(`${GOODBYE_PHRASE.replace(/[.!]+$/, "").replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")}[.!]?\\s*$`, "i");

/** The model ending the lesson itself. Not proof that the child heard it. */
export function saidGoodbye(text: string): boolean {
  return GOODBYE.test(text);
}
