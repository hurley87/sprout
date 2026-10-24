export type MathOperation = "differentiate" | "rewrite" | "unassessed";
const commands: Record<string, MathOperation> = {
  "confirm differentiation": "differentiate",
  "confirm rewrite": "rewrite",
  "confirm without checking": "unassessed",
};
/** Closed grammar: one command, or numbered actions separated by semicolons.
 * No quote stripping or substring matching: reported/negated speech cannot accept.
 */
export function parseSpokenMathConfirmation(text: string, count: number): MathOperation[] | null {
  if (text.length > 600 || count < 1 || count > 8) return null;
  const normalized = text.trim().toLowerCase().replace(/\.$/, "").trim();
  if (count === 1 && Object.hasOwn(commands, normalized)) return [commands[normalized]];
  const parts = normalized.split(";").map(part => part.trim());
  if (parts.length !== count) return null;
  const operations: MathOperation[] = [];
  for (const [index, part] of parts.entries()) {
    const prefix = `action ${index + 1} `;
    const command = part.slice(prefix.length);
    const operation = part.startsWith(prefix) && Object.hasOwn(commands, command) ? commands[command] : undefined;
    if (!operation) return null;
    operations.push(operation);
  }
  return operations;
}

/** Only a possible prefix may retain the reservation while the turn is open. */
export function isSpokenMathConfirmationPrefix(text: string, count: number): boolean {
  if (text.length > 600 || count < 1 || count > 8) return false;
  const normalized = text.trim().toLowerCase();
  if (count === 1)
    return Object.keys(commands)
      .flatMap(command => [command, `action 1 ${command}`])
      .some(command => command.startsWith(normalized) || `${command}.`.startsWith(normalized));
  const parts = normalized.split(";");
  if (parts.length > count) return false;
  return parts.every((part, index) => {
    const value = part.trimStart();
    const choices = Object.keys(commands).map(command => `action ${index + 1} ${command}`);
    return index === parts.length - 1
      ? choices.some(command => command.startsWith(value) || (index === count - 1 && `${command}.`.startsWith(value)))
      : choices.includes(value.trimEnd());
  });
}
