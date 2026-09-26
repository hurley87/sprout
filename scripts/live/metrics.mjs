/**
 * Per-run numbers for the issue #3 comparison: what Jev was asked, how long it
 * took, and how closely the scene and Sprout's speech followed an advance.
 */
export function metrics(log) {
  const evaluations = log
    .filter(e => e.dir === "evaluate")
    .map(e => ({
      utterance: e.request.utterance,
      sceneIndex: e.request.sceneIndex,
      probability: e.answer?.probability ?? null,
      latencyMs: e.at - e.askedAt,
      askedAt: e.askedAt,
    }));
  const scenes = log.filter(e => e.dir === "scene" && e.scene);
  const childSpoke = log.filter(e => e.type === "session.input_transcript.delta");
  const sproutSpoke = log.filter(e => e.type === "session.output_transcript.delta");
  const sproutBetween = (from, to) =>
    sproutSpoke
      .filter(e => e.at > from && e.at <= to)
      .map(e => e.delta)
      .join("")
      .trim();
  const words = text => (text ? text.split(/\s+/).length : 0);
  // The seam: what Sprout said after the child's last word and before the app
  // told it the outcome. More than a brief acknowledgment means Sprout had
  // already started its next move and the app's instruction lands mid-turn.
  const decisions = evaluations.map((e, i) => {
    const spoke = childSpoke.findLast(d => d.at <= e.askedAt);
    const until = evaluations[i + 1]?.askedAt ?? Infinity;
    const told = log.find(
      o =>
        o.dir === "out" &&
        o.at >= e.askedAt &&
        o.at < until &&
        /just changed|has not changed/.test(String(o.content ?? "")),
    );
    const decidedAt = told?.at ?? log.find(r => r.dir === "evaluate" && r.askedAt === e.askedAt)?.at;
    const before = spoke && decidedAt ? sproutBetween(spoke.at, decidedAt) : "";
    const firstWord = spoke && sproutSpoke.find(d => d.at > spoke.at);
    return {
      utterance: e.utterance,
      outcome: told ? (String(told.content).includes("just changed") ? "advanced" : told.type) : "none",
      sproutBeforeDecision: before,
      sproutWordsBeforeDecision: words(before),
      // Last word heard to the first word Sprout says after it: the silence the child hears.
      speechToFirstWordMs: firstWord ? firstWord.at - spoke.at : null,
      speechToInstructionMs: spoke && told ? told.at - spoke.at : null,
    };
  });
  const advances = scenes.slice(1).map(scene => {
    // The evaluation that caused this scene is the last one before it.
    const cause = evaluations.findLast(e => e.askedAt <= scene.at);
    const spoke = cause ? childSpoke.findLast(e => e.at <= cause.askedAt) : undefined;
    const told = log.find(e => e.dir === "out" && e.at >= scene.at && String(e.content ?? "").includes("just changed"));
    return {
      scene: scene.scene,
      probability: cause?.probability ?? null,
      // What the child actually waits: last word heard, through to new pixels.
      speechToSceneMs: spoke ? scene.at - spoke.at : null,
      // The evaluation alone, once the utterance was judged complete.
      decisionToSceneMs: cause ? scene.at - cause.askedAt : null,
      sceneToInstructionMs: told ? told.at - scene.at : null,
    };
  });
  return {
    evaluations,
    decisions,
    advances,
    scenesShown: scenes.map(scene => scene.scene),
    delegationsRefused: log.filter(e => e.type === "session.delegation.created").length,
  };
}
