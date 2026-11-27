/** Read the colour a child named in a scene transcript; this never decides acceptance. Safe in the browser. */
import { parseSpokenNumbers, transcriptTurns, type TranscriptTurn } from "./spoken-number";

export type LatestChildColour =
  | { status: "colour"; value: string; owner: "child" | "echo" | "assisted"; source: string }
  | { status: "none" }
  /** She said a number but no colour, e.g. the number back: "Which colour has three?" */
  | { status: "number_only"; source: string }
  /** She pointed with words but named no colour, e.g. "that one": "What colour is it?" */
  | { status: "deictic"; source: string }
  | { status: "ambiguous"; reason: "question" | "alternatives" | "negated" };

export type SpokenColourOptions = {
  /** The expected colour. Only this colour decides echo and assisted ownership. */
  readonly answer?: string;
  /** The colours on screen, canonical and lowercase. */
  readonly colours: readonly string[];
  /** Other spoken words for an on-screen colour, e.g. { yellow: "gold" }. */
  readonly aliases?: Readonly<Record<string, string>>;
};

/** Colour words a child may say that are not on screen. A wrong colour is still an answer, not silence. */
const COMMON_COLOURS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "white",
  "grey",
  "gray",
  "gold",
  "silver",
] as const;

/** "that one", "this one", "the one there", "over here": she has found a stocking but not named it. */
const POINTING = /\b(?:(?:that|this|the)\s+one|that|this|(?:over\s+)?(?:there|here))\b/i;
/** Pronouns point too, but "it's three" is the number back, so they only count when no number was said. */
const PRONOUN = /\b(?:it|him|her)\b/i;

type Match = { value: string; source: string; start: number; end: number };

function vocabulary(options: SpokenColourOptions): Map<string, string> {
  const words = new Map<string, string>();
  for (const colour of [...COMMON_COLOURS, ...options.colours]) words.set(colour.toLowerCase(), colour.toLowerCase());
  for (const [word, colour] of Object.entries(options.aliases ?? {}))
    words.set(word.toLowerCase(), colour.toLowerCase());
  return words;
}

function readColours(text: string, words: Map<string, string>): Match[] {
  const matches: Match[] = [];
  for (const token of text.matchAll(/\b[a-z]+\b/gi)) {
    const value = words.get(token[0].toLowerCase());
    if (value) matches.push({ value, source: token[0], start: token.index, end: token.index + token[0].length });
  }
  return matches;
}

/** Parse a presentation's `colours` fact ("gold,pink,purple"), left to right. */
export function presentationColours(presentation: Readonly<Record<string, unknown>>): string[] {
  const colours = presentation.colours;
  return typeof colours === "string"
    ? colours
        .split(",")
        .map(colour => colour.trim())
        .filter(Boolean)
    : [];
}

/**
 * The latest child colour in a scene transcript. The last colour in her latest turn wins, so a
 * self-correction ("pink… no, purple") reads as purple. Ownership mirrors `latestChildNumber`: the answer
 * is an echo only when the tutor said the answer colour before the child first tried it, and the child's
 * second separate repeat after that is "assisted". The tutor naming a wrong pick ("the pink one has two")
 * never changes ownership, because only the answer colour is looked for in the tutor's turns.
 */
export function latestChildColour(transcript: string, options: SpokenColourOptions): LatestChildColour {
  const turns = transcriptTurns(transcript);
  const index = turns.findLastIndex(turn => turn.speaker === "child");
  if (index < 0) return { status: "none" };
  const words = vocabulary(options);
  const text = turns[index].text;
  const colours = readColours(text, words);
  const last = colours.at(-1);
  if (!last) {
    const pointing = text.match(POINTING);
    if (pointing) return { status: "deictic", source: pointing[0] };
    const number = parseSpokenNumbers(text).findLast(item => item.kind === "number");
    if (number) return { status: "number_only", source: number.source };
    const pronoun = text.match(PRONOUN);
    return pronoun ? { status: "deictic", source: pronoun[0] } : { status: "none" };
  }
  // "purple?" and "the purple one?" ask rather than answer.
  if (/^(?:\s+(?:one|stocking))?\s*\?/i.test(text.slice(last.end))) return { status: "ambiguous", reason: "question" };
  const prior = colours.at(-2);
  if (prior && /\bor\b/i.test(text.slice(prior.end, last.start)))
    return { status: "ambiguous", reason: "alternatives" };
  // "not the pink one" names a stocking she ruled out. "no, purple" is a correction and still counts.
  if (/\bnot\s+(?:the\s+)?$/i.test(text.slice(0, last.start))) return { status: "ambiguous", reason: "negated" };
  const result = { status: "colour" as const, value: last.value, source: last.source };
  const answer = options.answer?.toLowerCase();
  if (answer === undefined || last.value !== answer) return { ...result, owner: "child" };
  const names = (turn: TranscriptTurn) => readColours(turn.text, words).some(match => match.value === answer);
  const disclosure = turns.findIndex(turn => turn.speaker === "tutor" && names(turn));
  const starts = turns.flatMap((turn, at) => (at <= index && turn.speaker === "child" && names(turn) ? [at] : []));
  if (disclosure < 0 || starts[0] < disclosure) return { ...result, owner: "child" };
  return { ...result, owner: starts.filter(start => start > disclosure).length >= 2 ? "assisted" : "echo" };
}

/**
 * The on-screen colour the child picked in her latest turn, whoever said it first, or null when she named
 * no single on-screen colour. For the stage to highlight the stocking she chose.
 */
export function pickedColour(
  transcript: string,
  presentation: Readonly<Record<string, unknown>>,
  aliases?: Readonly<Record<string, string>>,
): string | null {
  const colours = presentationColours(presentation);
  const reader = latestChildColour(transcript, { colours, aliases });
  return reader.status === "colour" && colours.includes(reader.value) ? reader.value : null;
}
