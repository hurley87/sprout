import { installOutboundAudio, outboundPlaybackEvidence, type AudioCapture } from "./outbound-audio";
import { defaultRetentionRoot, newAttemptId, retainAttempt, retainedLocation } from "./retained-evidence";
import type { Page, TestInfo } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { COUNTING_LESSON_GRAPH, type CountingNodeId } from "../../lib/lesson-runtime/counting-lesson";
import type { LessonDiagnostic, LessonObservation } from "../../lib/lesson-runtime/lesson-runtime";
import { installLessonObserver, type LessonObserver, type LessonEventScope } from "./lesson-observer";
import { installSyntheticMicrophone, type NoiseOptions, type SpeechFixture } from "./synthetic-microphone";
import manifest from "../fixtures/speech/manifest.json";
import { installTranscriptWire, transcriptDeliveryEvidence, type WireCapture } from "./transcript-wire";
import { injectInWindow, type WindowRequest } from "./injection-window";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Report = Awaited<ReturnType<LessonObserver["report"]>>;
export type Checkpoint = { after: LessonObservation["cursor"]; scope: LessonEventScope };
type Stamp = { atMs: number | null; runtimeId: string | null };
export type HarnessRecord = Stamp & {
  sequence: number;
  action: number;
  kind: "start" | "end" | "cancelled" | "failure";
  name: string;
  trigger: string;
  detail?: unknown;
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function speechForText(text: string): SpeechFixture {
  const entry = Object.entries(manifest.fixtures).find(([, fixture]) => fixture.text === text);
  if (!entry)
    throw new Error(
      `No committed speech fixture for exact text ${JSON.stringify(text)}. Select a manifest text or fixture; synthesis and transcript injection are unsupported.`,
    );
  return entry[0] as SpeechFixture;
}

export function countingAnswer(node: CountingNodeId | null, correct: boolean): SpeechFixture {
  if (!node) throw new Error("No current counting node");
  const quantity = COUNTING_LESSON_GRAPH[node].quantity;
  // Wrong answers rotate among authored quantities, independent of any classifier verdict.
  return (["one", "two", "three"] as const)[correct ? quantity - 1 : quantity % 3];
}

/** Merge unchanged production diagnostics with companion records, using only the attempt clock. */
export function scenarioTimeline(
  report: Report,
  records: HarnessRecord[],
  wire: WireCapture | null = null,
  audio: AudioCapture | null = null,
) {
  const rows = [
    ...(report?.events ?? []).map((event, index) => ({
      atMs: event.atMs,
      order: index,
      text: `runtime ${event.type} ${JSON.stringify(event)}`,
    })),
    ...(wire?.records ?? []).map(record => ({
      atMs: record.atMs,
      order: record.sequence,
      text: `wire ${record.eventType} ${JSON.stringify(record)}`,
    })),
    ...(audio?.records ?? []).map((record, index) => ({
      atMs: record.atMs,
      order: index,
      text: `audio ${JSON.stringify(record)}`,
    })),
    ...records.map(record => ({
      atMs: record.atMs,
      order: record.sequence,
      text: `harness ${record.name} ${record.kind} ${JSON.stringify(record)}`,
    })),
  ];
  rows.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || a.order - b.order);
  return rows.map(row => `${row.atMs === null ? "unavailable" : row.atMs.toFixed(3)}ms ${row.text}`).join("\n") + "\n";
}

export class ChildScenario {
  readonly records: HarnessRecord[] = [];
  private runtimeId?: string;
  private position?: Checkpoint;
  private actionId = 0;
  private readonly abort = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly loaded = new Set<SpeechFixture>();
  private sealed = false;

  constructor(
    private readonly page: Page,
    private readonly observer: LessonObserver,
    private readonly microphone: Microphone,
  ) {}

  private async observation() {
    const value = await this.observer.read();
    if (!value) throw new Error("No lesson attempt. Call parentStart() first.");
    if (this.runtimeId && value.cursor.runtimeId !== this.runtimeId)
      throw new Error("Lesson restarted before attempt evidence was collected");
    this.runtimeId ??= value.cursor.runtimeId;
    return value;
  }

  private async stamp(): Promise<Stamp> {
    if (!this.runtimeId) return { atMs: null, runtimeId: null };
    try {
      const value = await this.observer.read();
      if (!value || (this.runtimeId && value.cursor.runtimeId !== this.runtimeId))
        return { atMs: null, runtimeId: this.runtimeId ?? null };
      return { atMs: value.nowMs, runtimeId: value.cursor.runtimeId };
    } catch {
      return { atMs: null, runtimeId: this.runtimeId ?? null };
    }
  }

  private async record(action: number, name: string, trigger: string, kind: HarnessRecord["kind"], detail?: unknown) {
    this.records.push({ ...(await this.stamp()), sequence: this.records.length, action, name, trigger, kind, detail });
  }

  private action<T>(name: string, trigger: string, body: (actionId: number) => Promise<T>): Promise<T> {
    if (this.sealed) return Promise.reject(new Error("Attempt is closed"));
    const id = ++this.actionId;
    const task = (async () => {
      await this.record(id, name, trigger, "start");
      try {
        this.abort.signal.throwIfAborted();
        const result = await body(id);
        await this.record(id, name, trigger, result === "cancelled" ? "cancelled" : "end");
        return result;
      } catch (error) {
        await this.record(id, name, trigger, this.abort.signal.aborted ? "cancelled" : "failure", errorMessage(error));
        throw error;
      }
    })();
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }

  async checkpoint(): Promise<Checkpoint> {
    const value = await this.observation();
    const state = value.snapshot.runtime;
    return {
      after: value.cursor,
      scope: {
        runtimeId: value.cursor.runtimeId,
        ...(state
          ? {
              visitId: state.visitId,
              childTurnId: state.childTurnId,
              nodeId: state.nodeId,
              transcriptRevision: state.transcriptRevision,
            }
          : {}),
      },
    };
  }

  parentStart() {
    return this.action("parentStart", "parent Start lesson click", async () => {
      if (this.runtimeId) throw new Error("Restart requires a separate run() so the previous report is retained first");
      await this.page.getByRole("button", { name: "Start lesson", exact: true }).click();
      await this.observation();
      this.position = { after: { runtimeId: this.runtimeId!, offset: 0 }, scope: { runtimeId: this.runtimeId! } };
    });
  }

  parentStop() {
    return this.action("parentStop", "parent Stop click", async () => {
      this.position = await this.checkpoint();
      await this.page.getByRole("button", { name: "Stop", exact: true }).click();
    });
  }

  currentNode() {
    return this.action(
      "currentNode",
      "read current authored node",
      async () => (await this.observation()).snapshot.display.nodeId,
    );
  }

  say(text: string) {
    return this.action("say", `exact committed text: ${text}`, () => this.speak(speechForText(text)));
  }
  sayFixture(fixture: SpeechFixture) {
    return this.action("sayFixture", `committed fixture: ${fixture}`, () => this.speak(fixture));
  }
  preload(fixture: SpeechFixture) {
    return this.action("preload", `decode/checksum ${fixture} before timing window`, async () => {
      if (!this.loaded.has(fixture)) {
        await this.microphone.loadSpeech(fixture);
        this.loaded.add(fixture);
      }
    });
  }
  injectInWindow(request: WindowRequest, timeoutMs = 25_000) {
    return this.action("injectInWindow", `${request.timing} ${JSON.stringify(request.audio)}`, async actionId => {
      if ("fixture" in request.audio && !this.loaded.has(request.audio.fixture))
        throw new Error("Preload speech before waiting for an injection window");
      const evidence = await injectInWindow(this.page, request, this.abort.signal, timeoutMs);
      // Preserve actual start evidence even if playback/observation later fails.
      await this.record(actionId, "injectionLanded", request.timing, "end", evidence);
      const result = await this.microphone.waitForPlayback(evidence.playback.id);
      if (result !== "ended") throw new Error("Window injection was cancelled before audio ended");
      return evidence;
    });
  }
  private async speak(fixture: SpeechFixture) {
    if (!this.loaded.has(fixture)) {
      await this.microphone.loadSpeech(fixture);
      this.loaded.add(fixture);
    }
    this.position = await this.checkpoint();
    this.abort.signal.throwIfAborted();
    const playback = await this.microphone.playSpeech(fixture);
    // AudioContext startedAt is deliberately excluded: it has a different epoch.
    return this.microphone.waitForPlayback(playback.id);
  }
  correctAnswer() {
    return this.action("correctAnswer", "authored quantity", async () =>
      this.speak(countingAnswer((await this.observation()).snapshot.display.nodeId, true)),
    );
  }
  wrongAnswer() {
    return this.action("wrongAnswer", "next authored quantity modulo three", async () =>
      this.speak(countingAnswer((await this.observation()).snapshot.display.nodeId, false)),
    );
  }
  dontKnow() {
    return this.sayFixture("dont-know");
  }
  help() {
    return this.sayFixture("help");
  }
  requestStop() {
    return this.sayFixture("stop");
  }
  interrupt(text = "Wait!", from?: Checkpoint) {
    return this.action("interrupt", "fresh observed tutor PCM active, then speech", async () => {
      await this.waitForEvent("output.activity", { from, detail: { state: "active" } });
      return this.speak(speechForText(text));
    });
  }
  noise(options: NoiseOptions) {
    return this.action("noise", `seeded microphone noise ${JSON.stringify(options)}`, async () => {
      this.position = await this.checkpoint();
      this.abort.signal.throwIfAborted();
      const playback = await this.microphone.noise(options);
      return this.microphone.waitForPlayback(playback.id);
    });
  }
  cancelAudio() {
    return this.action("cancelAudio", "cancel active synthetic source", () => this.microphone.cancel());
  }
  wait(ms: number) {
    return this.action("wait", `elapsed wait ${ms}ms`, async () => {
      if (!Number.isFinite(ms) || ms < 0) throw new Error("Wait duration must be finite and nonnegative");
      await delay(ms, undefined, { signal: this.abort.signal });
      this.abort.signal.throwIfAborted();
    });
  }
  staySilent(ms: number) {
    return this.action("staySilent", `connected microphone silence ${ms}ms`, async () => {
      this.position = await this.checkpoint();
      await this.microphone.silence();
      await this.wait(ms);
    });
  }

  waitForEvent(
    type: string,
    options: {
      from?: Checkpoint;
      scope?: Partial<LessonEventScope>;
      detail?: Record<string, unknown>;
      timeoutMs?: number;
    } = {},
  ) {
    return this.action("waitForEvent", `${type} ${JSON.stringify(options)}`, async () => {
      const from = options.from ?? this.position ?? (await this.checkpoint());
      await this.observation();
      const scope = Object.fromEntries(
        Object.entries({ runtimeId: from.scope.runtimeId, visitId: from.scope.visitId, ...options.scope }).filter(
          ([, value]) => value !== undefined,
        ),
      ) as LessonEventScope;
      const result = await this.observer.waitForEvent(type, {
        after: from.after,
        scope,
        detail: options.detail,
        timeoutMs: options.timeoutMs,
        signal: this.abort.signal,
      });
      this.position = { after: result.cursor, scope: scopeFromEvent(result.event) };
      return { ...result, after: result.cursor, scope: scopeFromEvent(result.event) };
    });
  }
  waitForNode(nodeId: CountingNodeId, timeoutMs?: number) {
    return this.waitForEvent("render.confirmed", { scope: { nodeId, visitId: undefined }, timeoutMs });
  }
  waitForTutorOutputStart(timeoutMs?: number) {
    return this.waitForEvent("output.activity", { detail: { state: "active" }, timeoutMs });
  }
  /** Observed PCM quiet only; never semantic turn completion. */
  waitForTutorQuiet(timeoutMs?: number) {
    return this.waitForEvent("output.activity", { detail: { state: "quiet" }, timeoutMs });
  }
  waitForClassifierStart(timeoutMs?: number) {
    return this.waitForEvent("classifier.started", { timeoutMs });
  }
  waitForClassifierResult(
    from: Checkpoint,
    type:
      | "classifier.result"
      | "classifier.cancelled"
      | "classifier.blocked"
      | "classifier.held"
      | "classifier.abstained" = "classifier.result",
    timeoutMs?: number,
  ) {
    return this.waitForEvent(type, { from, scope: from.scope, timeoutMs });
  }
  waitForSessionEnd(timeoutMs?: number) {
    return this.waitForEvent("lesson.ended", { scope: { visitId: undefined }, timeoutMs });
  }
  assert(name: string, assertion: () => Promise<void>) {
    return this.action("assert", name, assertion);
  }

  async finish() {
    this.sealed = true;
    this.abort.abort(new Error("Scenario attempt finished"));
    await this.microphone.cancel();
    await Promise.allSettled([...this.pending]);
  }
  async evidence() {
    const value = await this.observation();
    const report = await this.observer.report();
    if (!report || report.runtimeId !== value.cursor.runtimeId)
      throw new Error("Report unavailable or attempt changed during collection");
    return report;
  }
  async failure(error: unknown) {
    await this.record(0, "scenario", "scenario body/assertion", "failure", errorMessage(error));
  }
}

export function scopeFromEvent(event: LessonDiagnostic): LessonEventScope {
  return {
    runtimeId: event.runtimeId,
    nodeId: event.nodeId,
    visitId: event.visitId,
    childTurnId: event.childTurnId,
    transcriptRevision: event.transcriptRevision,
  };
}

/** Install once before navigation; each run retains evidence before cleanup and the next run. */
export async function installChildScenarios(
  page: Page,
  testInfo: Pick<TestInfo, "outputPath" | "attach"> & Partial<Pick<TestInfo, "project">>,
  options: { retentionRoot?: string } = {},
) {
  const audio = await installOutboundAudio(page);
  const microphone = await installSyntheticMicrophone(page);
  const observer = await installLessonObserver(page);
  const wire = await installTranscriptWire(page);
  let attempt = 0;
  let running = false;
  return {
    observer,
    microphone,
    dispose: async () => {
      await wire.dispose();
      await audio.dispose();
      await microphone.dispose();
    },
    async run(name: string, body: (child: ChildScenario) => Promise<void>) {
      if (running) throw new Error("Scenario attempts must run serially");
      running = true;
      const prefix = `attempt-${++attempt}-${name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "scenario"}`;
      const attemptId = newAttemptId();
      const child = new ChildScenario(page, observer, microphone);
      let failed = false;
      let original: unknown;
      let report: Report = null;
      let wireCapture: WireCapture | null = null;
      let audioCapture: AudioCapture | null = null;
      const problems: string[] = [];
      try {
        await body(child);
      } catch (error) {
        failed = true;
        original = error;
        await child.failure(error);
      }
      // Capture production evidence before cancellation, Stop, dispose, or restart.
      try {
        wireCapture = await wire.read();
      } catch {
        problems.push("transcript wire capture unavailable");
      }
      try {
        report = await child.evidence();
      } catch (error) {
        problems.push(`incomplete production evidence: ${errorMessage(error)}`);
      }
      try {
        await child.finish();
      } catch (error) {
        problems.push(`cleanup: ${errorMessage(error)}`);
      }
      try {
        audioCapture = await audio.read();
      } catch {
        problems.push("outbound audio capture unavailable");
      }
      try {
        if (report && report.status !== "ended") await page.getByRole("button", { name: "Stop", exact: true }).click();
      } catch (error) {
        problems.push(`parent cleanup Stop: ${errorMessage(error)}`);
      }
      const companion = {
        version: 2,
        attemptId,
        retention: null as Awaited<ReturnType<typeof retainAttempt>> | null,
        outboundAudio: audioCapture,
        outboundPlayback: outboundPlaybackEvidence(audioCapture),
        transcriptWire: wireCapture,
        transcriptDelivery: transcriptDeliveryEvidence(wireCapture, report?.events ?? [], report?.runtimeId ?? null),
        scenario: name,
        attempt,
        clock: "browser.performance.now-relative-to-attempt",
        runtimeId: report?.runtimeId ?? null,
        completeEvidence:
          report !== null && !child.records.some(record => record.atMs === null && record.name !== "parentStart"),
        problems,
        failure: failed ? errorMessage(original) : null,
        finalState: report ? { status: report.status, runtime: report.runtime, error: report.error } : null,
        records: child.records,
      };
      const save = async (suffix: string, value: string, contentType: string) => {
        try {
          const file = testInfo.outputPath(`${prefix}-${suffix}`);
          await writeFile(file, value);
          await testInfo.attach(`${prefix}-${suffix}`, { path: file, contentType });
        } catch (error) {
          problems.push(`artifact ${suffix} write/attachment: ${errorMessage(error)}`);
          companion.completeEvidence = false;
          // Continue collecting other artifacts even if one output path/attachment fails.
          try {
            await testInfo.attach(`${prefix}-${suffix}-fallback`, { body: Buffer.from(value), contentType });
          } catch (fallbackError) {
            problems.push(`artifact ${suffix} fallback: ${errorMessage(fallbackError)}`);
          }
        }
      };
      const timeline = () =>
        `Scenario: ${name}\nAttempt: ${attemptId}\nEvidence: ${companion.completeEvidence ? "complete" : "incomplete"}\n${problems.join("\n")}\n${scenarioTimeline(report, child.records, wireCapture, audioCapture)}`;
      try {
        companion.retention = retainedLocation(options.retentionRoot ?? defaultRetentionRoot(), {
          attemptId,
          runtimeId: companion.runtimeId,
        });
        companion.retention = await retainAttempt(
          options.retentionRoot ?? defaultRetentionRoot(),
          { attemptId, runtimeId: companion.runtimeId, scenario: name },
          {
            "report.json": JSON.stringify(report, null, 2),
            "timeline.txt": timeline(),
            "harness.json": JSON.stringify(companion, null, 2),
          },
          testInfo.project?.outputDir,
        );
      } catch (error) {
        companion.retention = null;
        problems.push(`retention: ${errorMessage(error)}`);
        companion.completeEvidence = false;
      }
      await save("report.json", JSON.stringify(report, null, 2), "application/json");
      await save("timeline.txt", timeline(), "text/plain");
      await save("harness.json", JSON.stringify(companion, null, 2), "application/json");
      running = false;
      if (failed) throw original;
      if (problems.length) throw new Error(problems.join("\n"));
      return { report, companion };
    },
  };
}
