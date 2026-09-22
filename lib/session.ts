import { MODEL, PROMPT_VERSION, SCENES, TIMING, requestsStop, sceneContext, validScene, type Scene } from "./lesson";

export type EndReason = "parent_stop" | "child_stop" | "wrap_up" | "time_limit" | "connection_failure" | "page_hidden";
export type Snapshot = {
  status: "starting" | "active" | "wrapping" | "goodbye" | "ended";
  scene: Scene; reason?: EndReason; error?: string;
};
export type Diagnostic = { at: number; type: string; detail?: unknown };
export type LiveEvent = { type: string; [key: string]: unknown };
export interface Transport {
  start(onEvent: (event: LiveEvent) => void, onFailure: (message: string) => void): Promise<void>;
  send(event: LiveEvent): void;
  stopMedia(): void;
  close(): void;
}

export class LessonSession {
  snapshot: Snapshot = { status: "starting", scene: SCENES[0] };
  readonly events: Diagnostic[] = [];
  readonly createdAt = Date.now();
  startedAt?: number;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private closeTimer?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  private delegations = new Set<string>();
  private pendingScene: { id: string; delegation: string | null } | null = null;
  private input = "";
  private output = "";
  private lastInputEnd = -Infinity;
  private lastOutputEnd = -Infinity;
  private command = 0;
  private closed = false;
  private ready = false;

  constructor(private transport: Transport, private changed: (snapshot: Snapshot) => void) {}

  log(type: string, detail?: unknown) {
    // Bounded, in-memory prototype diagnostics; no raw audio or SDP.
    if (this.events.length >= 8000) this.events.shift();
    this.events.push({ at: Date.now() - this.createdAt, type, detail });
  }

  async start() {
    this.log("attempt.started", { model: MODEL, prompt: PROMPT_VERSION });
    this.changed(this.snapshot);
    this.later(TIMING.startup, () => this.fail("Microphone or voice setup took too long. Check browser permission and try again."));
    try { await this.transport.start(event => this.receive(event), message => this.fail(message)); }
    catch (error) { this.fail(error instanceof Error ? error.message : "Sprout could not start. Please try again."); }
  }

  private later(ms: number, action: () => void) { this.timers.push(setTimeout(action, ms)); }
  private update(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.changed(this.snapshot); }
  private send(type: string, content?: string, delegation: string | null = null) {
    if (this.snapshot.status === "ended") return;
    const event: LiveEvent = { type, event_id: `sprout_${++this.command}` };
    if (content !== undefined) Object.assign(event, { content, delegation_id: delegation });
    this.log("command.sent", event);
    try { this.transport.send(event); } catch { this.fail("The voice connection was lost. You can start a new lesson."); }
  }

  private deadline() {
    if (this.startedAt !== undefined && Date.now() - this.startedAt >= TIMING.hard) {
      this.end("time_limit");
      return true;
    }
    return this.snapshot.status === "ended";
  }

  receive(event: LiveEvent) {
    // Finalization is accepted after ending, but no further model work is.
    if (event.type === "session.closed") {
      this.log("connection.finalized", { reason: event.reason, usage: event.usage });
      if (this.snapshot.status !== "ended") this.fail("The voice service ended this attempt. You can start a new lesson.");
      this.close();
      return;
    }
    if (this.deadline()) return;
    if (typeof event.event_id === "string") {
      if (this.seen.has(event.event_id)) return;
      this.seen.add(event.event_id);
    }
    if (event.type === "session.started" && this.snapshot.status === "starting") {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      this.ready = true;
      this.startedAt = Date.now();
      this.log("lesson.started");
      this.pendingScene = { id: SCENES[0].id, delegation: null };
      this.update({ status: "active" });
      this.later(TIMING.wrap, () => this.wrap());
      this.later(TIMING.goodbye, () => this.goodbye());
      this.later(TIMING.finish, () => this.end("wrap_up"));
      this.later(TIMING.hard, () => this.end("time_limit"));
      return;
    }
    if (event.type === "error") { this.log("provider.error", { code: (event.error as { code?: string })?.code }); this.fail("The voice service reported a problem. This attempt has ended."); return; }
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || typeof event.start_ms !== "number" || typeof event.end_ms !== "number") return;
      const input = event.type === "session.input_transcript.delta";
      this.log(input ? "transcript.child_or_nearby_speaker" : "transcript.sprout", {
        delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms,
        scene: this.snapshot.scene.id, playbackVerified: false,
      });
      if (input) {
        // Do not combine a fresh utterance with a negation from an old one.
        if (event.start_ms - this.lastInputEnd > 2500) this.input = "";
        this.input = (this.input + event.delta).slice(-500);
        this.lastInputEnd = event.end_ms;
        if (requestsStop(this.input)) this.end("child_stop");
      } else {
        if (event.start_ms - this.lastOutputEnd > 2500) this.output = "";
        this.output = (this.output + event.delta).slice(-500);
        this.lastOutputEnd = event.end_ms;
        // A fallback for stop requests the simple input guard cannot recognize.
        // This is not proof of goodbye playback completion.
        if (/bye for now[.!]?\s*$/i.test(this.output) && this.snapshot.status !== "goodbye") this.end("child_stop");
      }
      return;
    }
    if (event.type === "session.delegation.created") {
      const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
      if (typeof delegation?.id !== "string" || delegation.target !== "client") {
        this.log("action.rejected", "Invalid delegation"); return;
      }
      const id = delegation.id;
      if (this.delegations.has(id)) return;
      this.delegations.add(id);
      this.log("action.requested", { action: "advance_scene", id });
      if (this.snapshot.status !== "active" || this.pendingScene) {
        this.send("session.thinking.append", "Scene unchanged. Wait for the current scene confirmation, or finish the current activity if wrapping up. Do not request another scene now.", id);
        this.log("action.rejected", "Not ready for a new scene"); return;
      }
      const index = SCENES.findIndex(s => s.id === this.snapshot.scene.id);
      const next = SCENES[index + 1];
      if (!next || !validScene(next)) {
        this.send("session.thinking.append", "No more scenes. Keep playing with the current group at the child's pace until wrap-up. Do not delegate again.", id);
        this.log("action.rejected", "Scene boundary"); return;
      }
      this.pendingScene = { id: next.id, delegation: id };
      this.update({ scene: next });
      return;
    }
    if (event.type.endsWith(".appended")) this.log(event.type, { client_event_id: event.client_event_id, start_ms: event.start_ms, end_ms: event.end_ms });
    if (event.type === "session.usage.updated") this.log(event.type, event.usage);
  }

  // Called after React commits and the browser has a paint opportunity.
  displayed(id: string) {
    if (this.deadline() || this.pendingScene?.id !== id) return;
    const pending = this.pendingScene;
    this.pendingScene = null;
    this.log("scene.displayed", this.snapshot.scene);
    if (pending.delegation === null) {
      this.send("session.instructions.append", `Greet the child now in English: introduce yourself as Sprout and invite them to play. ${sceneContext(this.snapshot.scene)} Then pause and listen.`);
    } else this.send("session.thinking.append", sceneContext(this.snapshot.scene), pending.delegation);
  }

  private wrap() {
    if (this.deadline() || this.snapshot.status !== "active") return;
    this.update({ status: "wrapping" });
    this.log("lesson.wrap_up");
    this.send("session.instructions.append", "We have played for four and a half minutes. Gently finish this exchange. No new scenes or questions after it. We will say goodbye shortly.");
  }
  private goodbye() {
    if (this.deadline()) return;
    this.update({ status: "goodbye" });
    this.log("lesson.goodbye_requested");
    this.send("session.instructions.append", "The lesson is finished. Say a brief warm goodbye now, then remain quiet. No questions, new activities, or delegation.");
  }
  fail(message: string) { if (this.snapshot.status !== "ended") this.end("connection_failure", message); }

  end(reason: EndReason, error?: string) {
    if (this.snapshot.status === "ended") return;
    const remaining = this.startedAt === undefined ? TIMING.hard : TIMING.hard - (Date.now() - this.startedAt);
    if (remaining <= 0) reason = "time_limit";
    this.timers.forEach(clearTimeout);
    this.pendingScene = null;
    this.log("lesson.ended", { reason });
    // Invalidate actions BEFORE any resource callback can fire.
    this.update({ status: "ended", reason, error });
    this.transport.stopMedia();
    if (this.ready && reason !== "connection_failure" && reason !== "time_limit" && reason !== "page_hidden") {
      try {
        this.transport.send({ type: "session.close", event_id: `sprout_close_${++this.command}` });
        // Media is already stopped; briefly keep only transport for final usage.
        this.closeTimer = setTimeout(() => { this.log("connection.finalization_unconfirmed"); this.close(); }, Math.min(1500, remaining));
        return;
      } catch { /* Release even if sending the close failed. */ }
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
  report() {
    return { model: MODEL, promptVersion: PROMPT_VERSION, createdAt: new Date(this.createdAt).toISOString(),
      liveStartedAtMs: this.startedAt === undefined ? null : this.startedAt - this.createdAt,
      ending: this.snapshot.reason, browser: typeof navigator === "undefined" ? "test" : navigator.userAgent,
      note: "Prototype diagnostics only. Transcript timing is approximate; speaker identity and audio delivery are unverified. No recording or learning conclusions.", events: [...this.events] };
  }
}
