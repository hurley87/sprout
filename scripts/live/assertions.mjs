// Intention matching tolerates casing, spacing, and simple terminal punctuation only.
const normalizeUtterance = text =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "")
    .trim();

/** Assertions inspect retained structured events, never tutor wording.
 * Pass `after` (or an action) and optionally `through` to bound evidence.
 * Negative and exactly-once assertions are observations through that boundary,
 * not promises about future events. Await evaluation/tutor response first.
 */
export function createScenarioAssertions(observer) {
  const cursor = value => (typeof value === "number" ? value : (value?.checkpointBefore ?? value?.cursor));
  async function window(options) {
    const snapshot = await observer.snapshot();
    const after = cursor(options.after);
    const through = options.through ?? snapshot.cursor;
    if (
      !Number.isInteger(after) ||
      after < 0 ||
      !Number.isInteger(through) ||
      through < after ||
      through > snapshot.cursor
    )
      throw new Error(`Invalid assertion window: ${JSON.stringify({ after, through, cursor: snapshot.cursor })}`);
    return { snapshot, events: snapshot.events.filter(e => e.cursor > after && e.cursor <= through), after, through };
  }
  function fail(message, options, evidence) {
    throw new Error(`${message}; evidence: ${JSON.stringify({ action: options.after, ...evidence })}`);
  }
  async function advanced(options, exactlyOnce) {
    const evidence = await window(options);
    const advances = evidence.events.filter(e => e.kind === "scene" && e.from !== null && e.to !== null);
    const matches = advances.filter(e => e.from === options.from && (options.to === undefined || e.to === options.to));
    if (!matches.length || (exactlyOnce && advances.length !== 1))
      fail(
        `Expected scene advance ${options.from} -> ${options.to ?? "next scene"}${exactlyOnce ? " exactly once" : ""}, observed ${advances.length} advances`,
        options,
        evidence,
      );
    return matches[0];
  }
  return {
    async sceneStayed(options) {
      const evidence = await window(options);
      const scene = options.scene ?? options.after?.scene;
      const initial = evidence.snapshot.events.filter(e => e.kind === "scene" && e.cursor <= evidence.after).at(-1)?.to;
      const changes = evidence.events.filter(e => e.kind === "scene");
      if (!scene || initial !== scene || changes.length)
        fail(`Expected scene to remain "${scene}", observed "${changes.at(-1)?.to ?? initial}"`, options, evidence);
      return evidence;
    },
    sceneAdvanced: options => advanced(options, false),
    sceneAdvancedExactlyOnce: options => advanced(options, true),
    async evaluated(options) {
      const evidence = await window(options);
      const utterance = options.utterance ?? options.after?.text;
      const sceneIndex = options.sceneIndex ?? options.after?.sceneIndex;
      const match = evidence.events.find(
        e =>
          e.kind === "evaluation" &&
          (utterance === undefined ||
            (options.exactUtterance
              ? e.utterance === utterance
              : normalizeUtterance(e.utterance) === normalizeUtterance(utterance))) &&
          (sceneIndex === undefined || e.sceneIndex === sceneIndex) &&
          (options.result === undefined ||
            Object.entries(options.result).every(([key, value]) => e.result?.[key] === value)),
      );
      if (!match)
        fail(
          `Expected evaluation of ${JSON.stringify({ utterance, exactUtterance: options.exactUtterance ?? false, sceneIndex, result: options.result })}`,
          options,
          evidence,
        );
      return match;
    },
    async sessionEnded(options) {
      const evidence = await window(options);
      const match = evidence.events.find(e => e.kind === "session-end");
      if (!match) fail("Expected session to end", options, evidence);
      return match;
    },
    async sproutRespondedAfter(checkpoint, options = {}) {
      const after = cursor(checkpoint);
      // A turn must START after the evaluation/action boundary, not merely finish after it.
      const start = await observer.waitForSproutTurnStart({ ...options, after });
      return observer.waitForSproutTurnEnd({ ...options, after: start.cursor });
    },
  };
}
