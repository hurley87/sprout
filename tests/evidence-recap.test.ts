import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { evidenceRecap } from "../lib/lesson-runtime/evidence-recap";
import type { ConceptEvidenceRecord } from "../lib/lesson-runtime/lesson-runtime-reducer";

const record = (
  criterionId: string,
  status: ConceptEvidenceRecord["status"],
  understanding: ConceptEvidenceRecord["understanding"],
): ConceptEvidenceRecord => ({ criterionId, status, understanding, source: null, promptingHistory: [] });
it("keeps every attribution distinct in at most four brief sentences without quoting learner instructions", () => {
  const text = evidenceRecap(lesson, {
    conceptEvidence: {
      "engram:engram-biological": record("engram-biological", "demonstrated", "independent"),
      "exogram:exogram-non-biological": record("exogram-non-biological", "demonstrated", "prompted"),
      "compare:exogram-durability": record("exogram-durability", "demonstrated", null),
      "compare:exogram-shareability": record("exogram-shareability", "partial", null),
    },
  });
  expect(text).toBe(
    "You independently explained engrams. After a prompt, you explained exograms; you explained durability, with prompting unclear. Partly explained: sharing; unresolved or skipped: revision, visual symbols, shared meanings, examples beyond prose, and abstract ideas. Thanks for the discussion.",
  );
  expect(text.split(/\s+/).length).toBeLessThan(55);
});
it("deduplicates carried evidence and does not upgrade an uncertain original attribution", () => {
  const text = evidenceRecap(lesson, {
    conceptEvidence: {
      "engram:engram-biological": record("engram-biological", "demonstrated", null),
      "exogram:engram-biological": record("engram-biological", "demonstrated", "independent"),
      "compare:engram-biological": record("engram-biological", "partial", null),
    },
  });
  expect(text.match(/engrams/g)).toHaveLength(1);
  expect(text).toContain("You explained engrams, with prompting unclear.");
  expect(text).not.toContain("independently");
});
it("never invents mastery for an entirely skipped or unavailable-evidence session", () => {
  expect(evidenceRecap(lesson, null)).toBe(
    "Unresolved or skipped: engrams, exograms, durability, sharing, revision, visual symbols, shared meanings, examples beyond prose, and abstract ideas. Thanks for the discussion.",
  );
});
it("covers exactly the retained criteria and keeps a full-success close brief", () => {
  const entries = Object.values(lesson.nodes).flatMap(node =>
    (node.concepts ?? []).map(concept => [
      `${node.id}:${concept.id}`,
      record(concept.id, "demonstrated", "independent"),
    ]),
  );
  const ids = new Set(Object.values(lesson.nodes).flatMap(node => (node.concepts ?? []).map(c => c.id)));
  expect(Object.keys(lesson.recapTopics!).sort()).toEqual([...ids].sort());
  const text = evidenceRecap(lesson, { conceptEvidence: Object.fromEntries(entries) });
  expect(text).not.toMatch(/unresolved|partial|prompting/);
  expect(text.split(/\s+/).length).toBeLessThan(55);
});
