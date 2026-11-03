import { formatExpression } from "../math-audit/format";
import { SCRIBE_LIMITS, type ScribeInput } from "../math-scribe/interpretation";
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
import { isLearnerStopText, parseLearnerNavigationText } from "./conversation-progression";
import type { LessonRuntimeState } from "./lesson-runtime-reducer";

const FILLER = /\[[^\]]*\]|\b(?:u+m+|u+h+|e+r+m*|h+m+|m+-?h*m+|and|so|then|okay|ok|right|well)\b|[^a-z0-9]+/gi;
const substance = (text: string) =>
  text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(FILLER, " ")
    .trim();
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
  context: { origin?: "spoken-expression" | "scribed-operation" } = {},
): string | null {
  switch (notice.kind) {
    case "proposed":
      return context.origin === "scribed-operation"
        ? "Okay, it's on the screen — say check when you're ready."
        : "It's on the screen. Is that what you meant?";
    case "clarify":
      return notice.question;
    case "checked": {
      if (notice.verdict === "equivalent") return "That step follows. What would you like to do next?";
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
      return "Okay, I've recorded that as what you meant.";
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
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  snapshot() {
    const visit = this.active;
    return structuredClone({
      session: visit ? snapshot(visit.session) : null,
      interpreting: !!this.request,
      checking: this.checking,
      metrics: visit ? sessionMetrics(visit.session) : null,
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

  onSpeechStarted(confirmed: boolean) {
    if (!confirmed) return;
    clearTimeout(this.timer);
    this.cancelCheck();
  }

  onQuiet(): boolean {
    clearTimeout(this.timer);
    const current = this.context();
    if (!this.active || this.stopped || !current.quiet || !current.state?.hasChildTranscript) return true;
    const text = this.learnerText();
    if (isLearnerStopText(text)) {
      this.stop();
      return true;
    }
    if (parseLearnerNavigationText(text)) {
      this.cancelCheck();
      return false;
    }
    if (
      this.request &&
      this.groups().some(
        group =>
          group.speaker === "child" &&
          group.orders.some(order => !this.requestOrders.has(order)) &&
          substance(group.text),
      )
    )
      this.cancelCheck();
    this.speechEndedAt = Date.now();
    const visit = this.active;
    this.timer = setTimeout(() => {
      if (this.active === visit && this.context().quiet && !this.stopped) void this.interpret();
    }, this.debounceMs);
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
      if (status === "ok" && body.interpretations) {
        if (visit.session.revision !== revision) {
          record.status = "stale";
          this.log("math-scribe.request", record);
          break;
        }
        this.log("math-scribe.request", record);
        let changedLine = false;
        let applied = false;
        for (const interpretation of body.interpretations) {
          if (this.stopped || this.active !== visit || this.request !== abort) break;
          if (
            changedLine &&
            "operation" in interpretation &&
            "partId" in interpretation.operation &&
            interpretation.operation.partId
          ) {
            this.log("math-scribe.stale-part", { requestId, reason: "stale-part" });
            this.instruct("I might have misheard. Which part did you mean?");
            continue;
          }
          const before = formatExpression(
            visit.session.pending?.versions[visit.session.pending.current].expression ?? visit.session.base,
          );
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
          const after = formatExpression(
            visit.session.pending?.versions[visit.session.pending.current].expression ?? visit.session.base,
          );
          changedLine ||= before !== after;
          this.brief(visit, result.notice, started);
          this.checking = false;
        }
        if (applied) {
          for (const group of learner) for (const order of group.orders) this.consumed.add(order);
          if (this.groups().some(group => group.speaker === "child" && substance(group.text))) {
            this.timer = setTimeout(() => {
              if (this.active === visit && this.context().quiet && !this.stopped) void this.interpret();
            }, this.debounceMs);
          }
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

  private instruct(content: string) {
    if (this.stopped) return;
    const eventId = `${this.runtimeId}:math-scribe:${crypto.randomUUID()}`;
    this.send(eventId, content);
    this.log("math-scribe.instruction", { eventId, content });
  }

  private brief(visit: Visit, notice: SessionNotice, started: number) {
    if (notice.kind === "proposed") visit.proposalTimings.push(Math.max(0, Date.now() - this.speechEndedAt));
    if (notice.kind === "logged" && (notice.intent === "request-help" || notice.intent === "request-repeat")) {
      this.support(notice.intent === "request-help" ? "help" : "repeat");
      return;
    }
    const origin = visit.session.pending?.versions[visit.session.pending.current].origin;
    const instruction = scribeInstruction(notice, { origin });
    this.publish();
    if (instruction) this.instruct(instruction);
    if (notice.kind === "checked" && instruction) visit.checkTimings.push(Math.max(0, Date.now() - started));
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
