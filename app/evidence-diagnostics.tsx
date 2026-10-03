"use client";

import { useEffect, useRef, useState } from "react";
import type { ObserverDiagnosticRow } from "../lib/observer-diagnostics";
import {
  DIAGNOSTIC_PAGE_SIZE,
  validDiagnosticPage,
  type DiagnosticAttempt,
  type DiagnosticHistory,
  type DiagnosticPage,
  type DiagnosticRequest,
} from "../lib/parent-review-diagnostics";
import {
  diagnosticPlaybackAnchor,
  diagnosticSource,
  diagnosticSpeechScenes,
  type CanonicalReviewEvent,
} from "../lib/diagnostic-source";
import type { InspectableSessionRecord } from "../lib/session-recorder";
import { EvidenceDetail } from "./evidence-detail";
import { TimelineDetail } from "./timeline-detail";

const label = (x: string) => x.replaceAll("_", " ");
type SourceProps = { record?: InspectableSessionRecord; seek: (atMs: number) => void };

function EventDetail({
  event,
  seek,
  hasRecording,
}: {
  event: CanonicalReviewEvent;
  seek: SourceProps["seek"];
  hasRecording: boolean;
}) {
  const anchor = diagnosticPlaybackAnchor(event);
  return (
    <div>
      <p>
        Canonical ID {event.id} · Event key {event.eventKey} · {event.atMs} ms from session start
      </p>
      {event.evidence && <EvidenceDetail evidence={event.evidence} />}
      {event.timeline && <TimelineDetail event={event.timeline} />}
      {hasRecording && (
        <button className="download-button" onClick={() => seek(anchor.atMs)}>
          {anchor.label}
        </button>
      )}
    </div>
  );
}

function ResponseSource({
  eventId,
  row,
  record,
  seek,
}: SourceProps & {
  eventId: string;
  row?: Extract<ObserverDiagnosticRow, { kind: "response" }>;
}) {
  const response = diagnosticSource(record, eventId);
  if (!record || response?.evidence?.type !== "utterance" || response.evidence.speaker === "sprout")
    return (
      <p>
        Canonical response {eventId}: source material unavailable in the current record. No replacement event is used.
      </p>
    );
  const evidence = response.evidence;
  const scenes = diagnosticSpeechScenes(response, record);
  const fragments = row?.fragmentKeys ?? evidence.transcriptFragments?.map(fragment => fragment.key) ?? [];
  return (
    <details>
      <summary>Inspect canonical response {eventId}</summary>
      <p>Available current canonical material matched by ID; the attempt’s original input snapshot is not shown.</p>
      <EventDetail event={response} seek={seek} hasRecording={Boolean(record.recording)} />
      {!record.recording && <p>Full-session recording unavailable.</p>}
      <p>
        Scene supported by trustworthy session speech timing:{" "}
        {scenes.length === 1
          ? scenes[0].evidence?.type === "scene_displayed" && scenes[0].evidence.sceneId
          : "Not established"}
        . Conservative bounds are not exact acoustic timing; transcript-arrival context alone do not establish a scene
        during speech.
      </p>
      {scenes.map(scene => (
        <details key={scene.id}>
          <summary>Inspect speech-timing scene</summary>
          <EventDetail event={scene} seek={seek} hasRecording={Boolean(record.recording)} />
        </details>
      ))}
      <details>
        <summary>Transcript fragment provenance</summary>
        {!fragments.length && <p>No fragment references captured.</p>}
        <ul>
          {fragments.map((key, index) => {
            const fragment = evidence.transcriptFragments?.find(item => item.key === key);
            return (
              <li key={index}>
                Fragment {key}:{" "}
                {fragment
                  ? `text offsets ${fragment.textStart}–${fragment.textEnd}: ${evidence.text.slice(fragment.textStart, fragment.textEnd)}`
                  : "source material unavailable; a truncated key may not resolve"}
              </li>
            );
          })}
        </ul>
      </details>
    </details>
  );
}

export function DiagnosticRowDetail({ row, record, seek }: SourceProps & { row: ObserverDiagnosticRow }) {
  return (
    <article
      aria-label={
        row.kind === "response" ? `Response diagnostic ${row.eventId}` : `Proposal diagnostic ${row.ordinal + 1}`
      }
    >
      {row.kind === "response" ? (
        <>
          <h5>
            {row.coverage === "absent"
              ? "Response absent from usable Observer output"
              : row.coverage === "unknown"
                ? "Response coverage unknown"
                : "Response referenced in Observer output"}
          </h5>
          <p>
            {row.coverage === "absent"
              ? "The cause of absence is unknown."
              : row.coverage === "unknown"
                ? "No usable output was captured; absence cannot be determined."
                : "A returned reference does not establish a valid or published observation."}
          </p>
          <p>
            Returned references: {row.returnedCount} · Rejected proposals referencing this response: {row.rejectedCount}{" "}
            · Proposal ordinals (starting at 0): {row.proposalOrdinals.join(", ") || "None"}
          </p>
          <p>
            Attempt response facts: {label(row.speaker)} · {row.state} · Saved at {row.atMs} ms · Trustworthy session
            interval: {row.trustedTiming ? "Recorded" : "Unavailable"}
          </p>
          <ResponseSource eventId={row.eventId} row={row} record={record} seek={seek} />
        </>
      ) : (
        <>
          <h5>
            Proposal {row.ordinal + 1}:{" "}
            {row.status === "rejected" ? "rejected by validation" : "passed proposal validation"}
          </h5>
          <p>
            Proposal identity: {row.proposalId ?? "Unavailable"} · Ordinal: {row.ordinal} · Referenced responses:{" "}
            {row.responseCount} · Validation issues: {row.issueCount}
          </p>
          <p>
            A validation rejection is not an omitted response. A valid diagnostic row is not necessarily published or
            parent-reviewed, especially after batch failure.
          </p>
          {row.timestampRepaired && <p>Exchange timestamp normalized by the canonical validator.</p>}
          <ul>
            {row.issues.map((issue, index) => (
              <li key={index}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
          {!row.responseEventIds.length && (
            <p>No canonical response reference captured; no event association is inferred.</p>
          )}
          {row.responseEventIds.map(id => (
            <ResponseSource key={id} eventId={id} record={record} seek={seek} />
          ))}
        </>
      )}
      {row.traceTruncated && (
        <p role="status">
          Trace detail truncated: only bounded identities, references and reasons are available. Counts cover the whole
          bounded batch.
        </p>
      )}
    </article>
  );
}

function AttemptRows({
  sessionId,
  attempt,
  record,
  seek,
}: SourceProps & { sessionId: string; attempt: DiagnosticAttempt }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<DiagnosticPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const requestRevision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const reading = ++requestRevision.current;
    const input: DiagnosticRequest = {
      sessionId,
      snapshotId: attempt.snapshotId,
      cursor,
      numItems: DIAGNOSTIC_PAGE_SIZE,
    };
    async function load() {
      try {
        const response = await fetch("/api/parent-review/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        const value: unknown = await response.json();
        if (!response.ok || !validDiagnosticPage(value, input)) throw new Error();
        if (!cancelled && reading === requestRevision.current) setPage(value);
      } catch {
        if (!cancelled && reading === requestRevision.current) setError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, attempt.snapshotId, cursor, revision]);
  return (
    <div>
      {!page && !error && <p role="status">Loading diagnostic details…</p>}
      {error && (
        <>
          <p role="alert">Diagnostic details could not be loaded. Try again.</p>
          <button
            className="download-button"
            onClick={() => {
              setError(false);
              setRevision(value => value + 1);
            }}
          >
            Retry diagnostic details
          </button>
        </>
      )}
      {page && (
        <>
          <p role="status">
            Diagnostic page {pageNumber} · {page.page.length} rows shown
            {page.isDone ? " · End of captured rows" : " · More captured rows available"}. Trace details are bounded;
            this page is not the whole diagnostic record.
          </p>
          {!page.page.length && <p>No diagnostic rows captured for this attempt.</p>}
          {page.page.map((row, index) => (
            <DiagnosticRowDetail key={index} row={row} record={record} seek={seek} />
          ))}
          {!page.isDone && (
            <button
              className="download-button"
              onClick={() => {
                requestRevision.current++;
                setCursor(page.continueCursor);
                setPage(null);
                setError(false);
                setPageNumber(value => value + 1);
              }}
            >
              Next diagnostic page
            </button>
          )}
          {pageNumber > 1 && (
            <button
              className="download-button"
              onClick={() => {
                requestRevision.current++;
                setCursor(null);
                setPage(null);
                setError(false);
                setPageNumber(1);
              }}
            >
              Back to first diagnostic page
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function AttemptSummary({ attempt }: { attempt: DiagnosticAttempt }) {
  const summary = attempt.summary;
  return (
    <>
      <h4>
        Observer attempt {attempt.attempt} · {label(attempt.state)}
      </h4>
      <p>
        Input record: {attempt.recordStatus} · Recording attached at attempt start:{" "}
        {attempt.hasRecording ? "Yes" : "No"}.
      </p>
      {attempt.recordStatus === "incomplete" && (
        <p>
          Known incomplete-record fact: some evidence may be missing. This does not establish the cause of any absence.
        </p>
      )}
      <p>
        {attempt.snapshotChanged === true
          ? "Canonical snapshot changed before attempt completion."
          : attempt.snapshotChanged === false
            ? "No canonical snapshot change detected at attempt completion; the current record may differ."
            : "Snapshot change status unavailable."}
      </p>
      {summary ? (
        <>
          <p>
            {summary.outputState === "usable"
              ? "Usable Observer output captured."
              : summary.outputState === "invalid_batch"
                ? "Invalid Observer batch; response coverage is unknown."
                : "No usable Observer output captured; response coverage is unknown."}
          </p>
          <p>
            Responses: {summary.responseCount} · Scene events: {summary.sceneEventCount} · Returned proposals:{" "}
            {summary.returnedProposalCount ?? "Unknown"} · Rejected proposals: {summary.rejectedProposalCount} · Absent
            responses: {summary.absentResponseCount ?? "Unknown"}
          </p>
          {summary.failureStage && (
            <p>Failure stage: {label(summary.failureStage)}. This does not establish an omission cause.</p>
          )}
          {summary.batchIssue && (
            <p>
              Batch validation: <code>{summary.batchIssue.path}</code>: {summary.batchIssue.message}
            </p>
          )}
        </>
      ) : (
        <p>Attempt diagnostics not captured. Output coverage remains unknown.</p>
      )}
      <details>
        <summary>Attempt provenance</summary>
        <p>Immutable attempt identity: {attempt.snapshotId}</p>
        <p>
          Started: {new Date(attempt.startedAt).toISOString()} · Completed:{" "}
          {attempt.completedAt === null ? "Unavailable" : new Date(attempt.completedAt).toISOString()}
        </p>
        {summary && (
          <p>
            Diagnostic schema: {summary.version} · Capture boundary: {label(summary.boundary)}
          </p>
        )}
      </details>
    </>
  );
}

function DiagnosticHistoryView({
  sessionId,
  analysisId,
  history,
  record,
  seek,
}: SourceProps & {
  sessionId: string;
  analysisId: string | null;
  history?: DiagnosticHistory;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const attempt = history?.attempts.find(row => row.snapshotId === selected) ?? history?.attempts.at(-1);
  return (
    <>
      <p>
        These diagnostics describe Observer processing. They cannot be accepted, corrected or used as performance or
        mastery evidence.
      </p>
      {!history ? (
        <p>Diagnostics unavailable in this older review payload.</p>
      ) : history.availability === "legacy_unavailable" ? (
        <p>
          Historical diagnostics unavailable: this analysis predates diagnostic capture. The cause of missing
          observations is unknown.
        </p>
      ) : history.availability === "not_started" ? (
        <p>Diagnostics have not started.</p>
      ) : null}
      {!!history?.missingAttempts?.length && (
        <p>Historical attempt diagnostics unavailable for attempts: {history.missingAttempts.join(", ")}.</p>
      )}
      {attempt && (
        <>
          <label>
            Observer attempt{" "}
            <select
              aria-label="Observer attempt"
              value={attempt.snapshotId}
              onChange={event => setSelected(event.target.value)}
            >
              {history!.attempts.map(row => (
                <option key={row.snapshotId} value={row.snapshotId}>
                  Attempt {row.attempt} · {label(row.state)}
                </option>
              ))}
            </select>
          </label>
          <AttemptSummary attempt={attempt} />
          {attempt.summary && (
            <AttemptRows
              key={`${sessionId}:${analysisId}:${attempt.snapshotId}:${attempt.completedAt}`}
              sessionId={sessionId}
              attempt={attempt}
              record={record?.id === sessionId ? record : undefined}
              seek={seek}
            />
          )}
        </>
      )}
    </>
  );
}

export function EvidenceDiagnostics(
  props: SourceProps & { sessionId: string; analysisId: string | null; history?: DiagnosticHistory },
) {
  const [open, setOpen] = useState(false);
  return (
    <details className="evidence-diagnostics" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Evidence diagnostics</summary>
      {open && <DiagnosticHistoryView key={`${props.sessionId}:${props.analysisId}`} {...props} />}
    </details>
  );
}
