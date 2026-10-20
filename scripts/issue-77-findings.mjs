// Offline extraction only: never opens paths named inside source provenance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("docs/issue-77-findings.json", root);
const paths = [
  "docs/issue-57-final-node-review-set.json",
  "docs/issue-57-clarification-review-set.json",
  "tests/fixtures/butterfly-filler-confirmation.json",
  "tests/fixtures/issue-57-fragmented-confirmation.json",
  "tests/fixtures/catching-unicorns-source-boundaries-oct16.json",
  "tests/fixtures/catching-unicorns-closure-oct16.json",
  "tests/fixtures/catching-unicorns-exogram-confirmation-replay.json",
  "tests/fixtures/catching-unicorns-attribution-oct17.json",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = paths.map(path => {
  const bytes = readFileSync(new URL(path, root));
  return { path, sha256: sha256(bytes), data: JSON.parse(bytes) };
});
const [finalNode, clarification, butterfly, fragmented, boundaries, closure] = inputs.map(x => x.data);
const round = value => Math.round(value * 10) / 10;
const transcript = item => item.transcript ?? item.input.transcript;
const childText = item =>
  transcript(item)
    .split("\n")
    .filter(line => line.startsWith("Child:"))
    .join("\n");
const requestRows = set =>
  set.recorded.map(item => ({
    id: item.id,
    requestEventIndex: item.requestEventIndex,
    mappingEventIndex: item.mappingEventIndex,
    identity: item.identity,
    requestAtMs: round(item.requestAtMs),
    mappingAtMs: round(item.mappingAtMs),
    requestToMappingMs: round(item.mappingAtMs - item.requestAtMs),
    mapping: item.observedMapping,
  }));
const pair = (set, beforeId, afterId) => {
  const before = set.recorded.find(item => item.id === beforeId);
  const after = set.recorded.find(item => item.id === afterId);
  assert(before && after);
  assert.equal(before.identity.runtimeId, after.identity.runtimeId);
  assert.equal(before.identity.visitId, after.identity.visitId);
  assert.equal(childText(before), childText(after));
  assert(transcript(after).startsWith(transcript(before)));
  return {
    before: beforeId,
    after: afterId,
    sameChildTurn: before.identity.childTurnId === after.identity.childTurnId,
    identicalTranscript: transcript(before) === transcript(after),
    appendedText: transcript(after).slice(transcript(before).length),
    // Endpoint/browser elapsed and actual playback stages are not in these sets.
    requestToMappingMs: [before, after].map(item => round(item.mappingAtMs - item.requestAtMs)),
  };
};
const eventPoint = (events, predicate) => {
  const index = events.findIndex(predicate);
  assert(index >= 0);
  return { index, atMs: round(events[index].atMs) };
};
const bEvents = butterfly.steps.map(step => step.event).filter(Boolean);
const bMapping = butterfly.steps.find(step => step.mapping).mapping;
const quiet = closure.recordedReducerEvents.findLast(
  event => event.type === "output.activity" && event.state === "quiet",
);
const proposal = closure.recordedReducerEvents.findLast(event => event.type === "proposal.received");
assert(quiet && proposal);
const before = boundaries.checkpoints[2];
const after = boundaries.checkpoints[3];
assert.equal(childText(before), childText(after));
assert.equal(before.transcriptRevision, 34);
assert.equal(after.transcriptRevision, 50);
const report = {
  scope:
    "Selected sanitized segments/checkpoints; not full-session request totals, ground truth, or fresh model performance.",
  sources: inputs.map(({ path, sha256, data }) => ({
    path,
    sha256,
    provenance: data.provenance ?? data.source ?? data.recording,
    note: data.note ?? data.description ?? null,
    provenanceAnnotation: data.provenanceAnnotation ?? null,
  })),
  counting: [finalNode, clarification].map(set => ({
    runtimeId: set.source.runtimeId,
    savedRequestCount: set.recorded.length,
    requestToMappingRangeMs: {
      min: round(Math.min(...set.recorded.map(item => item.mappingAtMs - item.requestAtMs))),
      max: round(Math.max(...set.recorded.map(item => item.mappingAtMs - item.requestAtMs))),
    },
    excludedSyntheticCount: set.synthetic.length,
    savedMappingCounts: set.recorded.reduce((counts, item) => {
      counts[item.observedMapping.decision] = (counts[item.observedMapping.decision] ?? 0) + 1;
      return counts;
    }, {}),
    requests: requestRows(set),
  })),
  selectedPairs: [
    pair(finalNode, "wrong-one-duck-before-retry", "wrong-one-duck-after-hint"),
    pair(finalNode, "finished-butterfly-count", "same-count-after-discard"),
    pair(finalNode, "follow-up-before-tutor-response", "follow-up-after-tutor-response"),
    pair(clarification, "before-clarification", "after-question"),
    pair(clarification, "child-reaffirmation", "generic-thanks"),
  ],
  catchingUnicorns: {
    savedCheckpointCount: boundaries.checkpoints.length,
    exactDuplicateInputs: boundaries.checkpoints.flatMap((item, index, all) =>
      index > 0 &&
      item.nodeId === all[index - 1].nodeId &&
      item.transcriptRevision === all[index - 1].transcriptRevision &&
      item.transcript === all[index - 1].transcript
        ? [[index - 1, index]]
        : [],
    ),
    exogramTutorExtension: {
      indexes: [2, 3],
      revisions: [before.transcriptRevision, after.transcriptRevision],
      unchangedChildText: childText(before),
      appendedText: transcript(after).slice(transcript(before).length),
      objectiveCompleted: [before, after].map(x => x.outputs.objectiveState.probabilities.completed),
      independent: [before, after].map(
        x => x.outputs.concepts["concept_exogram-non-biological"].probabilities.demonstrated_independent,
      ),
    },
    closureTiming: {
      sampleCount: 1,
      lastRecordedChildSpeechStop: eventPoint(
        closure.recordedReducerEvents,
        e => e === closure.recordedReducerEvents.findLast(x => x.type === "child.turn.ended"),
      ),
      lastQuietAtMs: round(quiet.atMs),
      proposalAtMs: round(proposal.atMs),
      recordedRenderRequestedAtMs: closure.recordedRenderRequestedAtMs,
      recordedRenderConfirmedAtMs: closure.recordedRenderConfirmedAtMs,
      quietToRenderRequestMs: round(closure.recordedRenderRequestedAtMs - quiet.atMs),
      proposalToRenderRequestMs: round(closure.recordedRenderRequestedAtMs - proposal.atMs),
      requestToConfirmationMs: round(closure.recordedRenderConfirmedAtMs - closure.recordedRenderRequestedAtMs),
      savedClassifierLatencyMs: closure.classifierLatencyMs,
      classifierLatencyStage: "Fixture metadata; browser versus endpoint attribution not established here.",
    },
  },
  butterfly: {
    runtimeId: butterfly.provenance.runtimeId,
    savedMappingCount: butterfly.steps.filter(step => step.mapping).length,
    initialAnswerAccepted: butterfly.initialState.answerAccepted,
    finalAnswerAccepted: butterfly.expectedState.answerAccepted,
    mappingReason: bMapping.reason,
    savedEndpointMappingElapsedMs: round(bMapping.elapsedMs),
    childSpeechStop: eventPoint(bEvents, e => e.type === "child.turn.ended"),
    lastAnswerTextReceipt: eventPoint(bEvents, e => e.type === "transcript.updated" && e.revision === 50),
    firstPcmActive: eventPoint(bEvents, e => e.type === "output.activity" && e.state === "active"),
    answerReceiptToPcmActiveMs: round(
      bEvents.find(e => e.type === "output.activity" && e.state === "active").atMs -
        bEvents.find(e => e.type === "transcript.updated" && e.revision === 50).atMs,
    ),
    answerProviderInterval: butterfly.incoming.find(
      x => x.event.delta === " butterflies." && x.event.speaker === "child",
    ).event,
  },
  fragmentedConfirmation: {
    source: fragmented.source,
    mappingEventIndex: fragmented.mappingEventIndex,
    legacy: fragmented.historicalLegacy,
    interpretation: fragmented.humanInterpretation,
  },
  unknown: [
    "full-session/per-turn request totals",
    "unnecessary recheck rate",
    "valid-answer loss rate",
    "correctness/false advancement/false mastery rates",
    "counting fine-grained independence",
    "response ID/completion/heard",
    "answer-end to audible feedback/confirmed scene distribution",
    "causal context contamination",
  ],
};
assert.deepEqual(
  report.counting.map(x => x.savedRequestCount),
  [9, 4],
);
assert.equal(report.butterfly.savedMappingCount, 1);
assert.equal(report.catchingUnicorns.closureTiming.requestToConfirmationMs, 33.5);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.length === 3 && process.argv[2] === "--write") {
  writeFileSync(output, serialized);
  console.log(`Wrote ${fileURLToPath(output)}`);
} else {
  assert.equal(process.argv.length, 2, "Usage: node scripts/issue-77-findings.mjs [--write]");
  assert.equal(
    readFileSync(output, "utf8"),
    serialized,
    "Findings/hash drift: review inputs before regenerating with --write",
  );
  console.log("Issue 77 findings: all source hashes, extracted claims and checked-in output match.");
}
