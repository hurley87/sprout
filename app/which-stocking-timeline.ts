import { pickedColour, presentationColours } from "@/lib/lesson-runtime/spoken-colour";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonStageProps } from "./lesson-screen";

/** Incorrect difficulties recorded in the current confirmed visit, as `christmasTreeMisses` counts them. */
export function whichStockingMisses(
  snapshot: LessonStageProps["snapshot"] | undefined,
  node: LessonStageProps["node"],
): number {
  const runtime = snapshot?.runtime;
  if (!runtime || !node || runtime.nodeId !== node.id || runtime.pendingRender) return 0;
  return (
    runtime.difficulties?.filter(record => record.kind === "incorrect" && record.source.visitId === runtime.visitId)
      .length ?? 0
  );
}

/** The stockings left to right, each with the candy canes it shows. */
export function stockingCounts(node: LessonNodeDefinition): { colour: string; count: number }[] {
  return presentationColours(node.presentation).map(colour => ({
    colour,
    count: Number(node.presentation[`count_${colour}`] ?? 0),
  }));
}

/**
 * What the stage shows for a new miss. The second miss counts every stocking and then marks the answer;
 * every other miss lights the stocking she named. `colour` is null when she named no colour on screen,
 * so nothing lights up.
 */
export type MissHighlight = { kind: "pick"; miss: number; colour: string | null } | { kind: "sweep"; miss: number };

/**
 * `transcript` is `snapshot.transcript`: the current visit's ordered "Child: …" / "Tutor: …" lines, reset
 * when a new scene is committed. Read it in the same render as the new miss, before her next turn lands.
 */
export function missHighlight(
  miss: number,
  transcript: string,
  node: LessonNodeDefinition,
  aliases?: Readonly<Record<string, string>>,
): MissHighlight {
  if (miss === 2) return { kind: "sweep", miss };
  return { kind: "pick", miss, colour: pickedColour(transcript, node.presentation, aliases) };
}

/** Lead-in before the first cane lights, so the tutor's reply can begin. */
export const HIGHLIGHT_LEAD_MS = 500;
/** About one cane a second as the tutor counts her pick. */
export const PICK_CANE_MS = 1000;
/** The last cane of her pick stays lit this long before the highlight ends. */
export const PICK_HOLD_MS = 1200;
/** Each stocking's canes in turn after the second miss. */
export const SWEEP_CANE_MS = 800;
/** A short rest between stockings after the second miss. */
export const SWEEP_GAP_MS = 500;

export type HighlightStep = { colour: string; cane: number; atMs: number };
export type HighlightSequence = { steps: HighlightStep[]; endMs: number };

/** When each cane lights, and when the sequence ends (the glow starts there after the second miss). */
export function highlightSequence(highlight: MissHighlight, node: LessonNodeDefinition): HighlightSequence {
  const stockings = stockingCounts(node);
  if (highlight.kind === "pick") {
    const count = stockings.find(stocking => stocking.colour === highlight.colour)?.count ?? 0;
    if (!highlight.colour || count < 1) return { steps: [], endMs: 0 };
    const steps = Array.from({ length: count }, (_, cane) => ({
      colour: highlight.colour!,
      cane,
      atMs: HIGHLIGHT_LEAD_MS + cane * PICK_CANE_MS,
    }));
    return { steps, endMs: steps.at(-1)!.atMs + PICK_HOLD_MS };
  }
  const steps: HighlightStep[] = [];
  let at = HIGHLIGHT_LEAD_MS;
  stockings.forEach(({ colour, count }, index) => {
    if (index > 0) at += SWEEP_GAP_MS;
    for (let cane = 0; cane < count; cane++, at += SWEEP_CANE_MS) steps.push({ colour, cane, atMs: at });
  });
  return { steps, endMs: at };
}

/**
 * The lit canes after `fired` steps: the stocking being counted, with its first `count` canes lit. A stocking
 * stays lit through the gap until the next one starts.
 */
export function litCanes(steps: readonly HighlightStep[], fired: number): { colour: string; count: number } | null {
  if (fired < 1) return null;
  const colour = steps[Math.min(fired, steps.length) - 1].colour;
  return { colour, count: steps.slice(0, fired).filter(step => step.colour === colour).length };
}

/** The right stocking's jiggle, at the start of the success hold. */
export const SUCCESS_JIGGLE_MS = 400;
/** One candy cane pops at a time, so five fit in the hold. */
export const SUCCESS_POP_STAGGER_MS = 750;
export const SUCCESS_POP_MS = 600;
export const SUCCESS_TOY_DROP_MS = 700;

export type SuccessTimeline = { popAtMs: number[]; toyAtMs: number; endMs: number };

/** The success sequence: jiggle, then each cane pops in turn, then the toy drops. It fits in `successHoldMs`. */
export function successTimeline(count: number): SuccessTimeline {
  const popAtMs = Array.from({ length: count }, (_, cane) => SUCCESS_JIGGLE_MS + cane * SUCCESS_POP_STAGGER_MS);
  const toyAtMs = SUCCESS_JIGGLE_MS + count * SUCCESS_POP_STAGGER_MS;
  return { popAtMs, toyAtMs, endMs: Math.max(toyAtMs + SUCCESS_TOY_DROP_MS, (popAtMs.at(-1) ?? 0) + SUCCESS_POP_MS) };
}
