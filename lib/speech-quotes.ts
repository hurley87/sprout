const FILLERS = new Set(["uh", "um"]);
const words = (text: string) =>
  ` ${text
    .replace(/\[[^\]]*(\]|$)/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word && !FILLERS.has(word))
    .join(" ")} `;

export function speechMatcher(turns: readonly { readonly text: string }[], limit: number) {
  const speech = turns
    .map(turn => words(turn.text))
    .join("")
    .replace(/ +/g, " ");
  return (quote: unknown): quote is string =>
    typeof quote === "string" &&
    quote.trim().length > 0 &&
    quote.length <= limit &&
    (turns.some(turn => turn.text.toLowerCase().includes(quote.toLowerCase())) ||
      (words(quote).trim().length > 0 && speech.includes(words(quote))));
}
