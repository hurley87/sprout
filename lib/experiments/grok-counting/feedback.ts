/** Deterministic vetoes only: no positive acknowledgment or correctness classifier. */
export function feedbackProblem(
  text: string,
  scene: { readonly quantity?: unknown; readonly object?: unknown },
): "missing-feedback" | "contradictory-feedback" | undefined {
  const spoken = text
    .replace(/\[[^\]]*(?:\]|$)/gu, " ")
    .replace(/’/gu, "'")
    .trim()
    .toLowerCase();
  if (!/[\p{L}\p{N}]/u.test(spoken)) return "missing-feedback";
  if (/\b(?:wrong|incorrect|not (?:right|correct)|try again|count (?:them )?again)\b/u.test(spoken))
    return "contradictory-feedback";
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const number = "(zero|one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)";
  const quantity = (value: string) => (/^\d+$/.test(value) ? Number(value) : words.indexOf(value));
  // Explicit numbered sets, and direct total statements even without an object.
  for (const match of spoken.matchAll(new RegExp(`\\b${number} (ducks?|butterfl(?:y|ies))\\b`, "gu"))) {
    const object = match[2].startsWith("duck") ? "duck" : "butterfly";
    const before = spoken.slice(0, match.index);
    const after = spoken.slice(match.index! + match[0].length);
    // Negating the expected set is still a contradiction, despite matching its count.
    if (/\b(?:not|isn't|aren't)\s+$/u.test(before)) return "contradictory-feedback";
    // A bounded individual-object step is not a declaration of a different total.
    const individualStep =
      Number(scene.quantity) > 1 &&
      quantity(match[1]) === 1 &&
      object === scene.object &&
      /\byou (?:saw|counted) $/u.test(before) &&
      /^,? (?:and )?then another(?=[.!?]|$)/u.test(after);
    if (!individualStep && (quantity(match[1]) !== Number(scene.quantity) || object !== scene.object))
      return "contradictory-feedback";
  }
  const stated = new RegExp(
    `(?:\\b(?:there (?:is|are)|the (?:answer|total|count) is|actually)[, :]+|^)${number}(?=\\b)`,
    "gu",
  );
  for (const match of spoken.matchAll(stated)) {
    if (quantity(match[1]) !== Number(scene.quantity)) return "contradictory-feedback";
  }
  if (/^[^.!?]*\?$/u.test(spoken)) return "missing-feedback";
  return undefined;
}
