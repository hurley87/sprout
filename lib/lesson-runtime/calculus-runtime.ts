import { isCalculusProblemId, type CalculusProblemId } from "../calculus/problems";
import { applyExtraction, emptyWork, workInstruction, workOutcome, type CalculusWork } from "../calculus/work-check";
import { EXTRACTION_LIMITS, type WorkExtraction, type WorkExtractionInput } from "../calculus/work-extraction";
import type { TranscriptEvent } from "../events";
import { isLearnerStopText, parseLearnerNavigationText } from "./conversation-progression";
import type { LessonRuntimeState, RuntimeSource } from "./lesson-runtime-reducer";

const FILLER = /\[[^\]]*\]|\b(?:u+m+|u+h+|e+r+m*|h+m+|m+-?h*m+|and|so|then|okay|ok|right|well)\b|[^a-z0-9]+/gi;
/** What a check would read: sound tags, fillers and punctuation say nothing about
 * the work, so a turn of only "[tongue click] Um" or "And" triggers no check. */
const substance = (turns: readonly { text: string }[]) =>
  turns
    .map(turn => turn.text.replace(FILLER, " ").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" | ");

export type CalculusFragment = { event: TranscriptEvent; source: RuntimeSource; order: number };
type Context = {
  state: LessonRuntimeState | null;
  fragments: readonly CalculusFragment[];
  quiet: boolean;
  steering: boolean;
  supportRequestedAt?: { visitId: number; revision: number };
};
export interface CalculusCheck {
  readonly requestId: string;
  readonly learnerTurns: WorkExtractionInput["learnerTurns"];
  readonly status: string;
  readonly extraction: WorkExtraction | null;
  readonly outcome: string | null;
  readonly instruction: string | null;
  /** False when the learner said more while this check ran; its result is shown but
   * the tutor is briefed by the next check. */
  readonly current: boolean;
}
export interface CalculusVisit {
  readonly visitId: number;
  readonly problemId: CalculusProblemId;
  work: CalculusWork;
  outcome: "active" | "completed" | "skipped" | "stopped";
  help: number;
  readonly checks: CalculusCheck[];
}
export interface CalculusSnapshot {
  readonly work: CalculusWork | null;
  readonly checking: boolean;
  readonly complete: boolean;
  readonly visits: readonly CalculusVisit[];
}

/** Lets the learner talk through a problem; after each turn the whole visit is
 * re-read into the authored steps, the app checks them, and the tutor is told
 * what is correct, wrong or missing. Completion advances to the next problem. */
export class CalculusRuntime {
  private visits: CalculusVisit[] = [];
  private consumedFragments = new Set<number>();
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private lastChecked: string | null = null;
  private lastInstruction: string | null = null;
  private completed = false;
  private recheck = false;

  constructor(
    private readonly runtimeId: string,
    private readonly context: () => Context,
    private readonly publish: () => void,
    private readonly log: (type: string, detail: unknown) => void,
    private readonly send: (eventId: string, content: string) => void,
    private readonly stop: () => void,
    private readonly support: (request: "help" | "repeat") => void,
    private readonly schedule: () => void,
    private readonly complete: () => boolean,
    private readonly debounceMs: number,
  ) {}

  private get visit() {
    const visit = this.visits.at(-1);
    return visit?.outcome === "active" ? visit : undefined;
  }

  snapshot(): CalculusSnapshot {
    const visit = this.visit;
    return structuredClone({
      work: visit?.work ?? null,
      checking: !!this.request,
      complete: this.completed,
      visits: this.visits,
    });
  }

  private groups() {
    const groups: { speaker: TranscriptEvent["speaker"]; turnId: number; order: number; text: string }[] = [];
    for (const fragment of this.context().fragments) {
      if (this.consumedFragments.has(fragment.order)) continue;
      const previous = groups.at(-1);
      if (
        previous &&
        previous.speaker === fragment.event.speaker &&
        (fragment.event.speaker !== "child" || previous.turnId === fragment.source.childTurnId)
      )
        previous.text += fragment.event.delta;
      else
        groups.push({
          speaker: fragment.event.speaker,
          turnId: fragment.source.childTurnId,
          order: fragment.order,
          text: fragment.event.delta,
        });
    }
    return groups;
  }

  /** The problem just shown follows a completed one and the learner has not started
   * it: the tutor's praise belongs in the new problem's steering, which would
   * otherwise replace a separate completion instruction before it is spoken. */
  previousCompleted() {
    const visit = this.visit;
    return !!visit && !visit.checks.length && this.visits.at(-2)?.outcome === "completed";
  }

  learnerText() {
    const { state } = this.context();
    return this.groups()
      .filter(group => group.speaker === "child" && group.turnId === state?.childTurnId)
      .map(group => group.text)
      .join("");
  }

  /** Learners pause mid-thought for about a second, shorter than a check takes, so
   * new speech never cancels a check: it finishes, and the next one re-reads every turn.
   * Raw microphone activity (often noise or tutor echo) does not even delay a check. */
  onSpeechStarted(confirmed: boolean) {
    if (confirmed) clearTimeout(this.timer);
  }

  onQuiet(): boolean {
    clearTimeout(this.timer);
    const { state, quiet, supportRequestedAt } = this.context();
    if (!state || !quiet) return true;
    if (this.completed) {
      this.complete();
      return true;
    }
    if (!state.hasChildTranscript) return true;
    const text = this.learnerText();
    if (isLearnerStopText(text)) {
      this.stop();
      return true;
    }
    const support = /^(help|repeat)[.!]?$/i.exec(text.trim())?.[1]?.toLowerCase() as "help" | "repeat" | undefined;
    if (support) {
      if (supportRequestedAt?.visitId === state.visitId && supportRequestedAt.revision === state.transcriptRevision)
        return true;
      const { visitId, transcriptRevision } = state;
      this.consumeFragments();
      this.support(support);
      if (!this.context().steering)
        this.timer = setTimeout(() => {
          const current = this.context().state;
          if (current?.visitId === visitId && current.transcriptRevision === transcriptRevision) this.schedule();
        }, this.debounceMs);
      return true;
    }
    if (parseLearnerNavigationText(text)) {
      this.cancelCheck();
      return false;
    }
    const visitId = state.visitId;
    this.timer = setTimeout(() => {
      const current = this.context();
      if (current.quiet && current.state?.visitId === visitId) void this.check();
    }, this.debounceMs);
    return true;
  }

  private turns() {
    const clip = (text: string) => text.slice(-EXTRACTION_LIMITS.text);
    const groups = this.groups().filter(group => group.text.trim());
    return {
      learnerTurns: groups
        .filter(group => group.speaker === "child")
        .slice(-EXTRACTION_LIMITS.turns)
        .map(group => ({ id: `learner_${group.order}`, text: clip(group.text) })),
      tutorTurns: groups
        .filter(group => group.speaker !== "child")
        .slice(-8)
        .map(group => ({ id: `tutor_${group.order}`, text: clip(group.text) })),
    };
  }

  private async check() {
    const visit = this.visit;
    if (!visit || this.completed) return;
    const { learnerTurns, tutorTurns } = this.turns();
    const key = substance(learnerTurns);
    if (!key || key === this.lastChecked) return;
    if (this.request) {
      // One check at a time. Tutor speech or a later learner turn queues another.
      this.recheck = true;
      return;
    }
    this.recheck = false;
    const abort = new AbortController();
    this.request = abort;
    const requestId = crypto.randomUUID();
    const input: WorkExtractionInput = { problemId: visit.problemId, learnerTurns, tutorTurns };
    this.log("calculus.check_started", { requestId, input });
    this.publish();
    let status = "provider-failure";
    let extraction: WorkExtraction | null = null;
    try {
      const response = await fetch("/api/calculus-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(EXTRACTION_LIMITS.timeoutMs)]),
      });
      const body = (await response.json()) as { status?: string; extraction?: WorkExtraction };
      status = typeof body?.status === "string" ? body.status : "malformed";
      if (status === "ok" && body.extraction) extraction = body.extraction;
    } catch {
      status = abort.signal.aborted ? "cancelled" : "provider-failure";
    }
    if (this.request !== abort || abort.signal.aborted || this.visit !== visit) {
      this.log("calculus.check_ended", { requestId, status: "stale" });
      return;
    }
    this.request = undefined;
    // Words spoken during the check make its feedback out of date: still show its
    // result, but brief the tutor only from a check that covers everything said.
    const current = key === substance(this.turns().learnerTurns) && this.context().quiet;
    let outcome = null,
      instruction = null;
    if (extraction) {
      this.lastChecked = key;
      visit.work = applyExtraction(visit.work, extraction);
      const result = workOutcome(visit.work);
      outcome = result.kind;
      instruction = workInstruction(visit.work, result);
      if (result.kind === "complete") {
        this.completed = true;
        this.log("calculus.problem_completed", { visitId: visit.visitId, problemId: visit.problemId });
        // Advancing now carries the praise in the next problem's steering; only a
        // delayed advance needs the tutor told separately.
        if (!this.complete() && instruction !== this.lastInstruction) this.instruct(instruction);
      } else if (current && instruction !== this.lastInstruction) this.instruct(instruction);
    }
    visit.checks.push({ requestId, learnerTurns, status, extraction, outcome, instruction, current });
    this.log("calculus.check_ended", { requestId, status, extraction, work: visit.work, outcome, current });
    this.publish();
    if (this.recheck && this.context().quiet) void this.check();
  }

  private instruct(content: string) {
    const eventId = `${this.runtimeId}:math:${crypto.randomUUID()}`;
    this.lastInstruction = content;
    try {
      this.send(eventId, content);
      this.log("gpt_live.math_feedback_append", { eventId, content });
    } catch {
      this.log("gpt_live.math_feedback_failed", { eventId });
    }
  }

  onStart(nodeId: string, visitId: number) {
    this.enter(nodeId, visitId);
  }

  onVisitChange(nodeId: string, visitId: number, outcome: "completed" | "skipped") {
    this.end(outcome);
    this.enter(nodeId, visitId);
  }

  private enter(nodeId: string, visitId: number) {
    clearTimeout(this.timer);
    this.cancelCheck();
    this.consumedFragments.clear();
    this.lastChecked = this.lastInstruction = null;
    this.completed = this.recheck = false;
    if (isCalculusProblemId(nodeId))
      this.visits.push({ visitId, problemId: nodeId, work: emptyWork(nodeId), outcome: "active", help: 0, checks: [] });
    this.publish();
  }

  private end(outcome: CalculusVisit["outcome"]) {
    const visit = this.visit;
    if (visit) visit.outcome = this.completed ? "completed" : outcome === "completed" ? "skipped" : outcome;
  }

  /** Help and repeat are app actions; counted as assistance, never as learner work. */
  recordSupport(request: "help" | "repeat") {
    const visit = this.visit;
    if (visit && request === "help") visit.help++;
    this.cancelCheck();
    this.publish();
  }

  cancelCheck() {
    this.request?.abort();
    this.request = undefined;
  }

  onStop() {
    clearTimeout(this.timer);
    this.cancelCheck();
    this.end("stopped");
  }

  private consumeFragments() {
    for (const fragment of this.context().fragments)
      if (fragment.event.speaker === "child") this.consumedFragments.add(fragment.order);
  }
}
