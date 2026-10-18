import type { TranscriptEvent } from "../events";
import { normalizeRecapSpeech } from "./evidence-recap";

/** Verify the entire close, preserving fragment boundaries as artifact evidence.
 * Only identical retransmissions of the same provider interval and one isolated
 * opening-word restart are tolerated. Never remove internal repeated words or
 * infer omitted words. Raw diagnostic transcripts remain unchanged.
 */
export function terminalRecapComplete(expected: string, fragments: readonly TranscriptEvent[]) {
  const unique = fragments.filter(
    (fragment, index) =>
      !fragments
        .slice(0, index)
        .some(
          previous =>
            previous.startMs === fragment.startMs &&
            previous.endMs === fragment.endMs &&
            previous.delta === fragment.delta,
        ),
  );
  const normalized = normalizeRecapSpeech(expected);
  const join = (start: number) =>
    normalizeRecapSpeech(
      unique
        .slice(start)
        .map(fragment => fragment.delta)
        .join(""),
    );
  if (join(0) === normalized) return true;
  // October 16: a standalone "You" followed by a second, complete delivery.
  // Require a whole first-word fragment and the exact FULL remainder. This
  // cannot rescue missing openings/endings, substitutions or reordered text.
  const opening = normalized.split(" ")[0];
  return unique.length > 1 && normalizeRecapSpeech(unique[0].delta) === opening && join(1) === normalized;
}
