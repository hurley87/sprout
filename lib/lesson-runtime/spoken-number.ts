/** Read spoken number candidates from a scene transcript; this never decides acceptance. */
export type SpokenNumber = { kind: "number"; value: number; source: string } | { kind: "malformed"; source: string };

export type LatestChildNumber =
  | { status: "number"; value: number; owner: "child" | "echo" | "assisted"; source: string }
  | { status: "none" }
  | { status: "ambiguous"; reason: string }
  | { status: "malformed" };

const units: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const teens: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const tens: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
type Match = { item: SpokenNumber; start: number; end: number };

function readNumbers(text: string): Match[] {
  const tokens = [...text.matchAll(/\b(?:[a-z]+|\d+)\b/gi)];
  const matches: Match[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const word = token[0].toLowerCase();
    const start = token.index;
    if (
      i > 0 &&
      word in units &&
      /^[a-z]+-$/i.test(text.slice(tokens[i - 1].index, start)) &&
      !(tokens[i - 1][0].toLowerCase() in tens)
    )
      continue;
    let end = start + token[0].length;
    let item: SpokenNumber | undefined;
    const next = tokens[i + 1];
    const nextWord = next?.[0].toLowerCase();
    const gap = next ? text.slice(end, next.index) : "";
    if (word in teens && nextWord in units && /^\s*-\s*$/.test(gap)) {
      end = next.index + next[0].length;
      item = { kind: "malformed", source: text.slice(start, end) };
      i++;
    } else if (word in tens) {
      let value = tens[word];
      let unit = next;
      let unitWord = nextWord;
      let separator = gap;
      if (nextWord === "and" && /^\s+$/.test(gap)) {
        unit = tokens[i + 2];
        unitWord = unit?.[0].toLowerCase();
        separator = unit ? text.slice(end, unit.index) : "";
      }
      if (
        unit &&
        unitWord in units &&
        units[unitWord] > 0 &&
        /^(?:\s+|\s*-\s*|\s*(?:…|\.{3})\s*|\s+and\s+)$/i.test(separator)
      ) {
        value += units[unitWord];
        end = unit.index + unit[0].length;
        i += nextWord === "and" ? 2 : 1;
      }
      item = { kind: "number", value, source: text.slice(start, end) };
    } else if (word in units || word in teens) {
      item = { kind: "number", value: units[word] ?? teens[word], source: token[0] };
    } else if (/^\d+$/.test(word) && Number(word) <= 99) {
      item = { kind: "number", value: Number(word), source: token[0] };
    }
    if (item) matches.push({ item, start, end });
  }
  return joinCountingOn(text, matches);
}

/** Children often count on from a tens number by saying only the ones: "twenty, one, two, three" is
 * 21, 22, 23, and "forty-one, two" is 41, 42. Bare ones that continue a two-digit number one at a time,
 * separated only by pauses or punctuation, take its tens. Anything else, such as "fifty, six", is unchanged. */
function joinCountingOn(text: string, matches: Match[]): Match[] {
  const joined = [...matches];
  for (let i = 0; i < joined.length; i++) {
    const base = joined[i];
    if (base.item.kind !== "number" || base.item.value < 20) continue;
    const tensValue = base.item.value - (base.item.value % 10);
    let ones = base.item.value % 10;
    for (let j = i + 1; j < joined.length && ones < 9; j++, i++) {
      const next = joined[j];
      if (
        next.item.kind !== "number" ||
        !/^(?:[a-z]+|\d)$/i.test(next.item.source) ||
        next.item.value !== ones + 1 ||
        !/^[\s,.…-]*$/.test(text.slice(joined[j - 1].end, next.start))
      )
        break;
      ones = next.item.value;
      joined[j] = {
        ...next,
        item: { kind: "number", value: tensValue + ones, source: text.slice(base.start, next.end) },
      };
    }
  }
  return joined;
}

export function parseSpokenNumbers(text: string): SpokenNumber[] {
  return readNumbers(text).map(({ item }) => item);
}

type Turn = { speaker: string; text: string };
type Attempt = { text: string; numbers: Match[]; joinedFrom?: number };

/** A child turn's numbers, joined with the child's previous turn when a short tutor interjection split a
 * two-digit number (Child: fifty / Tutor: Yes, / Child: -six). */
function childAttempt(turns: Turn[], index: number): Attempt {
  const text = turns[index].text;
  const previous = turns[index - 2];
  const middle = turns[index - 1];
  if (
    previous?.speaker === "child" &&
    middle?.speaker === "tutor" &&
    (middle.text.match(/[a-z]+(?:-[a-z]+)?/gi)?.length ?? 0) <= 3 &&
    /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*[.…-]*$/i.test(previous.text) &&
    /^[\s.…-]*(?:one|two|three|four|five|six|seven|eight|nine)\b/i.test(text)
  ) {
    const joined = `${previous.text} ${text.replace(/^[\s.…-]*/, "")}`;
    return { text: joined, numbers: readNumbers(joined), joinedFrom: index - 2 };
  }
  return { text, numbers: readNumbers(text) };
}

/** Turn indexes where the child starts saying `value`: a split number starts at its tens-word turn. */
function childAttemptStarts(turns: Turn[], value: number, through: number): number[] {
  const starts = new Set<number>();
  for (let index = 0; index <= through; index++) {
    if (turns[index].speaker !== "child") continue;
    const attempt = childAttempt(turns, index);
    for (const match of attempt.numbers) {
      if (match.item.kind !== "number" || match.item.value !== value) continue;
      const fromPrevious = attempt.joinedFrom !== undefined && match.start < turns[attempt.joinedFrom].text.length;
      starts.add(fromPrevious ? attempt.joinedFrom! : index);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/**
 * The latest child number in a scene transcript. Ownership follows the child's first attempt at the answer:
 * it is an echo only when the tutor said the answer before the child first tried it. A tutor talking over a
 * child mid-number (Child: fifty / Tutor: Yes! Fifty-six / Child: -six) therefore does not take the answer
 * away, nor do the tutor's later confirmations. When the tutor did disclose the answer first, the child's
 * second separate repeat after that is "assisted", so a tutor slip cannot trap the child on the scene.
 */
export function latestChildNumber(transcript: string, options?: { answer?: number }): LatestChildNumber {
  const turns: Turn[] = [
    ...transcript.matchAll(
      /(?:^|\n|(?=\b(?:Child|Tutor):))\s*(Child|Tutor):\s*([\s\S]*?)(?=\n\s*(?:Child|Tutor):|\b(?:Child|Tutor):|$)/gi,
    ),
  ]
    .map(match => ({ speaker: match[1].toLowerCase(), text: match[2].trim() }))
    // A wordless child fragment ("Child: .", a microphone turn that produced no words) is not a newer
    // attempt, so it must not hide the answer the child actually spoke.
    .filter(turn => turn.speaker !== "child" || /[\p{L}\p{N}]/u.test(turn.text));
  const index = turns.findLastIndex(turn => turn.speaker === "child");
  if (index < 0) return { status: "none" };
  const { text, numbers } = childAttempt(turns, index);
  const last = numbers.at(-1);
  if (!last) return { status: "none" };
  if (last.item.kind === "malformed") return { status: "malformed" };
  if (/^\s*\?/.test(text.slice(last.end))) return { status: "ambiguous", reason: "question" };
  const prior = numbers.at(-2);
  if (prior && /\bor\b/i.test(text.slice(prior.end, last.start)))
    return { status: "ambiguous", reason: "alternatives" };
  const value = last.item.value;
  const result = { status: "number" as const, value, source: last.item.source };
  const answer = options?.answer;
  if (answer === undefined || value !== answer) return { ...result, owner: "child" };
  const disclosure = turns.findIndex(
    turn =>
      turn.speaker === "tutor" &&
      parseSpokenNumbers(turn.text).some(number => number.kind === "number" && number.value === answer),
  );
  const starts = childAttemptStarts(turns, answer, index);
  if (disclosure < 0 || starts[0] < disclosure) return { ...result, owner: "child" };
  return { ...result, owner: starts.filter(start => start > disclosure).length >= 2 ? "assisted" : "echo" };
}
