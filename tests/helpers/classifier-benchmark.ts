import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { LessonDefinition } from "../../lib/lesson-runtime/lesson-definition";
import { transcriptMessages, substantiveLearnerText } from "../../lib/lesson-runtime/tutor-observation";

export type OutcomeLabel = {
  demonstration: "demonstrated" | "no_demonstration";
  attempt: "complete" | "partial" | "not_attempted";
  attribution: "independent" | "prompted" | "unresolved" | "not_applicable";
  tutorConfirmation: "yes" | "no" | "unresolved" | "not_applicable";
  learnerEvidence: { validity: "valid" | "none" | "unresolved"; messageIndexes: number[] };
  rationale: string;
};
export type BenchmarkCase = {
  id: string;
  exchangeGroup: string;
  split: "calibration" | "held_out";
  kind: "historical_adaptation" | "recorded_excerpt" | "synthetic_control";
  source: { path: string; pointer: string; gitRef?: string; adaptation?: string; external?: boolean };
  input: { lessonId: string; nodeId: string; transcriptRevision: number; transcript: string };
  revisionOrigin: "recorded" | "benchmark_assigned";
  expected: { reviewStatus: "draft_agent"; objective: OutcomeLabel; concepts: Record<string, OutcomeLabel> };
  historicalObservation: null | Record<string, unknown>;
};
export const benchmarkDirectory = "tests/fixtures/classifier-benchmark-v1/";
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const valueHash = (value: unknown) => sha256(JSON.stringify(value));
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function object(value: unknown): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "expected object");
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  assert(
    required.every(key => Object.hasOwn(value, key)),
    "missing field",
  );
  assert(
    Object.keys(value).every(key => [...required, ...optional].includes(key)),
    "unexpected field",
  );
}
function text(value: unknown): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0, "expected nonempty text");
}
function oneOf(value: unknown, choices: string[]) {
  assert(typeof value === "string" && choices.includes(value), "invalid label");
}
function validateLabel(value: unknown, transcript: string, isConcept: boolean) {
  object(value);
  keys(value, ["demonstration", "attempt", "attribution", "tutorConfirmation", "learnerEvidence", "rationale"]);
  oneOf(value.demonstration, ["demonstrated", "no_demonstration"]);
  oneOf(value.attempt, ["complete", "partial", "not_attempted"]);
  oneOf(value.attribution, ["independent", "prompted", "unresolved", "not_applicable"]);
  oneOf(value.tutorConfirmation, isConcept ? ["not_applicable"] : ["yes", "no", "unresolved"]);
  text(value.rationale);
  object(value.learnerEvidence);
  keys(value.learnerEvidence, ["validity", "messageIndexes"]);
  oneOf(value.learnerEvidence.validity, ["valid", "none", "unresolved"]);
  const indexes = value.learnerEvidence.messageIndexes;
  assert(Array.isArray(indexes) && new Set(indexes).size === indexes.length, "invalid evidence indexes");
  const messages = transcriptMessages(transcript)!;
  for (const index of indexes) {
    assert(Number.isSafeInteger(index) && index >= 0, "invalid evidence index");
    assert(
      messages[index]?.speaker === "Child" && substantiveLearnerText(messages[index].text),
      "evidence must be substantive learner text",
    );
  }
  assert(
    value.learnerEvidence.validity === "none" ? indexes.length === 0 : indexes.length > 0,
    "evidence validity/index mismatch",
  );
  if (value.demonstration === "demonstrated") {
    assert(
      value.attempt === "complete" && value.attribution !== "not_applicable" && indexes.length > 0,
      "demonstration requires evidence and attribution review",
    );
  } else assert(value.attribution === "not_applicable", "no demonstration cannot assert prompting attribution");
  if (value.attempt === "not_attempted")
    assert(value.demonstration === "no_demonstration" && indexes.length === 0, "not attempted has no task evidence");
}

/** Closed draft corpus schema, intentionally distinct from a runtime state proposal. */
export function validateBenchmarkCorpus(
  value: unknown,
  lessons: readonly LessonDefinition[],
): asserts value is { version: 1; cases: BenchmarkCase[] } {
  object(value);
  keys(value, ["version", "cases"]);
  assert(value.version === 1 && Array.isArray(value.cases) && value.cases.length > 0, "invalid corpus version/cases");
  const ids = new Set<string>();
  const groups = new Map<string, string>();
  for (const item of value.cases) {
    object(item);
    keys(item, [
      "id",
      "exchangeGroup",
      "split",
      "kind",
      "source",
      "input",
      "revisionOrigin",
      "expected",
      "historicalObservation",
    ]);
    text(item.id);
    text(item.exchangeGroup);
    assert(/^[a-z0-9-]+$/u.test(item.id) && !ids.has(item.id), "duplicate/invalid case identity");
    ids.add(item.id);
    oneOf(item.split, ["calibration", "held_out"]);
    assert(
      !groups.has(item.exchangeGroup) || groups.get(item.exchangeGroup) === item.split,
      "exchange leaks across splits",
    );
    groups.set(item.exchangeGroup, item.split as string);
    oneOf(item.kind, ["historical_adaptation", "recorded_excerpt", "synthetic_control"]);
    object(item.source);
    keys(item.source, ["path", "pointer"], ["gitRef", "adaptation", "external"]);
    text(item.source.path);
    text(item.source.pointer);
    assert(!item.source.path.startsWith("/") && !item.source.path.split("/").includes(".."), "unsafe source path");
    if (item.source.gitRef !== undefined)
      assert(
        typeof item.source.gitRef === "string" && /^[a-f0-9]{40}$/u.test(item.source.gitRef),
        "invalid Git source identity",
      );
    if (item.source.external !== undefined) assert(item.source.external === true, "invalid external source");
    if (item.source.adaptation !== undefined) text(item.source.adaptation);
    object(item.input);
    keys(item.input, ["lessonId", "nodeId", "transcriptRevision", "transcript"]);
    text(item.input.lessonId);
    text(item.input.nodeId);
    text(item.input.transcript);
    assert(
      Number.isSafeInteger(item.input.transcriptRevision) && (item.input.transcriptRevision as number) >= 0,
      "invalid revision",
    );
    oneOf(item.revisionOrigin, ["recorded", "benchmark_assigned"]);
    const lessonId = item.input.lessonId;
    const lesson = lessons.find(lesson => lesson.id === lessonId);
    assert(lesson && Object.hasOwn(lesson.nodes, item.input.nodeId), "unknown lesson/node identity");
    assert(transcriptMessages(item.input.transcript), "invalid speaker-labelled input");
    object(item.expected);
    keys(item.expected, ["reviewStatus", "objective", "concepts"]);
    assert(item.expected.reviewStatus === "draft_agent", "v1 has no human adjudication");
    validateLabel(item.expected.objective, item.input.transcript, false);
    object(item.expected.concepts);
    const criterionIds = (lesson.nodes[item.input.nodeId].concepts ?? []).map(c => c.id).sort();
    assert.deepEqual(Object.keys(item.expected.concepts).sort(), criterionIds, "missing/foreign criterion labels");
    for (const label of Object.values(item.expected.concepts)) validateLabel(label, item.input.transcript, true);
    if (item.historicalObservation !== null) {
      object(item.historicalObservation);
      oneOf(item.historicalObservation.kind, [
        "legacy_expected_boolean",
        "legacy_normalized_mapping_reference",
        "normalized_scores_reference",
        "diagnostic_request_reference",
      ]);
    }
    if (item.kind === "synthetic_control")
      assert(item.historicalObservation === null, "synthetic expectations are not recorded results");
  }
  // Detect exact snapshots and prefix variants leaking even if assigned different group names.
  const cases = value.cases as BenchmarkCase[];
  for (let i = 0; i < cases.length; i++)
    for (const b of cases.slice(i + 1)) {
      const a = cases[i];
      if (a.input.lessonId !== b.input.lessonId || a.input.nodeId !== b.input.nodeId || a.split === b.split) continue;
      const x = a.input.transcript.trim();
      const y = b.input.transcript.trim();
      assert(!(x === y || x.startsWith(`${y}\n`) || y.startsWith(`${x}\n`)), "snapshot variant leaks across splits");
    }
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  assert(pointer.startsWith("/"), "invalid JSON pointer");
  return pointer
    .slice(1)
    .split("/")
    .reduce<unknown>((current, token) => {
      assert(current !== null && typeof current === "object", "missing source pointer");
      const key = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
      assert(Object.hasOwn(current, key), "missing source pointer");
      return (current as Record<string, unknown>)[key];
    }, value);
}
