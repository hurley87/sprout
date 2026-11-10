/**
 * Garden Rescue session evidence summary (#107).
 *
 * A pure, deterministic projection of one run's existing `LessonRuntime.report()` diagnostics and
 * the run's Garden game-event log. It makes no model call, network request or timer and runs no
 * extra grading pass: every field is copied or counted from records the runtime already wrote.
 *
 * The summary describes what was observed, never what a child can do. It holds no transcript text
 * or audio. Counting strategy is always `"unknown"` because the game is voice-only and never sees
 * object tracking or pointing. Support is `"unknown"` whenever the record before acceptance is
 * incomplete, so an unlabelled tutor turn is never read as "no help". Tutor-feedback delivery is a
 * temporal inference from local playback activity and never claims the child heard it. No field
 * labels a result as independent or as proof of a skill.
 */
import type { DeliveryTracking, EvidenceTracking, FeedbackTracking } from "../lesson-runtime/evidence-tracking";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../lesson-runtime/garden-rescue-lesson";
import type { LessonRuntime } from "../lesson-runtime/lesson-runtime";
import type { ClassificationSource, LessonRuntimeEvent, VisitOutcome } from "../lesson-runtime/lesson-runtime-reducer";
import type { AnswerCommitment } from "../lesson-runtime/counting-answer-policy";
import type { AnswerOutcome } from "../lesson-runtime/conversation-state-classifier";
import { GARDEN_WORLD_EFFECTS, type GardenGameEvent, type GardenProbe, type GardenQuestId } from "./game-state";

export const GARDEN_EVIDENCE_SCHEMA = "garden-evidence/v1" as const;

type RuntimeReport = ReturnType<LessonRuntime["report"]>;
/** The subset of `LessonRuntime.report()` the summary reads. */
export type GardenSessionReport = Pick<RuntimeReport, "runtimeId" | "classifierVersion" | "status" | "error"> & {
  readonly runtime: Pick<
    NonNullable<RuntimeReport["runtime"]>,
    "lessonId" | "phase" | "difficulties" | "supportLimitReached" | "visitOutcomes"
  > | null;
  readonly events: readonly Pick<
    RuntimeReport["events"][number],
    "type" | "runtimeId" | "visitId" | "childTurnId" | "nodeId" | "transcriptRevision" | "classifierVersion" | "detail"
  >[];
};

/** Identity of the classified turn, never its words. */
type SourceRef = { readonly visitId: number; readonly childTurnId: number; readonly transcriptRevision: number };
export type GardenAttempt = SourceRef & {
  readonly answerOutcome: AnswerOutcome;
  readonly answerCommitment: AnswerCommitment | null;
  readonly status: "accepted" | "superseded" | "not_accepted";
  /** The reducer granted this answer authority at some point, even if a later turn replaced it. */
  readonly heldAuthority: boolean;
};
export type GardenTutorSupport = {
  readonly transcriptRevision: number;
  readonly beforeAcceptance: boolean;
  /** Local playback activity near this tutor turn; inferred, never proof the child heard it. */
  readonly delivery: "audio_observed" | "unknown";
};
export type GardenInstruction = {
  readonly childTurnId: number | null;
  readonly transcriptRevision: number;
  readonly beforeAcceptance: boolean;
};
export type GardenVisitSummary = {
  readonly questId: GardenQuestId;
  readonly visitId: number;
  readonly probe: GardenProbe;
  readonly skillId: string;
  readonly quantity: number;
  readonly sceneVersion: string;
  readonly attempts: readonly GardenAttempt[];
  readonly selfCorrected: boolean | "unknown";
  readonly clarifications: { readonly count: number; readonly items: readonly GardenTutorSupport[] };
  readonly hints: { readonly count: number; readonly items: readonly GardenTutorSupport[] };
  /** Instructions the runtime itself sent to the tutor during this visit. */
  readonly instructions: {
    readonly supportClarification: readonly GardenInstruction[];
    readonly answerRecovery: readonly GardenInstruction[];
  };
  readonly difficulties: readonly (SourceRef & { readonly kind: "incorrect" | "help_request" })[];
  readonly supportLimit:
    | { readonly status: "not_reached" }
    | { readonly status: "reached"; readonly close: "pending" | "sent" | "failed" | "cancelled" };
  readonly outcome: VisitOutcome["outcome"] | "unfinished_stopped" | "unfinished_error" | "in_progress";
  readonly support: "none_observed" | "clarification_only" | "hinted" | "unknown";
  readonly countingStrategy: "unknown";
  readonly effect: {
    readonly name: string;
    readonly authorized: boolean;
    readonly authorizedBy: ClassificationSource | null;
    readonly renderConfirmed: boolean;
    readonly playback: "unknown";
  } | null;
};
export type GardenIntegrityIssue = {
  readonly code:
    | "foreign_run_event"
    | "quest_succeeded_without_outcome"
    | "world_effect_without_outcome"
    | "world_effect_visit_unknown"
    | "released_quest_has_effect"
    | "duplicate_success"
    | "success_without_accepted_attempt"
    | "superseded_attempt_succeeded"
    | "multiple_transfer_visits"
    | "game_ended_mismatch"
    | "classifier_version_mismatch";
  readonly questId?: GardenQuestId;
  readonly visitId?: number | null;
};
export type GardenEvidenceSummary = {
  readonly schema: typeof GARDEN_EVIDENCE_SCHEMA;
  readonly runId: string;
  readonly lessonId: string | null;
  readonly classifierVersion: string;
  readonly ending: "completed_all_restored" | "completed_with_release" | "stopped" | "error" | "in_progress";
  readonly rehearsals: readonly GardenVisitSummary[];
  /** The fresh-challenge visit, kept apart so it is never pooled with rehearsals. */
  readonly transfer: GardenVisitSummary | null;
  readonly integrity: { readonly ok: boolean; readonly issues: readonly GardenIntegrityIssue[] };
};

const isQuest = (id: unknown): id is GardenQuestId => GARDEN_RESCUE_NODE_IDS.includes(id as GardenQuestId);
const ref = (source: ClassificationSource): SourceRef => ({
  visitId: source.visitId,
  childTurnId: source.childTurnId,
  transcriptRevision: source.transcriptRevision,
});
const AUDIO_FACTS = new Set(["playing", "play_resolved"]);

/** Summarize one run. Pure: equal inputs give equal output, and the inputs are never mutated. */
export function summarizeGardenSession({
  report,
  gameEvents,
}: {
  report: GardenSessionReport;
  gameEvents: readonly GardenGameEvent[];
}): GardenEvidenceSummary {
  const runId = report.runtimeId;
  const events = report.events;
  const issues: GardenIntegrityIssue[] = [];
  const outcomes = report.runtime?.visitOutcomes ?? [];
  const tracking = <T>(kind: string) =>
    events.flatMap((event, offset) =>
      event.type === `tracking.${kind}` && (event.detail as { kind?: string } | null)?.kind === kind
        ? [{ offset, event, detail: event.detail as T }]
        : [],
    );
  const evidence = tracking<EvidenceTracking>("evidence");
  const feedback = tracking<FeedbackTracking>("feedback");
  const delivery = tracking<DeliveryTracking>("delivery");
  const transcripts = events.flatMap((event, offset) => {
    if (event.type !== "runtime.event.transcript.updated") return [];
    const detail = event.detail as {
      event: Extract<LessonRuntimeEvent, { type: "transcript.updated" }>;
      accepted: boolean;
    };
    return detail?.accepted && event.visitId !== null
      ? [
          {
            offset,
            visitId: event.visitId,
            childTurnId: event.childTurnId,
            revision: detail.event.revision,
            speaker: detail.event.speaker,
          },
        ]
      : [];
  });

  // Displayed visits: the initial scene, then each accepted render confirmation of a quest scene.
  const visits = events.flatMap((event, offset) => {
    const detail = event.detail as {
      identity?: { nodeId: string | null };
      initial?: boolean;
      event?: { identity: { nodeId: string | null } };
      accepted?: boolean;
    } | null;
    const nodeId =
      event.type === "render.confirmed" && detail?.initial
        ? detail.identity?.nodeId
        : event.type === "runtime.event.render.confirmed" && detail?.accepted
          ? detail.event?.identity.nodeId
          : null;
    return isQuest(nodeId) && event.visitId !== null
      ? [{ questId: nodeId, visitId: event.visitId, start: offset }]
      : [];
  });
  const lastVisitId = visits.at(-1)?.visitId;

  const summaries = visits.map(({ questId, visitId, start }): GardenVisitSummary => {
    const node = GARDEN_RESCUE_LESSON.nodes[questId];
    const presentation = node.presentation as { skillId: string; quantity: number; sceneVersion: string };
    const visitTranscripts = transcripts.filter(row => row.offset >= start && row.visitId === visitId);
    const childRevisions = visitTranscripts.filter(row => row.speaker === "child");

    // Attempts: consumed classifier proposals, keyed by the child revision they judged.
    type Draft = SourceRef & {
      labels: EvidenceTracking["proposal"];
      firstAuthority: number | null;
    };
    const drafts = new Map<string, Draft>();
    for (const row of evidence) {
      const source = row.detail.origin.source;
      if (row.offset < start || source.visitId !== visitId || source.runtimeId !== runId) continue;
      if (row.detail.consumption !== "consumed" || !row.detail.proposal) continue;
      const answerRevision =
        childRevisions
          .filter(child => child.childTurnId === source.childTurnId && child.revision <= source.transcriptRevision)
          .at(-1)?.revision ?? source.transcriptRevision;
      const key = `${source.childTurnId}:${answerRevision}`;
      const draft = drafts.get(key) ?? {
        visitId,
        childTurnId: source.childTurnId,
        transcriptRevision: answerRevision,
        labels: row.detail.proposal,
        firstAuthority: null,
      };
      draft.labels = row.detail.proposal;
      if (row.detail.accepted?.answerAccepted && draft.firstAuthority === null) draft.firstAuthority = row.offset;
      drafts.set(key, draft);
    }
    const ordered = [...drafts.values()].sort((a, b) => a.transcriptRevision - b.transcriptRevision);
    const outcome = outcomes.find(record => record.nodeId === questId && record.visitId === visitId);
    // The accepted answer is the latest one holding authority when the visit committed a success.
    const acceptedDraft =
      outcome?.outcome === "succeeded"
        ? ordered
            .filter(draft => draft.firstAuthority !== null && draft.childTurnId === outcome.source.childTurnId)
            .at(-1)
        : undefined;
    if (outcome?.outcome === "succeeded" && !acceptedDraft)
      issues.push({ code: "success_without_accepted_attempt", questId, visitId });
    if (acceptedDraft && ordered.some(draft => draft.childTurnId > acceptedDraft.childTurnId))
      issues.push({ code: "superseded_attempt_succeeded", questId, visitId });
    const attempts: GardenAttempt[] = ordered.map((draft, index) => ({
      visitId,
      childTurnId: draft.childTurnId,
      transcriptRevision: draft.transcriptRevision,
      answerOutcome: draft.labels!.answerOutcome,
      answerCommitment: draft.labels!.answerCommitment ?? null,
      status: draft === acceptedDraft ? "accepted" : index < ordered.length - 1 ? "superseded" : "not_accepted",
      heldAuthority: draft.firstAuthority !== null,
    }));
    const acceptedAt = acceptedDraft?.firstAuthority ?? Infinity;
    const acceptedIndex = acceptedDraft ? ordered.indexOf(acceptedDraft) : -1;

    const childTurns = new Set(childRevisions.map(row => row.childTurnId));
    const unclassifiedEarlierTurn =
      acceptedDraft !== undefined &&
      [...childTurns].some(
        turn => turn !== null && turn < acceptedDraft.childTurnId && !ordered.some(draft => draft.childTurnId === turn),
      );
    const selfCorrected: GardenVisitSummary["selfCorrected"] =
      acceptedDraft && acceptedDraft.labels!.answerOutcome === "correct"
        ? ordered.slice(0, acceptedIndex).some(draft => draft.labels!.answerOutcome === "incorrect")
          ? true
          : unclassifiedEarlierTurn
            ? "unknown"
            : false
        : false;

    // Tutor turns: runs of tutor transcript revisions between child revisions in this visit.
    const runs: { startOffset: number; firstRevision: number; deliveryFrom: number }[] = [];
    let previous: (typeof visitTranscripts)[number] | undefined;
    for (const row of visitTranscripts) {
      if (row.speaker === "tutor" && previous?.speaker !== "tutor")
        runs.push({ startOffset: row.offset, firstRevision: row.revision, deliveryFrom: previous?.offset ?? start });
      previous = row;
    }
    let unlabelledBeforeAcceptance = false;
    const clarifications: GardenTutorSupport[] = [];
    const hints: GardenTutorSupport[] = [];
    runs.forEach((run, index) => {
      const next = runs[index + 1];
      const label = feedback
        .filter(row => {
          const source = row.detail.origin.source;
          return (
            source.visitId === visitId &&
            source.runtimeId === runId &&
            row.detail.tutorMessageIndex !== null &&
            source.transcriptRevision >= run.firstRevision &&
            (!next || source.transcriptRevision < next.firstRevision)
          );
        })
        .map(row => row.detail.semantic)
        .filter(semantic => semantic !== null && semantic !== "unknown")
        .at(-1);
      const beforeAcceptance = run.startOffset < acceptedAt;
      if (!label) {
        if (beforeAcceptance) unlabelledBeforeAcceptance = true;
        return;
      }
      if (label !== "clarifying" && label !== "helping") return;
      const until = next?.deliveryFrom ?? Infinity;
      const audio = delivery.some(
        row =>
          row.offset >= run.deliveryFrom &&
          row.offset < until &&
          row.detail.origin.source.visitId === visitId &&
          (row.detail.pcm === "active" ||
            (row.detail.playbackFact !== null && AUDIO_FACTS.has(row.detail.playbackFact))),
      );
      (label === "helping" ? hints : clarifications).push({
        transcriptRevision: run.firstRevision,
        beforeAcceptance,
        delivery: audio ? "audio_observed" : "unknown",
      });
    });
    const instruction = (type: string) =>
      events.flatMap((event, offset): GardenInstruction[] =>
        event.type === type && offset >= start && event.visitId === visitId
          ? [
              {
                childTurnId: event.childTurnId,
                transcriptRevision: event.transcriptRevision,
                beforeAcceptance: offset < acceptedAt,
              },
            ]
          : [],
      );
    const instructions = {
      supportClarification: instruction("gpt_live.clarification_append"),
      answerRecovery: instruction("gpt_live.answer_recovery_append"),
    };
    const before = (items: { beforeAcceptance: boolean }[]) => items.some(item => item.beforeAcceptance);
    const support: GardenVisitSummary["support"] = before(hints)
      ? "hinted"
      : unlabelledBeforeAcceptance
        ? "unknown"
        : before(clarifications) || before(instructions.supportClarification) || before(instructions.answerRecovery)
          ? "clarification_only"
          : "none_observed";

    const difficulties = (report.runtime?.difficulties ?? [])
      .filter(record => record.source.visitId === visitId && record.source.runtimeId === runId)
      .map(record => ({ ...ref(record.source), kind: record.kind }));
    const limitEvents = events.filter(
      (event, offset) => offset >= start && event.visitId === visitId && event.type.startsWith("support_limit."),
    );
    const reached = limitEvents.length > 0 || report.runtime?.supportLimitReached?.source.visitId === visitId;
    const lastLimit = limitEvents.at(-1)?.type.slice("support_limit.".length);
    const supportLimit: GardenVisitSummary["supportLimit"] = reached
      ? {
          status: "reached",
          close: lastLimit === "sent" || lastLimit === "failed" || lastLimit === "cancelled" ? lastLimit : "pending",
        }
      : { status: "not_reached" };

    const visitOutcome: GardenVisitSummary["outcome"] = outcome
      ? outcome.outcome
      : report.error
        ? "unfinished_error"
        : report.status === "ended" || report.runtime?.phase === "stopped" || visitId !== lastVisitId
          ? "unfinished_stopped"
          : "in_progress";

    const effectName = GARDEN_WORLD_EFFECTS[questId as keyof typeof GARDEN_WORLD_EFFECTS];
    const effectEvent = gameEvents.find(
      event => event.type === "world.effect" && event.questId === questId && event.visitId === visitId,
    );
    const effect: GardenVisitSummary["effect"] =
      node.evidenceRole === "rehearsal" && effectName && outcome?.outcome === "succeeded"
        ? {
            name: effectName,
            authorized: effectEvent !== undefined && effectEvent.runId === runId,
            authorizedBy: outcome.source,
            renderConfirmed: true,
            playback: "unknown",
          }
        : null;

    return {
      questId,
      visitId,
      probe: node.evidenceRole!,
      skillId: presentation.skillId,
      quantity: presentation.quantity,
      sceneVersion: presentation.sceneVersion,
      attempts,
      selfCorrected,
      clarifications: { count: clarifications.length, items: clarifications },
      hints: { count: hints.length, items: hints },
      instructions,
      difficulties,
      supportLimit,
      outcome: visitOutcome,
      support,
      countingStrategy: "unknown",
      effect,
    };
  });

  // Game-event integrity: success and effects must be backed by a committed succeeded outcome.
  const succeeded = (questId: GardenQuestId, visitId?: number | null) =>
    outcomes.some(
      record =>
        record.nodeId === questId &&
        record.outcome === "succeeded" &&
        (visitId === undefined || record.visitId === visitId),
    );
  for (const event of gameEvents) {
    if (event.runId !== runId) {
      issues.push({ code: "foreign_run_event" });
      continue;
    }
    if (event.type === "quest.succeeded" && !succeeded(event.questId))
      issues.push({ code: "quest_succeeded_without_outcome", questId: event.questId });
    if (event.type === "world.effect") {
      if (event.visitId === null)
        issues.push({ code: "world_effect_visit_unknown", questId: event.questId, visitId: null });
      else if (!succeeded(event.questId, event.visitId))
        issues.push({ code: "world_effect_without_outcome", questId: event.questId, visitId: event.visitId });
      if (outcomes.some(record => record.nodeId === event.questId && record.outcome === "released_after_support_limit"))
        issues.push({ code: "released_quest_has_effect", questId: event.questId, visitId: event.visitId });
    }
  }
  for (const questId of GARDEN_RESCUE_NODE_IDS) {
    const successes = outcomes.filter(record => record.nodeId === questId && record.outcome === "succeeded").length;
    const succeededEvents = gameEvents.filter(
      event => event.runId === runId && event.type === "quest.succeeded" && event.questId === questId,
    ).length;
    if (successes > 1 || succeededEvents > 1) issues.push({ code: "duplicate_success", questId });
  }
  const versions = new Set(events.flatMap(event => (event.classifierVersion ? [event.classifierVersion] : [])));
  if ([...versions].some(version => version !== report.classifierVersion))
    issues.push({ code: "classifier_version_mismatch" });

  const ending: GardenEvidenceSummary["ending"] = report.error
    ? "error"
    : report.runtime?.phase === "complete"
      ? GARDEN_RESCUE_NODE_IDS.every(id => succeeded(id))
        ? "completed_all_restored"
        : "completed_with_release"
      : report.status === "ended" || report.runtime?.phase === "stopped"
        ? "stopped"
        : "in_progress";
  const ended = gameEvents.filter(event => event.type === "game.ended" && event.runId === runId);
  const expected =
    ending === "error" ? "error" : ending === "stopped" ? "stopped" : ending === "in_progress" ? null : "completed";
  if (ended.length > 1 || (ended[0]?.type === "game.ended" && ended[0].outcome !== expected))
    issues.push({ code: "game_ended_mismatch" });

  const transfers = summaries.filter(visit => visit.probe === "transfer");
  if (transfers.length > 1) issues.push({ code: "multiple_transfer_visits" });
  return {
    schema: GARDEN_EVIDENCE_SCHEMA,
    runId,
    lessonId: report.runtime?.lessonId ?? null,
    classifierVersion: report.classifierVersion,
    ending,
    rehearsals: summaries.filter(visit => visit.probe === "rehearsal"),
    transfer: transfers.at(-1) ?? null,
    integrity: { ok: issues.length === 0, issues },
  };
}
