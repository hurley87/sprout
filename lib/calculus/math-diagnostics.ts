import type { LessonDiagnostic } from "../lesson-runtime/diagnostic-journal";
import type { MathActionBatch } from "./math-action";
import type { MathLearnerTurn } from "./math-evidence";
import type { MathState } from "./math-state";

type Detail = {
  requestId?: string;
  id?: string;
  deliveryId?: string;
  token?: string;
  turns?: MathLearnerTurn[];
  before?: MathState;
  after?: MathState;
  proposal?: MathActionBatch;
  batch?: MathActionBatch;
  disposition?: string;
  target?: string;
  method?: string;
  accepted?: boolean;
};
const detail = (event: LessonDiagnostic) => event.detail as Detail;
const interval = (start: number | null, end: number | null) =>
  start !== null && end !== null && end >= start ? end - start : null;

/** Read-only projection of the one runtime journal. Provider media timestamps
 * are deliberately never read here. Null means unobserved, uncorrelated or
 * invalid ordering; no clock fallbacks and no mathematical authority.
 */
export function projectMathDiagnostics(events: readonly LessonDiagnostic[]) {
  const requests = events
    .filter(e => e.type === "math.interpretation_started")
    .map(start => {
      const input = detail(start);
      const requestEvents = events.filter(e => detail(e)?.requestId === input.requestId);
      const end = requestEvents.find(e => e.type === "math.interpretation_ended");
      const result = requestEvents.find(e => e.type === "math.interpretation_result");
      const id = end ? detail(end).id : undefined;
      const related = events.filter(e => id !== undefined && (detail(e)?.id === id || detail(e)?.deliveryId === id));
      const displayed = related.find(e => e.type === "math.proposal_displayed");
      const commit = related.find(e => e.type === "math.committed");
      const boardDisplay = related.find(e => e.type === "math.feedback_displayed" && detail(e).target === "board");
      const feedback = boardDisplay
        ? related.find(
            e =>
              e.type === "gpt_live.math_feedback_append" &&
              detail(e).token === detail(boardDisplay).token &&
              e.visitId === boardDisplay.visitId &&
              e.atMs >= boardDisplay.atMs,
          )
        : undefined;
      const rawProposal = (end && detail(end).proposal) ?? (result && detail(result).proposal) ?? null;
      const verified = end && detail(end).disposition === "proposed" ? detail(end).proposal : null;
      const actions =
        verified?.actions?.map((action, index) => {
          const sources = action.sources.map(span => {
            const turn = input.turns?.find(t => t.id === span.turnId);
            // Runtime IDs encode the local child turn, independent of provider intervals.
            const localTurn = turn?.id.match(/^turn_(\d+)_/);
            const matching = localTurn
              ? events.filter(e => e.visitId === start.visitId && e.childTurnId === Number(localTurn[1]))
              : [];
            const speech = matching.findLast(e => e.type === "microphone.speech_stopped" && e.atMs <= start.atMs);
            const available = matching.findLast(
              e => e.type === "math.transcript_available" && e.transcriptSpeaker === "child" && e.atMs <= start.atMs,
            );
            return {
              span,
              turn: turn ?? null,
              localSpeechEndMs: speech?.atMs ?? null,
              transcriptAvailableMs: available?.atMs ?? null,
            };
          });
          const speechEnd =
            sources.length && sources.every(s => s.localSpeechEndMs !== null)
              ? Math.max(...sources.map(s => s.localSpeechEndMs!))
              : null;
          return {
            index,
            action,
            sources,
            timing: {
              sourceSpeechEndMs: speechEnd,
              transcriptAvailableMs:
                sources.length && sources.every(s => s.transcriptAvailableMs !== null)
                  ? Math.max(...sources.map(s => s.transcriptAvailableMs!))
                  : null,
              interpretationStartMs: start.atMs,
              interpretationEndMs: end?.atMs ?? null,
              proposalFirstDisplayedMs: displayed?.atMs ?? null,
              authoritativeCommitMs: commit?.atMs ?? null,
              committedBoardFirstDisplayedMs: boardDisplay?.atMs ?? null,
              tutorFeedbackAppendMs: feedback?.atMs ?? null,
              speechEndToProposalDisplayMs: interval(speechEnd, displayed?.atMs ?? null),
              confirmationDelayMs: interval(displayed?.atMs ?? null, commit?.atMs ?? null),
              commitToBoardDisplayMs: interval(commit?.atMs ?? null, boardDisplay?.atMs ?? null),
              speechEndToCommittedDisplayMs: interval(speechEnd, boardDisplay?.atMs ?? null),
            },
          };
        }) ?? [];
      return {
        requestId: input.requestId,
        rawLearnerTurns: input.turns,
        transcriptRevision: input.before?.identity.transcriptRevision,
        interpretationDisposition: end ? detail(end).disposition : "pending",
        disposition: commit
          ? "committed"
          : related.some(e => e.type === "math.proposal_revoked")
            ? "revoked"
            : end
              ? detail(end).disposition
              : "pending",
        rawProposal,
        proposal: verified,
        actions,
        before: input.before,
        after: commit ? detail(commit).after : null,
        // Contains checks, confirmation decisions/rejections, revocation and source provenance.
        observations: [...requestEvents, ...related],
        confirmations: related
          .filter(e => e.type === "math.confirmation")
          .map(e => ({
            ...e,
            detail: { ...detail(e), token: displayed ? (detail(displayed).token ?? null) : null },
            spokenEvidence:
              detail(e).method === "spoken" ? (related.find(s => s.type === "math.spoken_confirmation") ?? null) : null,
          })),
      };
    });
  return structuredClone({
    version: 1,
    clock: "browser.performance.now-relative-to-attempt",
    displayMeasurement:
      "two-requestAnimationFrame DOM confirmation; paint opportunity approximation, not physical paint",
    unavailable: "null means missing observation, invalid ordering or unavailable correlation",
    sourceAnchor: "latest local speech end among all cited learner turns; confirmation speech is separate",
    requests,
    observedAudioActivity: events.filter(e => e.type === "output.activity"),
  });
}
