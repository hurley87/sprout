import type { ClientCommand, ProviderEvent, TranscriptEvent } from "./events";
import { LAST_SCENE, MODEL, PROMPT_VERSION, TIMING, sceneAt, sceneContext } from "./lesson";
import { TranscriptWindow, requestsStop, saidGoodbye } from "./transcript";

export type EndReason =
  | "parent_stop" | "child_stop" | "model_goodbye" | "wrap_up"
  | "time_limit" | "connection_failure" | "page_hidden";

// Only an ending the app chose, on a session that reached the provider, asks
// for finalization. A broken or expired session releases immediately.
const GRACEFUL_CLOSE: Record<EndReason, boolean> = {
  parent_stop: true,
  child_stop: true,
  model_goodbye: true,
  wrap_up: true,
  time_limit: false,
  connection_failure: false,
  page_hidden: false,
};

export type Snapshot = {
  status: "starting" | "active" | "wrapping" | "goodbye" | "ended";
  sceneIndex: number; reason?: EndReason; error?: string;
};
export type Diagnostic = { at: number; type: string; detail?: unknown };

export interface Transport {
  start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void): Promise<void>;
  send(command: ClientCommand): void;
  stopMedia(): void;
  close(): void;
}

/** What the app is waiting to see on screen before it speaks about it. */
type PendingDisplay =
  | { kind: "greeting"; sceneIndex: number }
  | { kind: "advance"; sceneIndex: number; delegationId: string };

export class LessonSession {
  snapshot: Snapshot = { status: "starting", sceneIndex: 0 };
  readonly events: Diagnostic[] = [];
  readonly createdAt = Date.now();
  startedAt?: number;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private phaseTimers: ReturnType<typeof setTimeout>[] = [];
  private closeTimer?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  private delegations = new Set<string>();
  private pending: PendingDisplay | null = null;
  private childSpeech = new TranscriptWindow();
  private sproutSpeech = new TranscriptWindow();
  private commands = 0;
  private closed = false;
  private ready = false;

  constructor(private transport: Transport, private changed: (snapshot: Snapshot) => void) {}

  private get scene() { return sceneAt(this.snapshot.sceneIndex); }

  log(type: string, detail?: unknown) {
    // Bounded, in-memory prototype diagnostics; no raw audio or SDP.
    if (this.events.length >= 8000) this.events.shift();
    this.events.push({ at: Date.now() - this.createdAt, type, detail });
  }

  async start() {
    this.log("attempt.started", { model: MODEL, prompt: PROMPT_VERSION });
    this.changed(this.snapshot);
    this.startupTimer = setTimeout(() => this.fail("Microphone or voice setup took too long. Check browser permission and try again."), TIMING.startup);
    try { await this.transport.start(event => this.receive(event), message => this.fail(message)); }
    catch (error) { this.fail(error instanceof Error ? error.message : "Sprout could not start. Please try again."); }
  }

  private update(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.changed(this.snapshot); }

  private dispatch(command: ClientCommand): boolean {
    this.log("command.sent", command);
    try { this.transport.send(command); return true; } catch { return false; }
  }

  private append(type: "session.instructions.append" | "session.thinking.append", content: string, delegationId: string | null = null) {
    if (this.snapshot.status === "ended") return;
    const sent = this.dispatch({ type, event_id: `sprout_${++this.commands}`, content, delegation_id: delegationId });
    if (!sent) this.fail("The voice connection was lost. You can start a new lesson.");
  }

  /** Guards the entry points where late external input can still arrive. */
  private expireIfOverdue() {
    if (this.startedAt !== undefined && Date.now() - this.startedAt >= TIMING.hard) {
      this.end("time_limit");
      return true;
    }
    return this.snapshot.status === "ended";
  }

  receive(event: ProviderEvent) {
    // Finalization is accepted after ending, but no further model work is.
    if (event.type === "session.closed") {
      this.log("connection.finalized", { reason: event.reason, usage: event.usage });
      if (this.snapshot.status !== "ended") this.fail("The voice service ended this attempt. You can start a new lesson.");
      this.close();
      return;
    }
    if (this.expireIfOverdue()) return;
    if (event.eventId !== undefined) {
      if (this.seen.has(event.eventId)) return;
      this.seen.add(event.eventId);
    }
    switch (event.type) {
      case "session.started":
        this.begin();
        return;
      case "provider.error":
        this.log("provider.error", { code: event.code });
        this.fail("The voice service reported a problem. This attempt has ended.");
        return;
      case "transcript":
        this.heard(event);
        return;
      case "delegation":
        this.requestScene(event.id);
        return;
      case "delegation.unsupported":
        this.log("action.rejected", "Invalid delegation");
        return;
      case "context.appended":
        this.log(event.name, { client_event_id: event.clientEventId, start_ms: event.startMs, end_ms: event.endMs });
        return;
      case "usage":
        this.log("session.usage.updated", event.usage);
        return;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled provider event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private begin() {
    if (this.snapshot.status !== "starting") return;
    clearTimeout(this.startupTimer);
    this.ready = true;
    this.startedAt = Date.now();
    this.log("lesson.started");
    this.pending = { kind: "greeting", sceneIndex: 0 };
    this.update({ status: "active" });
    const phases: [number, () => void][] = [
      [TIMING.wrap, () => this.wrap()],
      [TIMING.goodbye, () => this.goodbye()],
      [TIMING.finish, () => this.end("wrap_up")],
      [TIMING.hard, () => this.end("time_limit")],
    ];
    this.phaseTimers = phases.map(([delay, run]) => setTimeout(run, delay));
  }

  private heard(event: TranscriptEvent) {
    const fromChild = event.speaker === "child";
    this.log(fromChild ? "transcript.child_or_nearby_speaker" : "transcript.sprout", {
      delta: event.delta, start_ms: event.startMs, end_ms: event.endMs,
      scene: this.scene.id, playbackVerified: false,
    });
    const speech = fromChild ? this.childSpeech : this.sproutSpeech;
    const utterance = speech.append(event.delta, event.startMs, event.endMs);
    if (fromChild) {
      if (requestsStop(utterance)) this.end("child_stop");
    } else if (this.snapshot.status !== "goodbye" && saidGoodbye(utterance)) {
      // The model ending the lesson itself, usually a stop request the
      // transcript guard could not recognize. Not proof of playback.
      this.end("model_goodbye");
    }
  }

  private requestScene(delegationId: string) {
    if (this.delegations.has(delegationId)) return;
    this.delegations.add(delegationId);
    this.log("action.requested", { action: "advance_scene", id: delegationId });
    if (this.snapshot.status !== "active" || this.pending) {
      this.append("session.thinking.append", "Scene unchanged. Wait for the current scene confirmation, or finish the current activity if wrapping up. Do not request another scene now.", delegationId);
      this.log("action.rejected", "Not ready for a new scene");
      return;
    }
    if (this.snapshot.sceneIndex === LAST_SCENE) {
      this.append("session.thinking.append", "No more scenes. Keep playing with the current group at the child's pace until wrap-up. Do not delegate again.", delegationId);
      this.log("action.rejected", "Scene boundary");
      return;
    }
    const sceneIndex = this.snapshot.sceneIndex + 1;
    this.pending = { kind: "advance", sceneIndex, delegationId };
    this.update({ sceneIndex });
  }

  // Called after React commits and the browser has a paint opportunity.
  displayed(sceneIndex: number) {
    if (this.expireIfOverdue()) return;
    const pending = this.pending;
    if (!pending || pending.sceneIndex !== sceneIndex) return;
    this.pending = null;
    this.log("scene.displayed", this.scene);
    switch (pending.kind) {
      case "greeting":
        this.append("session.instructions.append", `Greet the child now in English: introduce yourself as Sprout and invite them to play. ${sceneContext(this.scene)} Then pause and listen.`);
        return;
      case "advance":
        this.append("session.thinking.append", sceneContext(this.scene), pending.delegationId);
        return;
      default: {
        const unhandled: never = pending;
        throw new Error(`Unhandled pending display: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private wrap() {
    if (this.snapshot.status !== "active") return;
    this.update({ status: "wrapping" });
    this.log("lesson.wrap_up");
    this.append("session.instructions.append", "We have played for four and a half minutes. Gently finish this exchange. No new scenes or questions after it. We will say goodbye shortly.");
  }

  private goodbye() {
    if (this.snapshot.status === "ended") return;
    this.update({ status: "goodbye" });
    this.log("lesson.goodbye_requested");
    this.append("session.instructions.append", "The lesson is finished. Say a brief warm goodbye now, then remain quiet. No questions, new activities, or delegation.");
  }

  fail(message: string) { if (this.snapshot.status !== "ended") this.end("connection_failure", message); }

  end(reason: EndReason, error?: string) {
    if (this.snapshot.status === "ended") return;
    const remaining = this.startedAt === undefined ? TIMING.hard : TIMING.hard - (Date.now() - this.startedAt);
    if (remaining <= 0) reason = "time_limit";
    clearTimeout(this.startupTimer);
    this.phaseTimers.forEach(clearTimeout);
    this.pending = null;
    this.log("lesson.ended", { reason });
    // Invalidate actions BEFORE any resource callback can fire.
    this.update({ status: "ended", reason, error });
    this.transport.stopMedia();
    if (this.ready && GRACEFUL_CLOSE[reason] && this.dispatch({ type: "session.close", event_id: `sprout_close_${++this.commands}` })) {
      // Media is already stopped; briefly keep only transport for final usage.
      this.closeTimer = setTimeout(() => { this.log("connection.finalization_unconfirmed"); this.close(); }, Math.min(1500, remaining));
      return;
    }
    this.log("connection.finalization_unconfirmed");
    this.close();
  }

  dispose() { this.end("page_hidden"); this.close(); }

  private close() {
    clearTimeout(this.closeTimer);
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
  }

  report(browser: string) {
    return { model: MODEL, promptVersion: PROMPT_VERSION, createdAt: new Date(this.createdAt).toISOString(),
      liveStartedAtMs: this.startedAt === undefined ? null : this.startedAt - this.createdAt,
      ending: this.snapshot.reason, browser,
      note: "Prototype diagnostics only. Transcript timing is approximate; speaker identity and audio delivery are unverified. No recording or learning conclusions.", events: [...this.events] };
  }
}
