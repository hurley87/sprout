import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  conversationObserverState,
  conversationStateQuestions,
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
} from "../lib/lesson-runtime/conversation-observer-contract";
import {
  benchmarkDirectory as dir,
  jsonPointer,
  readJson,
  sha256,
  validateBenchmarkCorpus,
  valueHash,
} from "./helpers/classifier-benchmark";

const lessons = [COUNTING_LESSON, CATCHING_UNICORNS_LESSON];
const corpus = readJson(dir + "corpus.json");
validateBenchmarkCorpus(corpus, lessons);
const manifest = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));

describe("frozen classifier benchmark v1 (no provider calls)", () => {
  it("validates the closed draft labels, identities, evidence and split isolation", () => {
    validateBenchmarkCorpus(corpus, lessons);
    expect(corpus.cases).toHaveLength(71);
    expect(corpus.cases.filter(c => c.split === "held_out")).toHaveLength(10);
    expect(corpus.cases.filter(c => c.id.startsWith("oct14-"))).toHaveLength(12);
    expect(manifest.reviewStatus).toBe("draft_agent");
    expect(manifest.providerRunsAllowed).toBe(false);
  });

  it("pins exact files, recovered source blobs and the merged baseline", () => {
    expect(sha256(readFileSync(dir + "manifest.json"))).toBe(readFileSync(dir + "manifest.sha256", "utf8").trim());
    expect(manifest.baselineSha).toBe("fd40c9bc631770ab1220f85767ee2f6cdd56ab9a");
    for (const [path, hash] of Object.entries(manifest.files)) expect(sha256(readFileSync(path))).toBe(hash);
    for (const [path, hash] of Object.entries(manifest.baselineSources)) {
      expect(sha256(execFileSync("git", ["show", `${manifest.baselineSha}:${path}`]))).toBe(hash);
    }
    for (const [path, hash] of Object.entries(manifest.replaySources)) expect(sha256(readFileSync(path))).toBe(hash);
    const old = manifest.historicalCounting;
    expect(sha256(execFileSync("git", ["show", `${old.gitRef}:${old.path}`]))).toBe(old.sha256);
    expect(readJson(dir + "lessons.json")).toEqual(lessons);
    expect(manifest.jev).toEqual({
      model: "jev-1.13.0",
      endpoint: "https://api.typesafe.ai/v1/systemone",
      classifierVersion: CLASSIFIER_VERSION,
      thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      retries: 0,
      fallback: false,
    });
  });

  it("reproduces input, question/source-option and current-node projection hashes without network access", () => {
    const network = vi.fn(() => {
      throw Error("benchmark validation must never call a provider");
    });
    vi.stubGlobal("fetch", network);
    try {
      expect(manifest.cases.map((c: { id: string }) => c.id)).toEqual(corpus.cases.map(c => c.id));
      for (const [index, c] of corpus.cases.entries()) {
        const lesson = lessons.find(l => l.id === c.input.lessonId)!;
        const input = {
          lesson,
          nodeId: c.input.nodeId,
          transcriptRevision: c.input.transcriptRevision,
          transcript: c.input.transcript,
        };
        expect(manifest.cases[index]).toEqual({
          id: c.id,
          inputSha256: valueHash(c.input),
          questionsSha256: valueHash(conversationStateQuestions(lesson, input.nodeId, input.transcript)),
          projectionSha256: valueHash(conversationObserverState(input)),
        });
      }
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves exact repository source pointers and verifies all historical adaptations", () => {
    const old = manifest.historicalCounting;
    const script = execFileSync("git", ["show", `${old.gitRef}:${old.path}`], { encoding: "utf8" });
    const rows = [...script.matchAll(/^  \[(\d), (".*"), (true|false)\],$/gmu)];
    expect(rows).toHaveLength(29); // Issue says 30; do not fabricate the missing entry.
    const historical = corpus.cases.filter(c => c.kind === "historical_adaptation");
    expect(historical).toHaveLength(rows.length);
    for (const [index, c] of historical.entries()) {
      expect(c.source).toMatchObject({ path: old.path, gitRef: old.gitRef, pointer: `CASES/${index}` });
      const original = JSON.parse(rows[index][2]);
      const utterance = index === 25 ? "I have a dinosaur!" : original;
      const question = Number(rows[index][1]) === 2 ? "How many butterflies do you see?" : "How many ducks do you see?";
      expect(c.input.transcript).toBe(`Tutor: ${question}\n${index === 28 ? "Tutor" : "Child"}: ${utterance}`);
      expect(c.historicalObservation).toEqual({
        kind: "legacy_expected_boolean",
        shouldAdvance: rows[index][3] === "true",
      });
    }
    for (const c of corpus.cases.filter(c => c.kind !== "historical_adaptation")) {
      if (c.source.external) {
        expect(
          manifest.externalSources.some(
            (s: { basename: string; sha256: string }) =>
              s.basename === c.source.path && /^[a-f0-9]{64}$/u.test(s.sha256),
          ),
        ).toBe(true);
        expect(c.source.pointer).toMatch(/^\/events\/\d+\/detail\/transcript$/u);
        expect(manifest.externalCaseSources.find((s: { id: string }) => s.id === c.id)).toEqual({
          id: c.id,
          basename: c.source.path,
          pointer: c.source.pointer,
          nodeId: c.input.nodeId,
          transcriptRevision: c.input.transcriptRevision,
          transcriptSha256: sha256(c.input.transcript),
        });
      } else expect(jsonPointer(readJson(c.source.path), c.source.pointer)).toBe(c.input.transcript);
    }
    // Private exports are deliberately not required on another checkout.
    expect(manifest.externalSources).toHaveLength(2);
  });

  it.each([
    [
      "duplicate identity",
      (c: typeof corpus) => {
        c.cases[1].id = c.cases[0].id;
      },
    ],
    [
      "foreign node",
      (c: typeof corpus) => {
        c.cases[0].input.nodeId = "invented";
      },
    ],
    [
      "unsupported label",
      (c: typeof corpus) => {
        (c.cases[0].expected.objective as unknown as { attempt: string }).attempt = "maybe";
      },
    ],
    [
      "claimed human adjudication",
      (c: typeof corpus) => {
        (c.cases[0].expected as unknown as { reviewStatus: string }).reviewStatus = "human_reviewed";
      },
    ],
    [
      "tutor evidence",
      (c: typeof corpus) => {
        c.cases[0].expected.objective.learnerEvidence.messageIndexes = [0];
      },
    ],
    [
      "foreign criterion",
      (c: typeof corpus) => {
        c.cases[0].expected.concepts.foreign = c.cases[0].expected.objective;
      },
    ],
    [
      "same exchange in both splits",
      (c: typeof corpus) => {
        c.cases[1].split = "held_out";
      },
    ],
    [
      "snapshot copy under another group",
      (c: typeof corpus) => {
        const item = structuredClone(c.cases[0]);
        item.id = "leaking-variant";
        item.exchangeGroup = "other";
        item.split = "held_out";
        c.cases.push(item);
      },
    ],
    [
      "invalid revision",
      (c: typeof corpus) => {
        c.cases[0].input.transcriptRevision = -1;
      },
    ],
    [
      "invented synthetic history",
      (c: typeof corpus) => {
        c.cases.find(c => c.kind === "synthetic_control")!.historicalObservation = {
          kind: "normalized_scores_reference",
        };
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const copy = structuredClone(corpus);
    mutate(copy);
    expect(() => validateBenchmarkCorpus(copy, lessons)).toThrow();
  });

  it("detects input tampering and missing source pointers", () => {
    const input = { ...corpus.cases[0].input, transcript: "Child: A changed answer." };
    expect(valueHash(input)).not.toBe(manifest.cases[0].inputSha256);
    expect(() => jsonPointer({ cases: [] }, "/cases/999/transcript")).toThrow();
  });
});
