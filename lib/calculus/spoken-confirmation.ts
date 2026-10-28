export type MathOperation = "differentiate" | "rewrite" | "unassessed";
const commands: Record<string, MathOperation> = {
  "confirm differentiation": "differentiate",
  "confirm rewrite": "rewrite",
  "confirm without checking": "unassessed",
};
const commandWords = Object.keys(commands).map(command => command.split(" "));
const numbers = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

/** Speech recognition punctuates freely and never emits semicolons, so separators
 * and terminal punctuation are ignored. Quotes are kept: quoted speech cannot accept.
 */
function words(text: string) {
  return text
    .toLowerCase()
    .replace(/(\w)[’‘](\w)/g, "$1'$2")
    .replace(/[.,;:!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Matches the start of `input` against each command. Without `prefix`, only whole
 * commands match; with it, input may stop early and an `open` final word may be partial.
 * `operation` is null for an incomplete command. */
function matchCommand(input: readonly string[], prefix = false, open = false) {
  const matches: { operation: MathOperation | null; length: number }[] = [];
  for (const command of commandWords) {
    const length = Math.min(command.length, input.length);
    const ok = command
      .slice(0, length)
      .every((word, i) => (i === input.length - 1 && open ? word.startsWith(input[i]) : word === input[i]));
    if (!ok) continue;
    if (length === command.length && (!open || input.length > length))
      matches.push({ operation: commands[command.join(" ")], length });
    else if (prefix && length === input.length) matches.push({ operation: null, length });
  }
  return matches;
}

/** Closed grammar: one command applying to every displayed action, or each action
 * numbered in order ("action 1 confirm rewrite, action 2 confirm differentiation").
 * No substring matching: reported/negated speech cannot accept.
 */
export function parseSpokenMathConfirmation(text: string, count: number): MathOperation[] | null {
  if (text.length > 600 || count < 1 || count > 8) return null;
  const input = words(text);
  const single = matchCommand(input).find(match => match.length === input.length);
  if (single?.operation) return Array(count).fill(single.operation);
  const operations: MathOperation[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (input[at] !== "action" || ![String(index + 1), numbers[index]].includes(input[at + 1])) return null;
    const match = matchCommand(input.slice(at + 2))[0];
    if (!match?.operation) return null;
    operations.push(match.operation);
    at += 2 + match.length;
  }
  return at === input.length ? operations : null;
}

/** Only a possible prefix may retain the reservation while the turn is open. */
export function isSpokenMathConfirmationPrefix(text: string, count: number): boolean {
  if (text.length > 600 || count < 1 || count > 8) return false;
  const input = words(text);
  const open = !/[\s.,;:!?]$/.test(text);
  if (input.length === 0) return true;
  if (matchCommand(input, true, open).some(match => match.length === input.length)) return true;
  let at = 0;
  for (let index = 0; index < count; index++) {
    const rest = input.slice(at);
    const label = ["action", String(index + 1)];
    const spoken = ["action", numbers[index]];
    const labelPrefix = [label, spoken].some(
      candidate =>
        rest.length <= 2 &&
        rest.every((word, i) =>
          i === rest.length - 1 && open ? candidate[i].startsWith(word) : candidate[i] === word,
        ),
    );
    if (labelPrefix) return true;
    if (rest[0] !== "action" || ![label[1], spoken[1]].includes(rest[1])) return false;
    const tail = rest.slice(2);
    const matches = matchCommand(tail, true, open);
    if (matches.some(match => match.length === tail.length)) return true;
    const full = matches.find(match => match.operation);
    if (!full) return false;
    at += 2 + full.length;
  }
  return false;
}

/** A bare "yes"/"correct" answers the tutor's question but grants no authority.
 * The runtime keeps the displayed proposal instead of re-interpreting it as new work. */
const affirmations = ["yes", "yeah", "yep", "correct", "right", "that's right", "that is right", "yes that's right"];
export function isSpokenAffirmation(text: string): boolean {
  return affirmations.includes(words(text).join(" "));
}
export function isSpokenAffirmationPrefix(text: string): boolean {
  const spoken = words(text).join(" ");
  return !spoken || affirmations.some(affirmation => affirmation.startsWith(spoken));
}
