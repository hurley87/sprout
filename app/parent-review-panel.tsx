"use client";

import { useEffect, useRef, useState } from "react";
import type { ObservationClaim, ObserverProposal, ParentDecision } from "../lib/observation-contracts";
import { reviewPlaybackAtMs, type RepairLevel, type ReviewCommand, type ReviewSnapshot } from "../lib/parent-review";
import { reconcileReviewWrite, type ReviewWrite } from "../lib/parent-review-reconciliation";
import { observationSummary, repairLabels } from "../lib/parent-review-summary";
import { reviewedObserverClaim } from "../lib/reviewed-observation";
import { EvidenceDetail } from "./evidence-detail";

const label = (value: string) => value.replaceAll("_", " ");
async function request(command: ReviewCommand): Promise<ReviewSnapshot | null> {
  const response = await fetch("/api/parent-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const value = await response.json();
  if (!response.ok || (command.operation !== "get" && value.saved !== true)) throw new Error("Review request failed");
  if (command.operation === "get") {
    if (value.sessionId !== command.sessionId) throw new Error("Wrong review session");
    return value as ReviewSnapshot;
  }
  return null;
}

function Claim({ claim }: { claim: ObservationClaim }) {
  return (
    <>
      <p>{claim.description}</p>
      <p>
        Behavior: {label(claim.behavior)} · Outcome: {claim.outcome} · Speaker: {label(claim.speakerAttribution)}
      </p>
      <p>
        Target quantity: {claim.targetQuantity ?? "Unavailable"} · Stated total: {claim.statedTotal ?? "Uncertain"} ·
        Spoken count sequence: {claim.countSequenceObserved ? "Observed" : "Not established"}
      </p>
      <p>
        Recorded support: {label(claim.support.status)}
        {claim.support.kinds.length
          ? ` · ${claim.support.kinds.map(label).join(", ")}`
          : " · Does not establish independence"}
      </p>
      <p>
        Uncertainty: {claim.uncertaintyReasons.length ? claim.uncertaintyReasons.map(label).join(", ") : "None stated"}
      </p>
    </>
  );
}

function DecisionForm({
  proposal,
  rejectOnly,
  disabled,
  save,
}: {
  proposal: ObserverProposal;
  rejectOnly: boolean;
  disabled: boolean;
  save: (decision: Omit<ParentDecision, "reviewedAt">) => void;
}) {
  const [mode, setMode] = useState<"corrected" | "rejected" | null>(null);
  const [description, setDescription] = useState(reviewedObserverClaim(proposal.observation).description);
  const [note, setNote] = useState("");
  const [help, setHelp] = useState(false);
  const [pointing, setPointing] = useState(false);
  const [behavior, setBehavior] = useState(proposal.observation.behavior);
  const [uncertainties, setUncertainties] = useState(proposal.observation.uncertaintyReasons);
  const [speaker, setSpeaker] = useState(proposal.observation.speakerAttribution);
  const [total, setTotal] = useState(String(proposal.observation.statedTotal ?? ""));
  const timingUncertain = proposal.observation.uncertaintyReasons.some(
    reason => reason === "missing_scene_context" || reason === "conflicting_context",
  );
  const base = { kind: "parent_decision" as const, proposalId: proposal.proposalId };
  return (
    <fieldset disabled={disabled}>
      <legend>Your decision</legend>
      {rejectOnly && <p>Speech timing is unverified. Reject this proposal to exclude it from learning evidence.</p>}
      <button className="download-button" disabled={rejectOnly} onClick={() => save({ ...base, decision: "accepted" })}>
        Accept unchanged
      </button>{" "}
      <button
        className="download-button"
        disabled={rejectOnly}
        onClick={() => {
          setMode("corrected");
          setNote("");
        }}
      >
        Edit details
      </button>{" "}
      <button
        className="download-button"
        onClick={() => {
          setMode("rejected");
          setNote("");
        }}
      >
        Reject proposal
      </button>
      <div className="review-actions" aria-label="Correction choices">
        <button
          className="download-button"
          disabled={rejectOnly}
          onClick={() => {
            setMode("corrected");
            setHelp(true);
            setNote("I helped with this response.");
          }}
        >
          I helped
        </button>
        <button
          className="download-button"
          onClick={() => {
            setMode("rejected");
            setNote("The speaker was someone else.");
          }}
        >
          The speaker was someone else
        </button>
        <button
          className="download-button"
          disabled={rejectOnly}
          onClick={() => {
            setMode("corrected");
            setNote("");
          }}
        >
          The observation is inaccurate
        </button>
        <button
          className="download-button"
          disabled={rejectOnly}
          onClick={() => {
            setMode("corrected");
            setNote("");
          }}
        >
          Add context
        </button>
      </div>
      {mode && (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (mode === "rejected") {
              save({ ...base, decision: "rejected", rejectionReason: note.trim() });
              return;
            }
            const original = proposal.observation;
            const correction: ObservationClaim = {
              ...original,
              description: description.trim(),
              behavior,
              speakerAttribution: speaker,
              countSequenceObserved:
                behavior === "uncertain_exchange"
                  ? original.countSequenceObserved
                  : behavior === "counting_aloud_with_total",
              uncertaintyReasons: behavior === "uncertain_exchange" ? uncertainties : [],
              outcome:
                behavior === "uncertain_exchange"
                  ? "uncertain"
                  : Number(total) === original.targetQuantity
                    ? "correct"
                    : "incorrect",
            };
            delete correction.statedTotal;
            if (behavior !== "uncertain_exchange") correction.statedTotal = Number(total);
            save({
              ...base,
              decision: "corrected",
              correction,
              parentContext: {
                provenance: "parent_review",
                note: note.trim(),
                ...(help ? { assistance: ["parent_reported_assistance"] } : {}),
                pointingOrTouchCounting: pointing,
              },
            });
          }}
        >
          {mode === "corrected" && (
            <>
              <p>Describe what needs changing. The displayed quantity stays tied to the recording.</p>
              <label>
                Corrected observation{" "}
                <textarea
                  required
                  maxLength={2000}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </label>
              <label>
                Observed behavior{" "}
                <select
                  value={behavior}
                  onChange={e => setBehavior(e.target.value as ObservationClaim["behavior"])}
                  disabled={timingUncertain}
                >
                  <option value="quantity_identification">Quantity identification</option>
                  <option value="counting_aloud_with_total">Counting aloud with a total</option>
                  <option value="uncertain_exchange">Uncertain exchange</option>
                </select>
              </label>
              {timingUncertain && <p>Scene timing is unsupported: retain explicit uncertainty.</p>}
              <label>
                Speaker interpretation{" "}
                <select
                  value={speaker}
                  onChange={e => setSpeaker(e.target.value as ObservationClaim["speakerAttribution"])}
                >
                  <option value="child_or_nearby_speaker">Child or nearby speaker</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              {behavior === "uncertain_exchange" && (
                <fieldset>
                  <legend>Uncertainty reasons</legend>
                  {(
                    [
                      "ambiguous_speaker",
                      "unclear_speech",
                      "silence",
                      "missing_scene_context",
                      "disrupted_exchange",
                      "conflicting_context",
                    ] as const
                  ).map(reason => (
                    <label key={reason}>
                      <input
                        type="checkbox"
                        checked={uncertainties.includes(reason)}
                        disabled={
                          timingUncertain &&
                          proposal.observation.uncertaintyReasons.includes(reason) &&
                          (reason === "missing_scene_context" || reason === "conflicting_context")
                        }
                        onChange={e =>
                          setUncertainties(previous =>
                            e.target.checked ? [...previous, reason] : previous.filter(value => value !== reason),
                          )
                        }
                      />{" "}
                      {label(reason)}
                    </label>
                  ))}
                </fieldset>
              )}
              {behavior !== "uncertain_exchange" && (
                <label>
                  Stated total{" "}
                  <input
                    type="number"
                    required
                    min={0}
                    max={100}
                    step={1}
                    value={total}
                    onChange={e => setTotal(e.target.value)}
                  />
                </label>
              )}
              <label>
                <input type="checkbox" checked={help} onChange={e => setHelp(e.target.checked)} /> I provided assistance
              </label>
              <label>
                <input type="checkbox" checked={pointing} onChange={e => setPointing(e.target.checked)} /> I observed
                pointing or touch-counting
              </label>
              <p>Your help and pointing are saved as context you supplied.</p>
            </>
          )}
          <label>
            {mode === "corrected" ? "Parent explanation" : "Rejection reason"}
            <textarea required maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <button
            className="download-button"
            type="submit"
            disabled={
              !note.trim() ||
              (mode === "corrected" &&
                (!description.trim() || (behavior === "uncertain_exchange" && !uncertainties.length)))
            }
          >
            Save {mode === "corrected" ? "correction" : "rejection"}
          </button>
        </form>
      )}
    </fieldset>
  );
}

/** Key this component by session identity; outstanding reads/writes lose authority on unmount. */
function ReviewPanel({
  sessionId,
  seek,
  hasRecording,
  canRetry,
}: {
  sessionId: string;
  seek: (atMs: number) => void;
  hasRecording: boolean;
  canRetry: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
  const [uncertain, setUncertain] = useState<ReviewWrite | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [repair, setRepair] = useState<RepairLevel>("verified");
  const [note, setNote] = useState("");
  const [individual, setIndividual] = useState(false);
  const [acknowledgeEmpty, setAcknowledgeEmpty] = useState(false);
  const alive = useRef(false);
  const lock = useRef(false);
  const readRevision = useRef(0);
  const pending = useRef<ReviewWrite | null>(null);
  async function refresh() {
    setRefreshed(false);
    const revision = ++readRevision.current;
    const value = await request({ operation: "get", sessionId });
    if (alive.current && revision === readRevision.current && value) {
      setSnapshot(value);
      const command = pending.current;
      if (command) {
        const result = reconcileReviewWrite(command, value);
        setError(result.outcome === "saved" ? "" : result.message);
        setRefreshed(result.outcome === "unresolved" && result.retryable);
        if (result.outcome !== "unresolved") {
          pending.current = null;
          setUncertain(null);
        } else {
          setUncertain(command);
        }
      } else {
        setError("");
        setRefreshed(true);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const revision = ++readRevision.current;
    const load = async () => {
      try {
        const value = await request({ operation: "get", sessionId });
        if (!cancelled && revision === readRevision.current) setSnapshot(value);
      } catch {
        if (!cancelled && revision === readRevision.current)
          setError("Saved review could not be loaded. Refresh to try again.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [sessionId]);
  async function write(command: ReviewWrite) {
    if (lock.current || (pending.current && pending.current !== command)) return;
    pending.current = command;
    lock.current = true;
    setBusy(true);
    setError("");
    setRefreshed(false);
    try {
      await request(command);
      if (!alive.current) return;
      await refresh();
    } catch {
      if (!alive.current) return;
      setUncertain(command);
      setError("Save could not be confirmed. Checking saved state; retry uses the identical decision.");
      try {
        await refresh();
      } catch {
        if (alive.current)
          setError("Save and refresh could not be confirmed. Refresh before retrying the identical decision.");
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = busy || Boolean(uncertain);
  const scope = snapshot?.analysisId ? { sessionId, analysisId: snapshot.analysisId } : null;
  const decisions = new Map(snapshot?.decisions.map(row => [row.proposalRowId, row.decision]));
  const allDecided = snapshot?.proposals.every(row => decisions.has(row.id));
  const timingInvalid = snapshot?.proposals.some(row => row.resolution === "reject_only");
  const timingResolved = snapshot?.proposals.every(
    row => row.resolution !== "reject_only" || decisions.get(row.id)?.decision === "rejected",
  );
  const unchanged = !timingInvalid && snapshot?.decisions.every(row => row.decision.decision === "accepted");
  return (
    <section aria-label="Parent observation review" className="parent-review">
      <h3>Today’s observations</h3>
      {(!snapshot || snapshot.status !== "ready") && (
        <p role="status">
          {!snapshot
            ? "Loading observations…"
            : snapshot.status === "failed"
              ? "Observations could not be prepared."
              : snapshot.status === "not_started"
                ? "Observations have not been prepared yet."
                : snapshot.status === "pending"
                  ? "Waiting to prepare observations…"
                  : "Preparing observations…"}
        </p>
      )}
      {snapshot?.qualification && <p role="status">{snapshot.qualification}</p>}
      {error && <p role="alert">{error}</p>}
      {retryMessage && <p role="status">{retryMessage}</p>}
      {busy && <p role="status">Saving or refreshing review…</p>}
      <button
        className="download-button"
        disabled={busy}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          try {
            await refresh();
          } catch {
            if (alive.current) setError("Saved review could not be refreshed.");
          } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
          }
        }}
      >
        Refresh review
      </button>
      {uncertain && (
        <button className="download-button" disabled={busy || !refreshed} onClick={() => void write(uncertain)}>
          Retry identical save
        </button>
      )}
      {snapshot && snapshot.status !== "ready" && (
        <>
          <p>
            {snapshot.status === "failed"
              ? "Analysis failed. No observations are approved."
              : "Review will be available when observations are ready. There is no successful empty summary to confirm yet."}
          </p>
          {canRetry && (
            <button
              className="download-button"
              disabled={disabled}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setError("");
                try {
                  const response = await fetch("/api/observer/retry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId }),
                  });
                  if (!response.ok) throw new Error();
                  const result = await response.json();
                  if (!alive.current) return;
                  setRetryMessage(
                    result.status === "scheduled" ? "Observer retry scheduled." : "Observer state refreshed.",
                  );
                  await refresh();
                } catch {
                  if (alive.current)
                    setError("Observer retry could not be confirmed. Refresh saved state and try again.");
                } finally {
                  lock.current = false;
                  if (alive.current) setBusy(false);
                }
              }}
            >
              Retry Observer analysis
            </button>
          )}
        </>
      )}
      {snapshot?.status === "ready" && scope && (
        <>
          {snapshot.proposals.length ? (
            <div className="review-summary">
              {observationSummary(snapshot).map((item, index) => (
                <div key={index}>
                  <p className="review-summary-text">{item.text}</p>
                  <p>{item.detail}</p>
                </div>
              ))}
              <p className="review-qualification">
                Recorded totals alone do not establish counting aloud or independence. Spoken counting does not
                establish tracking each object.
              </p>
            </div>
          ) : (
            <p>
              No usable observations were found. Confirm below that you checked this empty summary; it creates no
              learning evidence.
            </p>
          )}
          {!snapshot.review && Boolean(snapshot.proposals.length) && (
            <div className="review-actions">
              <button
                className="download-button"
                disabled={disabled || !unchanged || repair !== "verified"}
                onClick={() =>
                  void write({ operation: "acceptAll", ...scope, ...(note.trim() ? { note: note.trim() } : {}) })
                }
              >
                Looks right
              </button>
              <button className="download-button" disabled={disabled} onClick={() => setIndividual(true)}>
                Make a correction
              </button>
              <button className="download-button" onClick={() => setIndividual(value => !value)}>
                Review individually
              </button>
            </div>
          )}
          <details
            open={individual}
            className="individual-review"
            onToggle={event => setIndividual(event.currentTarget.open)}
          >
            <summary>
              {snapshot.review ? "View reviewed observations" : "Individual observations & corrections"}
            </summary>
            <p>Saved decisions are final. Check the details before saving a correction or rejection.</p>
            {snapshot.proposals.map(row => (
              <article key={row.id} aria-label={`Observation ${row.proposal.proposalId}`}>
                <h4>Observation {snapshot.proposals.indexOf(row) + 1}</h4>
                <p>
                  {row.resolution === "reject_only"
                    ? "Saved proposal has unverified speech timing; its conclusion is unsupported."
                    : reviewedObserverClaim(row.proposal.observation).description}
                </p>
                <details>
                  <summary>Original proposal details</summary>
                  <p>Original Observer proposal · {row.proposal.proposalId}</p>
                  <Claim claim={row.proposal.observation} />
                  <p>Exchange: {row.proposal.exchangeAtMs} ms from session start</p>
                </details>
                {hasRecording && (
                  <button
                    className="download-button"
                    onClick={() => seek(reviewPlaybackAtMs(row.proposal, snapshot.sources))}
                  >
                    Play exchange
                  </button>
                )}
                <details>
                  <summary>Check this exchange</summary>
                  <p>
                    Generated provider speech is not proof of delivered speech. Recording playback positions are
                    approximate.
                  </p>
                  {row.proposal.sources.map((source, i) => {
                    if (!("eventId" in source))
                      return (
                        <p key={i}>
                          Recording-reviewed support: {source.sessionStartMs}–{source.sessionEndMs} ms (recording{" "}
                          {source.recordingStartMs}–{source.recordingEndMs} ms) · {source.provenance}
                        </p>
                      );
                    const event = snapshot.sources.find(event => event.id === source.eventId);
                    return (
                      <div key={i}>
                        <p>
                          {label(source.role)} · Canonical ID {source.eventId} · Event key{" "}
                          {event?.eventKey ?? "Unavailable"} · {event?.atMs ?? "Unavailable"} ms
                        </p>
                        {event ? <EvidenceDetail evidence={event.evidence} /> : <p>Canonical context unavailable.</p>}
                      </div>
                    );
                  })}
                </details>
                {decisions.has(row.id) ? (
                  <div>
                    <h4>Saved parent decision: {decisions.get(row.id)!.decision}</h4>
                    {decisions.get(row.id)!.correction && <Claim claim={decisions.get(row.id)!.correction!} />}
                    {decisions.get(row.id)!.rejectionReason && <p>Reason: {decisions.get(row.id)!.rejectionReason}</p>}
                    {decisions.get(row.id)!.parentContext && (
                      <>
                        <p>Parent explanation: {decisions.get(row.id)!.parentContext!.note}</p>
                        <p>
                          Parent-reported help:{" "}
                          {decisions.get(row.id)!.parentContext!.assistance?.map(label).join(", ") || "None reported"} ·
                          Pointing or touch-counting:{" "}
                          {decisions.get(row.id)!.parentContext!.pointingOrTouchCounting
                            ? "Reported by parent"
                            : "Not reported"}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <DecisionForm
                    proposal={row.proposal}
                    rejectOnly={row.resolution === "reject_only"}
                    disabled={disabled || Boolean(snapshot.review)}
                    save={decision => void write({ operation: "decide", ...scope, proposalRowId: row.id, decision })}
                  />
                )}
              </article>
            ))}
          </details>
          {snapshot.review ? (
            <div role="status">
              <p>Review complete · How much you changed: {repairLabels[snapshot.review.repairLevel]}</p>
              {snapshot.review.note && <p>Lesson feedback: {snapshot.review.note}</p>}
              {snapshot.review.emptyAcknowledged && <p>Empty summary explicitly acknowledged.</p>}
            </div>
          ) : (
            <fieldset disabled={disabled}>
              <legend>Finish your check-in</legend>
              {!snapshot.proposals.length && (
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledgeEmpty}
                    onChange={e => setAcknowledgeEmpty(e.target.checked)}
                  />{" "}
                  I checked this summary with no observations
                </label>
              )}
              <label>
                How much did you need to correct Sprout’s observations?{" "}
                <select value={repair} onChange={e => setRepair(e.target.value as RepairLevel)}>
                  <option value="verified" disabled={!unchanged}>
                    Nothing
                  </option>
                  <option value="light_correction">A little</option>
                  <option value="substantial_repair">A lot</option>
                </select>
              </label>
              <label>
                How did the lesson go? (optional){" "}
                <textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
              </label>
              <p>
                Lesson feedback is saved with this review, separately from learning evidence. Add it before finishing;
                completed reviews are final.
              </p>
              <button
                className="download-button"
                disabled={
                  !allDecided ||
                  !timingResolved ||
                  (!unchanged && repair === "verified") ||
                  (!snapshot.proposals.length && !acknowledgeEmpty)
                }
                onClick={() =>
                  void write({
                    operation: "complete",
                    ...scope,
                    repairLevel: repair,
                    ...(note.trim() ? { note: note.trim() } : {}),
                    ...(!snapshot.proposals.length ? { acknowledgeEmpty: true } : {}),
                  })
                }
              >
                Finish review
              </button>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

export function ParentReviewPanel(props: {
  sessionId: string;
  seek: (atMs: number) => void;
  hasRecording: boolean;
  canRetry: boolean;
}) {
  return <ReviewPanel key={props.sessionId} {...props} />;
}
