/** Text heuristics are recovery policy, never provider confidence or proof of an ASR error. */
export type Recovery = "clarification" | "instructional_support";
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function isolatedTotal(text: string): number | undefined {
  if (text.includes("?")) return undefined;
  const token = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "");
  if (/^\d{1,2}$/.test(token)) return Number(token);
  const index = words.indexOf(token);
  return index < 0 ? undefined : index;
}
export function recognitionRecovery(text: string, repeatedTotal?: number): Recovery {
  const total = isolatedTotal(text);
  const tokens =
    text.toLowerCase().match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b/g) ?? [];
  const numbers = tokens.map(token => (/^\d+$/.test(token) ? Number(token) : words.indexOf(token)));
  const sequence =
    !text.includes("?") &&
    numbers.length >= 2 &&
    numbers[0] === 1 &&
    numbers.every((number, index) => number === index + 1) &&
    text
      .toLowerCase()
      .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b/g, "")
      .replace(/[\s,.!]/g, "") === "";
  if (sequence) return "instructional_support";
  // Clear in-scope answers can receive help. An isolated out-of-scope number
  // gets one neutral confirmation; a repeated same total can receive help.
  // Non-isolated/unclear speech stays neutral; do not bias it to the target.
  return total !== undefined && ((total >= 0 && total <= 5) || total === repeatedTotal)
    ? "instructional_support"
    : "clarification";
}
