import type { AlgebraExpression } from "../math-audit/expression";
import { formatExpression } from "../math-audit/format";
import { SCRIBE_LIMITS, type ScribeInput } from "../math-scribe/interpretation";
import { listParts, type PathStep } from "../math-scribe/parts";
import { getMathScribeProblem, isMathScribeProblemId, type MathScribeProblem } from "../math-scribe/problems";
import {
  createSession,
  reduceSession,
  sessionMetrics,
  snapshot,
  type Interpretation,
  type SessionNotice,
  type SessionState,
} from "../math-scribe/session";
import type { CalculusFragment } from "./calculus-runtime";
import { isLearnerStopText, isScribeFinishText, parseLearnerNavigationText } from "./conversation-progression";
import type { LessonRuntimeState } from "./lesson-runtime-reducer";

const FILLER = /\[[^\]]*\]|\b(?:u+m+|u+h+|e+r+m*|h+m+|m+-?h*m+|and|so|then|okay|ok|right|well)\b|[^a-z0-9]+/gi;
const substance = (text: string) =>
  text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(FILLER, " ")
    .trim();
/** Debounce multiples to wait for a late transcript before reading earlier speech anyway. */
const MISSING_TRANSCRIPT_WAIT = 5;
/** Debounce multiples after an unfinished phrase ("open bracket", "plus", "factor out"):
 * ~2.1 s at the 300 ms production debounce, covering most mid-sentence pauses seen live
 * (up to ~1.4 s beyond the microphone's own quiet window) without slowing finished speech. */
const UNFINISHED_PHRASE_WAIT = 7;
const TRAILING_FILLER = /\b(?:u+m+|u+h+|e+r+m*|h+m+)\b/g;
const UNFINISHED_ENDING =
  /\b(?:plus|minus|times|over|divided by|to the|squared|and|so|then|it would be|would be|is|equals|of|the|in|factor out|by)$/;
const unfinishedPhrase = (text: string) => {
  const words = text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const withoutFiller = words.replace(TRAILING_FILLER, " ").replace(/\s+/g, " ").trim();
  if (!withoutFiller) return !!words;
  let openBrackets = 0;
  for (const match of withoutFiller.matchAll(/\b(open|close) (?:bracket|parenthesis|parentheses)\b/g)) {
    openBrackets = Math.max(0, openBrackets + (match[1] === "open" ? 1 : -1));
  }
  return openBrackets > 0 || UNFINISHED_ENDING.test(withoutFiller);
};
const rejectedCount = (diagnostics: unknown) => {
  const dropped = (diagnostics as { dropped?: unknown } | undefined)?.dropped;
  return Array.isArray(dropped) ? dropped.length : 0;
};
const RETRYABLE = new Set(["timeout", "provider-failure", "malformed"]);
const areas: Record<string, string> = {
  "reciprocal-numerator": "the numerator of the second fraction",
  "reciprocal-denominator": "the denominator of the second fraction",
  numerator: "the numerator",
  denominator: "the denominator",
  term: "the term",
  factor: "the factor",
  base: "the base",
  "unchanged-factor": "the other factor",
  "reciprocal-factor": "the second fraction",
};

export function scribeInstruction(
  notice: SessionNotice,
  context: { origin?: "spoken-expression" | "scribed-operation"; firstProposal?: boolean } = {},
): string | null {
  switch (notice.kind) {
    // The new line is on screen, marked "Not checked yet"; asking "is that what you meant?"
    // after every edit wore on testers. Learners correct by voice or say check.
    case "proposed":
      return context.firstProposal ? "Got it — say check when you're ready." : "Got it.";
    case "clarify":
      return notice.question;
    case "checked": {
      if (notice.verdict === "equivalent") {
        if (notice.domainStatus === "restriction-unverified")
          return "That step follows, but I couldn't verify which values are allowed — the screen shows the detail. What would you like to do next?";
        if (notice.domainStatus && notice.domainStatus !== "preserved")
          return "That step follows, but it changes which values are allowed — the screen shows the detail. What would you like to do next?";
        return "That step follows. What would you like to do next?";
      }
      if (notice.verdict !== "not-equivalent")
        return "I couldn't check that expression. You can rephrase it or continue.";
      const role = notice.discrepancy?.status === "localized" ? notice.discrepancy.role : undefined;
      const area = typeof role === "string" ? areas[role] : undefined;
      return (
        "I checked the expression you told me (not your paper) and it doesn't follow from the previous line." +
        (area ? ` Please look at ${area} again.` : " Please look at it again.")
      );
    }
    case "logged":
      return notice.intent === "describe-strategy" ? "What would you like to change?" : null;
    case "confirmed":
      return "Okay.";
    case "undone":
      return "Okay, I've undone that.";
    case "continued":
      return "Okay, we'll continue without verifying that step.";
    case "limit":
      return "I can't add more to this session. Let's continue.";
    default:
      return null;
  }
}

/** One tutor update produced while reading one utterance. `scope` is the line position a
 * request for a result asks about, or that a proposal changed ([] means the whole line). */
type Queued = { kind: string; content: string; scope?: PathStep[] };
const overlaps = (a: readonly PathStep[], b: readonly PathStep[]) =>
  a.length <= b.length ? samePath(a, b.slice(0, a.length)) : samePath(a.slice(0, b.length), b);
const workingExpression = (session: SessionState) =>
  session.pending?.versions[session.pending.current].expression ?? session.base;
const samePath = (a: readonly PathStep[], b: readonly PathStep[]) => JSON.stringify(a) === JSON.stringify(b);
/** A part named against the batch's starting line, found again after earlier edits in the same
 * batch: only when no edit touched it or anything containing it (identical text at the same
 * position inside a replaced subtree is not the same part), and the position still holds it. */
function carryPart(
  start: AlgebraExpression,
  now: AlgebraExpression,
  partId: string,
  changes: readonly PathStep[][],
): string | null {
  const named = listParts(start).find(part => part.id === partId);
  if (!named || changes.some(change => overlaps(change, named.path))) return null;
  const found = listParts(now).find(
    part => part.kind === named.kind && part.latex === named.latex && samePath(part.path, named.path),
  );
  return found?.id ?? null;
}

type Context = {
  state: LessonRuntimeState | null;
  fragments: readonly CalculusFragment[];
  quiet: boolean;
  steering: boolean;
};
type RequestRecord = {
  requestId: string;
  learnerTurns: ScribeInput["learnerTurns"];
  revision: number;
  status: string;
  timingMs: number;
  diagnostics?: unknown;
  timing?: unknown;
};
type Visit = {
  visitId: number;
  problem: MathScribeProblem;
  session: SessionState;
  requests: RequestRecord[];
  proposalTimings: number[];
  checkTimings: number[];
};

export { isScribeFinishText };

export class MathScribeRuntime {
  private visits: Visit[] = [];
  private active?: Visit;
  private consumed = new Set<number>();
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private requestOrders = new Set<number>();
  private stopped = false;
  private speechEndedAt = 0;
  private checking = false;

  constructor(
    private readonly runtimeId: string,
    private readonly context: () => Context,
    private readonly publish: () => void,
    private readonly log: (type: string, detail: unknown) => void,
    private readonly send: (eventId: string, content: string) => void,
    private readonly stop: () => void,
    private readonly support: (request: "help" | "repeat") => void,
    _schedule: () => void,
    _complete: () => boolean,
    _nextIsTerminal: () => boolean,
    private readonly debounceMs: number,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  snapshot() {
    const visit = this.active;
    return structuredClone({
      session: visit ? snapshot(visit.session) : null,
      interpreting: !!this.request,
      checking: this.checking,
      metrics: visit ? sessionMetrics(visit.session) : null,
      speechEndToProposalMs: visit?.proposalTimings ?? [],
      checkRequestToInstructionMs: visit?.checkTimings ?? [],
      problem: visit?.problem ?? null,
    });
  }

  report() {
    return structuredClone({
      visits: this.visits.map(visit => ({
        visitId: visit.visitId,
        problem: visit.problem,
        requests: visit.requests,
        log: visit.session.log,
        metrics: sessionMetrics(visit.session),
        speechEndToProposalMs: visit.proposalTimings,
        checkRequestToInstructionMs: visit.checkTimings,
      })),
    });
  }

  recap() {
    return "Thanks for practicing.";
  }

  private groups() {
    const groups: { speaker: string; turnId: number; order: number; text: string; orders: number[] }[] = [];
    for (const fragment of this.context().fragments) {
      if (fragment.event.speaker !== "child" && fragment.unheard) continue;
      if (fragment.event.speaker === "child" && this.consumed.has(fragment.order)) continue;
      const previous = groups.at(-1);
      if (
        previous &&
        previous.speaker === fragment.event.speaker &&
        (previous.speaker !== "child" || previous.turnId === fragment.source.childTurnId)
      ) {
        previous.text += fragment.event.delta;
        previous.orders.push(fragment.order);
      } else
        groups.push({
          speaker: fragment.event.speaker,
          turnId: fragment.source.childTurnId,
          order: fragment.order,
          text: fragment.event.delta,
          orders: [fragment.order],
        });
    }
    return groups.filter(group => group.text.trim());
  }

  learnerText() {
    return this.groups()
      .filter(group => group.speaker === "child" && group.turnId === this.context().state?.childTurnId)
      .map(group => group.text)
      .join("");
  }

  /** Speech onset alone no longer cancels a read in flight: echo of the tutor's own voice and
   * room noise start "speech" that never produces words, and cancelling on it lost whole
   * instructions. New learner words supersede a read instead (`onQuiet`, `newLearnerWords`). */
  onSpeechStarted(confirmed: boolean) {
    if (!confirmed) return;
    clearTimeout(this.timer);
  }

  private newLearnerWords() {
    return this.groups().some(
      group =>
        group.speaker === "child" &&
        group.orders.some(order => !this.requestOrders.has(order)) &&
        substance(group.text),
    );
  }

  onQuiet(): boolean {
    clearTimeout(this.timer);
    const current = this.context();
    if (!this.active || this.stopped || !current.quiet) return true;
    if (!current.state?.hasChildTranscript) {
      // The latest turn has no words (yet). A late transcript re-enters here and reschedules;
      // if none comes (noise, echo), still read the speech left unprocessed from earlier turns.
      const visit = this.active;
      if (!this.request && this.groups().some(group => group.speaker === "child" && substance(group.text)))
        this.timer = setTimeout(() => {
          if (this.active === visit && this.context().quiet && !this.stopped && !this.request) void this.interpret();
        }, this.debounceMs * MISSING_TRANSCRIPT_WAIT);
      return true;
    }
    const text = this.learnerText();
    if (isLearnerStopText(text)) {
      this.stop();
      return true;
    }
    if (isScribeFinishText(text)) {
      this.cancelCheck();
      if (!this.active.session.pending) return false;
      for (const group of this.groups()) {
        if (group.speaker === "child" && group.turnId === current.state.childTurnId)
          for (const order of group.orders) this.consumed.add(order);
      }
      this.instruct("Say check first, then I'm done.");
      return true;
    }
    if (parseLearnerNavigationText(text)) {
      this.cancelCheck();
      return false;
    }
    if (this.request && this.newLearnerWords()) this.cancelCheck();
    this.speechEndedAt = Date.now();
    const visit = this.active;
    const learnerGroups = this.groups().filter(group => group.speaker === "child");
    const unconsumedText = learnerGroups.map(group => group.text).join(" ");
    const latestText = learnerGroups.at(-1)?.text ?? "";
    const unfinished = unfinishedPhrase(unconsumedText) || (!substance(latestText) && unfinishedPhrase(latestText));
    this.timer = setTimeout(
      () => {
        if (this.active === visit && this.context().quiet && !this.stopped) void this.interpret();
      },
      this.debounceMs * (unfinished ? UNFINISHED_PHRASE_WAIT : 1),
    );
    return true;
  }

  private async interpret() {
    const visit = this.active;
    if (!visit || this.stopped || this.request) return;
    const groups = this.groups();
    const learner = groups.filter(group => group.speaker === "child").slice(0, SCRIBE_LIMITS.turns);
    if (!substance(learner.map(group => group.text).join(" "))) return;
    if (learner.some(group => group.text.length > SCRIBE_LIMITS.text)) {
      this.instruct("I might have missed part of that. Please say it again in shorter parts.");
      return;
    }
    const turn = (group: (typeof groups)[number], prefix: string) => ({
      id: `${prefix}_${group.order}`,
      text: group.text.slice(0, SCRIBE_LIMITS.text),
    });
    const input: ScribeInput = {
      workingLatex: formatExpression(
        visit.session.pending?.versions[visit.session.pending.current].expression ?? visit.session.base,
      ),
      baseLatex: formatExpression(visit.session.base),
      pendingStatus: visit.session.pending?.status ?? "none",
      ...(visit.session.clarification
        ? {
            openQuestion: {
              question: visit.session.clarification.question,
              prompt: visit.session.clarification.prompt ?? "",
              ...(visit.session.clarification.part ? { part: visit.session.clarification.part } : {}),
              ...(visit.session.clarification.operation ? { operation: visit.session.clarification.operation } : {}),
            },
          }
        : {}),
      learnerTurns: learner.map(group => turn(group, "learner")),
      tutorTurns: groups
        .filter(group => group.speaker !== "child")
        .slice(-SCRIBE_LIMITS.turns)
        .map(group => turn(group, "tutor")),
    };
    const revision = visit.session.revision;
    const abort = new AbortController();
    this.request = abort;
    this.requestOrders = new Set(learner.flatMap(group => group.orders));
    this.publish();
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      const requestId = crypto.randomUUID();
      let status = "provider-failure";
      let body: { status?: string; interpretations?: Interpretation[]; diagnostics?: unknown; timing?: unknown } = {};
      const timeout = AbortSignal.timeout(SCRIBE_LIMITS.clientTimeoutMs);
      try {
        const response = await this.fetcher("/api/math-scribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.any([abort.signal, timeout]),
        });
        body = await response.json();
        status = typeof body.status === "string" ? body.status : "malformed";
        if (status === "ok" && !Array.isArray(body.interpretations)) status = "malformed";
      } catch {
        status = abort.signal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "provider-failure";
      }
      const current = this.request === abort && !abort.signal.aborted && this.active === visit && !this.stopped;
      const record: RequestRecord = {
        requestId,
        learnerTurns: input.learnerTurns,
        revision,
        status: current ? status : "cancelled",
        timingMs: Math.max(0, Date.now() - started),
        ...(body.diagnostics === undefined ? {} : { diagnostics: body.diagnostics }),
        ...(body.timing === undefined ? {} : { timing: body.timing }),
      };
      visit.requests.push(record);
      if (!current) {
        this.log("math-scribe.request", record);
        return;
      }
      if (status === "ok" && body.interpretations?.length === 0 && rejectedCount(body.diagnostics) > 0) {
        // Every reading failed validation (e.g. a misquoted learner phrase): ask again at once
        // rather than leave the learner in silence; after a second failure, ask them to repeat.
        record.status = "rejected";
        this.log("math-scribe.request", record);
        if (attempt === 0) continue;
        for (const group of learner) for (const order of group.orders) this.consumed.add(order);
        this.instruct("I might have misheard. Please say that again.");
        break;
      }
      if (status === "ok" && body.interpretations) {
        if (this.newLearnerWords()) {
          // The learner kept talking while this was read: re-read everything together.
          record.status = "superseded";
          this.log("math-scribe.request", record);
          this.reinterpretSoon(visit);
          break;
        }
        if (visit.session.revision !== revision) {
          // A UI action changed the line meanwhile: re-read the same speech against it.
          record.status = "stale";
          this.log("math-scribe.request", record);
          this.reinterpretSoon(visit);
          break;
        }
        this.log("math-scribe.request", record);
        let changedLine = false;
        let applied = false;
        // Part IDs in this batch name parts of the line the model read; one batch speaks once.
        const start = workingExpression(visit.session);
        const batch: Queued[] = [];
        const changes: PathStep[][] = [];
        try {
          for (const read of body.interpretations) {
            if (this.stopped || this.active !== visit || this.request !== abort) break;
            let interpretation = read;
            const operation = "operation" in read ? read.operation : undefined;
            const partId = operation && "partId" in operation ? operation.partId : undefined;
            if (changedLine && operation && partId) {
              const carried = carryPart(start, workingExpression(visit.session), partId, changes);
              if (!carried) {
                this.log("math-scribe.stale-part", { requestId, reason: "stale-part" });
                batch.push({ kind: "stale-part", content: "I might have misheard. Which part did you mean?" });
                continue;
              }
              interpretation = { ...read, operation: { ...operation, partId: carried } } as Interpretation;
            }
            // A check or confirmation in the same breath as a change would judge a line the learner
            // has not yet seen; hold it so a misrecognition cannot reach mathematical feedback.
            if (changedLine && (interpretation.intent === "request-check" || interpretation.intent === "confirm")) {
              this.log("math-scribe.check-deferred", { requestId, intent: interpretation.intent });
              batch.push({
                kind: "check-deferred",
                content: "I've written it on the screen. Have a look first, then say check if it's what you meant.",
              });
              continue;
            }
            const line = workingExpression(visit.session);
            // Compare trees, not text: different groupings can format identically.
            const before = JSON.stringify(line);
            const pathOf = (id: string | null | undefined) =>
              id ? listParts(line).find(part => part.id === id)?.path : [];
            this.checking = interpretation.intent === "request-check";
            if (this.checking) this.publish();
            const result = reduceSession(visit.session, {
              type: "interpretation",
              requestId,
              basedOnRevision: applied ? visit.session.revision : revision,
              interpretation,
              at: Date.now(),
            });
            visit.session = result.state;
            applied = result.notice.kind !== "stale" || applied;
            const after = JSON.stringify(workingExpression(visit.session));
            changedLine ||= before !== after;
            const used = "operation" in interpretation ? interpretation.operation : undefined;
            // Only a part replacement is confined to its part; other operations restructure around
            // it (a reciprocal turns the division into a product), so they count as the whole line.
            const scope =
              result.notice.kind === "proposed"
                ? used?.kind === "replace-part"
                  ? (pathOf(result.notice.changed.partId) ?? [])
                  : []
                : result.notice.kind === "clarify" && used?.kind === "non-unique"
                  ? (pathOf(used.partId) ?? [])
                  : undefined;
            if (before !== after) changes.push(scope ?? []);
            this.brief(visit, result.notice, started, { batch, scope });
            this.checking = false;
          }
        } finally {
          // A batch whose visit or request was replaced meanwhile must not speak into the new one.
          if (!this.stopped && this.active === visit && this.request === abort) this.flush(batch, visit, started);
        }
        if (applied) {
          for (const group of learner) for (const order of group.orders) this.consumed.add(order);
          this.reinterpretSoon(visit);
        }
        break;
      }
      this.log("math-scribe.request", record);
      if (!RETRYABLE.has(status) || attempt === 1) {
        this.instruct("I might have misheard. Please say that again.");
        break;
      }
    }
    if (this.request === abort) {
      this.request = undefined;
      this.publish();
    }
  }

  /** Framed as an application instruction, like calculus checks, so the tutor relays it
   * briefly instead of treating it as conversation or adding mathematics of its own. */
  /** Speech left unconsumed is read again after the current request settles. */
  private reinterpretSoon(visit: Visit) {
    if (!this.groups().some(group => group.speaker === "child" && substance(group.text))) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.active === visit && this.context().quiet && !this.stopped && !this.request) void this.interpret();
    }, this.debounceMs);
  }

  private instruct(content: string) {
    if (this.stopped) return;
    const eventId = `${this.runtimeId}:math-scribe:${crypto.randomUUID()}`;
    this.send(
      eventId,
      `Application update from the scribe. Say only this, briefly and in your own words, and add no mathematics: "${content}"`,
    );
    this.log("math-scribe.instruction", { eventId, content });
  }

  /** Several separate updates from one utterance were spoken over each other or dropped, so a
   * batch becomes one message: a check supersedes the confirmation before it, a held check
   * already says the change is on screen, and a request for a result is not asked when a later
   * proposal in the same breath changed that position. An open "what would you like to change"
   * is dropped whenever anything follows it. */
  private flush(queued: readonly Queued[], visit: Visit, started: number) {
    const checked = queued.some(item => item.kind === "checked");
    const deferred = queued.some(item => item.kind === "check-deferred");
    const kept = queued.filter(
      (item, index) =>
        !(checked && item.kind === "confirmed") &&
        !(deferred && item.kind === "proposed") &&
        !queued.slice(index + 1).some(
          later =>
            // "What would you like to change?" is moot once the same breath did anything else.
            item.kind === "logged" ||
            (later.kind === "proposed" &&
              item.kind === "clarify" &&
              item.scope &&
              later.scope &&
              overlaps(item.scope, later.scope)),
        ),
    );
    const content = [...new Set(kept.map(item => item.content))].join(" ");
    if (!content) return;
    this.instruct(content);
    if (kept.some(item => item.kind === "checked")) visit.checkTimings.push(Math.max(0, Date.now() - started));
  }

  /** Within a batch the update is queued for `flush`; otherwise (UI actions) it is spoken now. */
  private brief(visit: Visit, notice: SessionNotice, started: number, queue?: { batch: Queued[]; scope?: PathStep[] }) {
    if (notice.kind === "proposed") visit.proposalTimings.push(Math.max(0, Date.now() - this.speechEndedAt));
    if (notice.kind === "logged" && (notice.intent === "request-help" || notice.intent === "request-repeat")) {
      this.support(notice.intent === "request-help" ? "help" : "repeat");
      return;
    }
    const origin = visit.session.pending?.versions[visit.session.pending.current].origin;
    const instruction = scribeInstruction(notice, { origin, firstProposal: visit.proposalTimings.length === 1 });
    this.publish();
    if (!instruction) return;
    if (queue) {
      queue.batch.push({ kind: notice.kind, content: instruction, ...(queue.scope ? { scope: queue.scope } : {}) });
      return;
    }
    this.instruct(instruction);
    if (notice.kind === "checked") visit.checkTimings.push(Math.max(0, Date.now() - started));
  }

  ui(action: "confirm" | "undo" | "check" | "continue") {
    const visit = this.active;
    if (!visit || this.stopped) return;
    const at = Date.now();
    this.checking = action === "check";
    if (this.checking) this.publish();
    const result = reduceSession(visit.session, { type: "ui", action, at });
    visit.session = result.state;
    this.brief(visit, result.notice, at);
    this.checking = false;
    this.publish();
  }

  onStart(nodeId: string, visitId: number) {
    this.enter(nodeId, visitId);
  }
  onVisitChange(nodeId: string, visitId: number, _outcome: "completed" | "skipped") {
    void _outcome;
    this.enter(nodeId, visitId);
  }
  private enter(nodeId: string, visitId: number) {
    clearTimeout(this.timer);
    this.cancelCheck();
    this.stopped = false;
    this.active = undefined;
    this.consumed = new Set(
      this.context()
        .fragments.filter(fragment => fragment.event.speaker === "child")
        .map(fragment => fragment.order),
    );
    if (isMathScribeProblemId(nodeId)) {
      const problem = getMathScribeProblem(nodeId);
      const session = createSession({ problemId: nodeId, latex: problem.latex });
      if (!session.ok) throw new Error(`Invalid math scribe problem: ${session.reason}`);
      this.active = { visitId, problem, session: session.state, requests: [], proposalTimings: [], checkTimings: [] };
      this.visits.push(this.active);
    }
    this.publish();
  }
  recordSupport(_request: "help" | "repeat") {
    void _request;
    this.cancelCheck();
    this.publish();
  }
  cancelCheck() {
    this.request?.abort();
    this.request = undefined;
  }
  onStop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.cancelCheck();
    this.publish();
  }
}
