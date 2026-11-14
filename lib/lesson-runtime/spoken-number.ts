/** Read spoken number candidates from a scene transcript; this never decides acceptance. */
export type SpokenNumber = { kind: "number"; value: number; source: string } | { kind: "malformed"; source: string };

export type LatestChildNumber =
  | { status: "number"; value: number; owner: "child" | "echo"; source: string }
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
  return matches;
}

export function parseSpokenNumbers(text: string): SpokenNumber[] {
  return readNumbers(text).map(({ item }) => item);
}

export function latestChildNumber(transcript: string, options?: { answer?: number }): LatestChildNumber {
  const turns = [
    ...transcript.matchAll(
      /(?:^|\n|(?=\b(?:Child|Tutor):))\s*(Child|Tutor):\s*([\s\S]*?)(?=\n\s*(?:Child|Tutor):|\b(?:Child|Tutor):|$)/gi,
    ),
  ].map(match => ({ speaker: match[1].toLowerCase(), text: match[2].trim() }));
  const index = turns.findLastIndex(turn => turn.speaker === "child");
  if (index < 0) return { status: "none" };
  let text = turns[index].text;
  let candidateIndex = index;
  const previous = turns[index - 2];
  const middle = turns[index - 1];
  if (
    previous?.speaker === "child" &&
    middle?.speaker === "tutor" &&
    (middle.text.match(/[a-z]+(?:-[a-z]+)?/gi)?.length ?? 0) <= 3 &&
    /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*[.…-]*$/i.test(previous.text) &&
    /^[\s.…-]*(?:one|two|three|four|five|six|seven|eight|nine)\b/i.test(text)
  ) {
    text = `${previous.text} ${text.replace(/^[\s.…-]*/, "")}`;
    candidateIndex = index;
  }
  const numbers = readNumbers(text);
  const last = numbers.at(-1);
  if (!last) return { status: "none" };
  if (last.item.kind === "malformed") return { status: "malformed" };
  if (/^\s*\?/.test(text.slice(last.end))) return { status: "ambiguous", reason: "question" };
  const prior = numbers.at(-2);
  if (prior && /\bor\b/i.test(text.slice(prior.end, last.start)))
    return { status: "ambiguous", reason: "alternatives" };
  const echo =
    options?.answer !== undefined &&
    turns
      .slice(0, candidateIndex)
      .some(
        turn =>
          turn.speaker === "tutor" &&
          parseSpokenNumbers(turn.text).some(number => number.kind === "number" && number.value === options.answer),
      );
  return { status: "number", value: last.item.value, owner: echo ? "echo" : "child", source: last.item.source };
}
