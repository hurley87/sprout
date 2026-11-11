/**
 * Garden Rescue session export (#107).
 *
 * Built only when the parent requests a download: the existing `LessonRuntime.report()` plus a
 * `game` block holding the run's Garden game events, the `garden-evidence/v1` summary and
 * provenance. Nothing here runs during gameplay, calls a model or waits on the network.
 *
 * The export is redacted before it leaves the page: credential-like keys are removed, and raw
 * audio (binary buffers, data URLs, long base64 runs) is replaced by a marker. Each removal is
 * listed in `game.provenance.redactions` so a reader can tell redaction from absence.
 */
import { CLASSIFIER_VERSION } from "../lesson-runtime/conversation-observer-contract";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../lesson-runtime/garden-rescue-lesson";
import type { LessonDefinition } from "../lesson-runtime/lesson-definition";
import type { LessonRuntime } from "../lesson-runtime/lesson-runtime";
import { GARDEN_EVIDENCE_SCHEMA, summarizeGardenSession, type GardenEvidenceSummary } from "./evidence-summary";
import type { GardenGameEvent } from "./game-state";

export const GARDEN_EXPORT_SCHEMA = "garden-export/v1" as const;
export const GARDEN_EXPORT_PREFIX = "sprout-garden";

/** Canonical JSON: object keys sorted at every depth, so equal definitions serialize equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item ?? null)).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** 64-bit FNV-1a over the UTF-8 bytes: deterministic and dependency-free; not a security hash. */
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");
function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Authored lesson revision: a content hash of the whole definition, so any authored change
 * (brief, quantity, scene version, support limit, tutor or classifier copy) changes it. */
export function gardenLessonRevision(lesson: LessonDefinition = GARDEN_RESCUE_LESSON): string {
  return `fnv1a64:${fnv1a64(canonicalJson(lesson))}`;
}

/** Credential-like keys. A superset of the shared download scrub, so every removal is recorded. */
const CREDENTIAL_KEY =
  /secret|credential|password|passphrase|bearer|authorization|cookie|api.?key|private.?key|access.?token|refresh.?token|id.?token|session.?token|ephemeral|sdp|raw.?body|provider.?body/iu;
const DATA_URL = /^\s*data:[^,]*,/iu;
const BASE64_RUN = /^[A-Za-z0-9+/_-]+={0,2}$/u;
const LONG_STRING = 512;
const CREDENTIAL_VALUE = /\bBearer\s+\S{8,}|\b(?:sk|ek|rk)-[A-Za-z0-9_-]{16,}|\bek_[A-Za-z0-9]{16,}/u;

export type GardenRedaction = {
  readonly path: string;
  readonly reason: "credential_key" | "credential_value" | "audio";
};

/** Strip credentials and raw audio from a JSON-like value; returns a copy and what was removed. */
export function redactExport(value: unknown): { value: unknown; redactions: GardenRedaction[] } {
  const redactions: GardenRedaction[] = [];
  const visit = (node: unknown, path: string): unknown => {
    if (typeof node === "string") {
      if (DATA_URL.test(node) || (node.length > LONG_STRING && BASE64_RUN.test(node.replace(/[\r\n]+/gu, "")))) {
        redactions.push({ path, reason: "audio" });
        return "[redacted]";
      }
      if (CREDENTIAL_VALUE.test(node)) {
        redactions.push({ path, reason: "credential_value" });
        return "[redacted]";
      }
      return node;
    }
    if (typeof node !== "object" || node === null) return node;
    if (
      ArrayBuffer.isView(node) ||
      node instanceof ArrayBuffer ||
      (typeof Blob !== "undefined" && node instanceof Blob)
    ) {
      redactions.push({ path, reason: "audio" });
      return "[redacted]";
    }
    if (Array.isArray(node)) return node.map((item, index) => visit(item, `${path}[${index}]`));
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, nested]) => {
        const at = `${path}.${key}`;
        if (CREDENTIAL_KEY.test(key)) {
          redactions.push({ path: at, reason: "credential_key" });
          return [];
        }
        return [[key, visit(nested, at)]];
      }),
    );
  };
  return { value: visit(value, "$"), redactions };
}

type RuntimeReport = ReturnType<LessonRuntime["report"]>;
export type GardenExportProvenance = {
  readonly schema: typeof GARDEN_EXPORT_SCHEMA;
  readonly summarySchema: typeof GARDEN_EVIDENCE_SCHEMA;
  readonly lessonId: string;
  readonly lessonRevision: string;
  readonly sceneVersions: Readonly<Record<string, string>>;
  readonly classifierVersion: string;
  readonly runId: string;
  readonly exportedAt: string;
  /** No build or commit identity is exposed to the client yet. */
  readonly build: "unknown";
  readonly redactions: readonly GardenRedaction[];
};
export type GardenExport = RuntimeReport & {
  readonly game: {
    readonly events: readonly GardenGameEvent[];
    readonly summary: GardenEvidenceSummary;
    readonly provenance: GardenExportProvenance;
  };
};

/** Assemble the download. Call at export time only; the summary is computed here, from the full
 * journal in `report.events`, never from the capped snapshot diagnostics. */
export function buildGardenExport({
  report,
  gameEvents,
  exportedAt = new Date(),
}: {
  report: RuntimeReport;
  gameEvents: readonly GardenGameEvent[];
  exportedAt?: Date;
}): GardenExport {
  const runId = report.runtimeId;
  // The page log restarts with each run; filtering keeps a stale log from leaking across runs.
  const events = gameEvents.filter(event => event.runId === runId);
  const summary = summarizeGardenSession({ report, gameEvents: events });
  const provenance: Omit<GardenExportProvenance, "redactions"> = {
    schema: GARDEN_EXPORT_SCHEMA,
    summarySchema: GARDEN_EVIDENCE_SCHEMA,
    lessonId: GARDEN_RESCUE_LESSON.id,
    lessonRevision: gardenLessonRevision(),
    sceneVersions: Object.fromEntries(
      GARDEN_RESCUE_NODE_IDS.map(id => [id, String(GARDEN_RESCUE_LESSON.nodes[id].presentation.sceneVersion)]),
    ),
    classifierVersion: CLASSIFIER_VERSION,
    runId,
    exportedAt: exportedAt.toISOString(),
    build: "unknown",
  };
  const { value, redactions } = redactExport({ ...report, game: { events, summary, provenance } });
  const redacted = value as GardenExport;
  return { ...redacted, game: { ...redacted.game, provenance: { ...redacted.game.provenance, redactions } } };
}
