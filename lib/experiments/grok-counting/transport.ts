import { ACK_MODEL, type AcknowledgmentMode } from "./acknowledgment";
import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";

import type { RenderIdentity } from "@/lib/lesson-runtime/lesson-runtime-reducer";

import {
  CountingProposals,
  OUTCOME_TOOL,
  type CorrelationDiagnostic,
  type DecisionEntry,
  type DecisionReason,
  type ContinuationReason,
  type PlaybackIdentity,
} from "./proposals";

// Providers may reorder object keys or add defaults when echoing configuration.
function echoesConfiguration(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => echoesConfiguration(actual[index], value))
    );
  if (expected !== null && typeof expected === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(([key, value]) =>
        echoesConfiguration((actual as Record<string, unknown>)[key], value),
      )
    );
  return actual === expected;
}

// The live Voice API may echo flat request tools inside a `function` envelope.
// Normalize that envelope only; every required definition field must still match.
function echoesTools(tools: unknown[]): boolean {
  if (tools.length !== 1) return false;
  const tool = tools[0] as Record<string, unknown> | null;
  if (!tool || typeof tool !== "object" || tool.type !== "function") return false;
  if (!("function" in tool)) return echoesConfiguration(tool, OUTCOME_TOOL);
  if (["name", "description", "parameters"].some(key => key in tool)) return false;
  const definition = {
    name: OUTCOME_TOOL.name,
    description: OUTCOME_TOOL.description,
    parameters: OUTCOME_TOOL.parameters,
  };
  return echoesConfiguration(tool.function, definition);
}

// Conservative realtime generation limits. Neither is a playback deadline.
export const CONTINUATION_START_TIMEOUT_MS = 15_000;
export const CONTINUATION_COMPLETE_TIMEOUT_MS = 60_000;
export const GROK_MODEL = "grok-voice-3.0";
export type Transcript = { id: string; speaker: "Learner" | "Tutor"; text: string; final: boolean };
export type VoiceSnapshot = {
  acknowledgmentMode?: AcknowledgmentMode;
  classifierModel?: string | null;
  feedbackStatus?: DecisionReason;
  feedbackDelivered?: boolean;
  status: "connecting" | "listening" | "stopped" | "error" | "complete";
  error?: string;
  echoedModel?: string;
  output: "idle" | "playing";
  transcripts: Transcript[];
  nodeId?: string;
  render?: RenderIdentity;
  complete?: boolean;
  diagnostics?: CorrelationDiagnostic[];
  decisionTimeline?: DecisionEntry[];
  proposal?: string;
  answerAccepted?: boolean;
  learnerAnswerAccepted?: boolean;
};
export function encodePcm(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
  });
  return btoa(String.fromCharCode(...bytes));
}

// One instance per Start. All continuations and callbacks are fenced by stopped.
export class GrokVoice {
  private proposals: CountingProposals;
  private stopped = false;
  private acceptedAtFailure = false;
  private started = false;
  private abort = new AbortController();
  private socket?: WebSocket;
  private stream?: MediaStream;
  private context?: AudioContext;
  private microphone?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private configurationInstructions?: string;
  private pendingInstructions?: string;
  private openingSent = false;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private continuation?: {
    reason: ContinuationReason;
    responseId?: string;
    timer: ReturnType<typeof setTimeout>;
  };
  private playbackItems = new Map<AudioBufferSourceNode, PlaybackIdentity>();
  private feedbackResponseTimer?: ReturnType<typeof setTimeout>;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private questionPending = false;
  private proposalTimer?: ReturnType<typeof setTimeout>;
  private microphoneEnded = () =>
    this.fail(
      "The microphone disconnected or its permission was revoked. Reconnect it, allow microphone access, and press Start again.",
    );
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private item?: { id: string; contentIndex: number; segments: { start: number; duration: number }[] };
  private interrupted = false;
  private blockedResponses = new Set<string>();
  private responseId?: string;
  private state: VoiceSnapshot = { status: "connecting", output: "idle", transcripts: [] };

  constructor(
    private changed: (snapshot: VoiceSnapshot) => void,
    readonly acknowledgmentMode: AcknowledgmentMode = "grok-only",
  ) {
    this.proposals = new CountingProposals(crypto.randomUUID(), acknowledgmentMode, undefined, () => {
      if (!this.stopped) this.emit();
    });
  }
  private emit() {
    this.changed({
      ...this.state,
      acknowledgmentMode: this.acknowledgmentMode,
      feedbackStatus: this.proposals.feedbackStatus,
      feedbackDelivered: !!this.proposals.state.feedbackDelivered,
      classifierModel: this.acknowledgmentMode === "grok-jev" ? ACK_MODEL : null,
      nodeId: this.proposals.state.nodeId,
      render: this.proposals.state.pendingRender?.identity,
      complete: this.proposals.state.lessonComplete,
      diagnostics: this.proposals.correlationDiagnostics,
      decisionTimeline: this.proposals.decisionTimeline,
      proposal: this.proposals.lastResult,
      answerAccepted: this.proposals.state.answerAccepted,
      learnerAnswerAccepted: this.acceptedAtFailure || this.proposals.learnerAnswerAccepted,
      transcripts: this.state.transcripts.map(t => ({ ...t })),
    });
  }
  private send(event: object) {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }
  private fail(message: string, reason: DecisionReason = "connection-failure") {
    if (this.stopped) return;
    const accepted = this.proposals.learnerAnswerAccepted;
    this.proposals.recordDecision("lesson.failed", reason);
    this.stop("failure");
    // Terminal diagnostic only. The stopped reducer retains no progression authority.
    this.acceptedAtFailure = accepted;
    this.state.status = "error";
    this.state.error = message;
    this.emit();
  }
  private cancelContinuation(reason: DecisionReason) {
    const continuation = this.continuation;
    if (!continuation) return;
    clearTimeout(continuation.timer);
    this.continuation = undefined;
    this.proposals.recordDecision("continuation.cancelled", reason);
  }
  private requestContinuation(reason: ContinuationReason, instructions: string) {
    if (this.stopped || this.continuation) return;
    this.proposals.recordDecision("continuation.requested", reason);
    this.continuation = {
      reason,
      timer: setTimeout(() => this.continuationTimeout("continuation-never-started"), CONTINUATION_START_TIMEOUT_MS),
    };
    this.send({ type: "response.create", response: { instructions } });
  }
  private continuationTimeout(reason: "continuation-never-started" | "continuation-incomplete") {
    if (this.stopped || !this.continuation) return;
    this.continuation = undefined;
    this.proposals.recordDecision("continuation.timed-out", reason);
    this.fail(
      reason === "continuation-never-started"
        ? "Tutor continuation did not start in time. The scene cannot advance. Press Start to restart."
        : "Tutor continuation did not complete in time. The scene cannot advance. Press Start to restart.",
      reason,
    );
  }
  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.emit();
    this.timer = setTimeout(() => this.fail("Voice connection timed out. Stop and try again."), 25_000);
    try {
      // Create/resume during the Start gesture, before any network await.
      const context = (this.context = new AudioContext({ sampleRate: 24000 }));
      await context.resume();
      if (this.stopped) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (this.stopped) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const tracks = stream.getAudioTracks();
      tracks.forEach(track => track.addEventListener("ended", this.microphoneEnded));
      if (!tracks.length || tracks.some(track => track.readyState === "ended")) {
        this.microphoneEnded();
        return;
      }
      await context.audioWorklet.addModule("/experiments/grok-counting/microphone.js");
      if (this.stopped) return;
      this.microphone = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, "grok-microphone");
      this.worklet.port.onmessage = event => {
        if (!this.stopped && this.ready) {
          if ((this.socket?.bufferedAmount ?? 0) > 1_000_000) {
            this.fail("Voice connection is too slow. Please restart.");
            return;
          }
          this.send({ type: "input_audio_buffer.append", audio: encodePcm(event.data) });
        }
      };
      this.microphone.connect(this.worklet);
      // Processor outputs silence; connecting keeps capture running without mic feedback.
      this.worklet.connect(context.destination);
      const response = await fetch("/api/experiments/grok-counting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: this.abort.signal,
      });
      const credential = await response.json();
      if (this.stopped) return;
      if (!response.ok) {
        this.fail(typeof credential.error === "string" ? credential.error : "Voice authorization failed.");
        return;
      }
      if (
        typeof credential.value !== "string" ||
        !credential.value ||
        !Number.isFinite(credential.expires_at) ||
        credential.expires_at <= Date.now() / 1000
      )
        throw new Error("Invalid token");
      const socket = (this.socket = new WebSocket(`wss://api.x.ai/v1/realtime?model=${GROK_MODEL}`, [
        `xai-client-secret.${credential.value}`,
      ]));
      socket.onmessage = event => {
        if (this.stopped) return;
        try {
          this.receive(JSON.parse(event.data));
        } catch {
          this.fail("The voice service sent an unreadable response. Please restart.");
        }
      };
      socket.onerror = () => this.fail("Could not connect to xAI voice. Check your connection and model access.");
      socket.onclose = () => this.fail("The voice connection closed. Press Start to begin a new conversation.");
    } catch {
      this.fail("Could not start voice. Allow microphone access and check the local server and audio device.");
    }
  }
  private receive(event: {
    type?: string;
    session?: {
      model?: string;
      instructions?: string;
      turn_detection?: { type?: string | null };
      tools?: unknown[];
      audio?: {
        input?: { format?: { type?: string; rate?: number }; transcription?: { model?: string } };
        output?: { format?: { type?: string; rate?: number } };
      };
    };
    response?: { id?: string; status?: string };
    call_id?: unknown;
    name?: unknown;
    arguments?: unknown;
    response_id?: string;
    item_id?: string;
    content_index?: number;
    transcript?: string;
    delta?: string;
  }) {
    const type = event.type ?? "";
    if ((type === "session.created" || type === "session.updated") && typeof event.session?.model === "string")
      this.state.echoedModel = event.session.model;
    // Default/early updates are not proof that our configuration was applied.
    // xAI echoes configuration fields, not a client request/event ID.
    if (type === "session.created" && !this.configurationInstructions) {
      this.configurationInstructions = this.nodeInstructions();
      this.configureNextTurn();
    }
    const session = event.session;
    if (
      type === "session.updated" &&
      !this.ready &&
      this.pendingInstructions &&
      session?.instructions === this.pendingInstructions &&
      session.turn_detection?.type === "server_vad" &&
      Array.isArray(session.tools) &&
      echoesTools(session.tools) &&
      session.audio?.input?.format?.type === "audio/pcm" &&
      session.audio.input.format.rate === this.context?.sampleRate &&
      session.audio.input.transcription?.model === "grok-transcribe" &&
      session.audio.output?.format?.type === "audio/pcm" &&
      session.audio.output.format.rate === 24000
    ) {
      this.ready = true;
      this.proposals.acknowledgeContext();
      clearTimeout(this.timer);
      this.state.status = "listening";
      if (!this.openingSent) {
        this.openingSent = true;
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: COUNTING_LESSON.tutor.startInstruction }],
          },
        });
        this.send({ type: "response.create" });
      } else if (this.questionPending) {
        this.questionPending = false;
        this.send({
          type: "response.create",
          response: {
            instructions: `${this.configurationInstructions}\nThe application has confirmed this exact new scene is rendered. Ask its question once now, without tools, then listen.`,
          },
        });
      }
    }
    if (type === "error") {
      this.fail("xAI rejected the voice session. Check model access and restart.");
      return;
    }
    if (
      type === "response.created" &&
      this.proposals.state.phase === "active" &&
      this.proposals.responseCreated(event.response?.id)
    ) {
      clearTimeout(this.feedbackResponseTimer);
      this.feedbackResponseTimer = undefined;
      this.responseId = event.response?.id;
      this.interrupted = false;
      const continuation = this.continuation;
      if (continuation) {
        if (continuation.responseId || !this.proposals.responseBound) this.cancelContinuation("superseded-response");
        else {
          clearTimeout(continuation.timer);
          continuation.responseId = this.responseId;
          continuation.timer = setTimeout(
            () => this.continuationTimeout("continuation-incomplete"),
            CONTINUATION_COMPLETE_TIMEOUT_MS,
          );
          this.proposals.recordDecision("continuation.started", continuation.reason);
        }
      }
    }
    if (type === "input_audio_buffer.speech_started") {
      clearTimeout(this.feedbackResponseTimer);
      this.feedbackResponseTimer = undefined;
      this.cancelContinuation("interrupted");
      if (this.proposals.state.phase === "rendering") {
        this.fail("Speech interrupted the scene change. Press Start to begin again.");
        return;
      }
      this.proposals.speechStarted(event.item_id);
      this.interrupted = true;
      if (this.responseId) this.blockedResponses.add(this.responseId);
      const item = this.item;
      if (item && this.context)
        this.send({
          type: "conversation.item.truncate",
          item_id: item.id,
          content_index: item.contentIndex,
          audio_end_ms: Math.floor(
            item.segments.reduce(
              (played, segment) =>
                played + Math.min(segment.duration, Math.max(0, this.context!.currentTime - segment.start)),
              0,
            ) * 1000,
          ),
        });
      this.clearPlayback();
    }
    if (type === "input_audio_buffer.speech_stopped") this.proposals.speechStopped(event.item_id);
    if (type === "response.function_call_arguments.done") this.proposals.call(event);
    if (type === "response.done") {
      const delivered = this.proposals.responseDone(event.response?.id, event.response?.status);
      const continuation = this.continuation;
      if (delivered && continuation?.responseId && event.response?.id === continuation.responseId) {
        clearTimeout(continuation.timer);
        this.continuation = undefined;
        this.proposals.recordDecision(
          event.response.status === "completed" ? "continuation.completed" : "continuation.cancelled",
          event.response.status === "completed" ? continuation.reason : "cancelled",
        );
      }
    }
    if (
      type === "conversation.item.input_audio_transcription.updated" ||
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      if (typeof event.item_id === "string" && typeof event.transcript === "string")
        this.transcript(event.item_id, "Learner", event.transcript, type.endsWith("completed"));
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta" ||
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      if (
        typeof event.item_id === "string" &&
        event.response_id === this.responseId &&
        !this.blockedResponses.has(event.response_id!)
      ) {
        const final = type.endsWith("done");
        const old = this.state.transcripts.find(t => t.id === event.item_id)?.text ?? "";
        const text = final ? event.transcript : typeof event.delta === "string" ? old + event.delta : undefined;
        if (typeof text === "string" && text.trim()) this.proposals.spoken(event.response_id ?? this.responseId);
        if (typeof text === "string") this.transcript(event.item_id, "Tutor", text, final, event.response_id);
      }
    }
    if (
      (type === "response.output_audio.delta" || type === "response.audio.delta") &&
      this.proposals.state.phase === "active" &&
      event.response_id === this.responseId &&
      !this.interrupted &&
      !(event.response_id && this.blockedResponses.has(event.response_id)) &&
      typeof event.delta === "string" &&
      typeof event.item_id === "string"
    )
      this.play(event.delta, event.item_id, event.content_index ?? 0);
    this.advanceTools();
    // audio.done/response.done mean generation ended, not that scheduled audio drained.
    this.emit();
  }
  private transcript(id: string, speaker: Transcript["speaker"], text: string, final: boolean, responseId?: string) {
    const old = this.state.transcripts.find(t => t.id === id);
    if (old?.final && !final) return;
    this.proposals.transcript({ id, speaker, text, final }, responseId);
    if (old) Object.assign(old, { text, final });
    else this.state.transcripts.push({ id, speaker, text, final });
  }
  private nodeInstructions() {
    const node = COUNTING_LESSON.nodes[this.proposals.state.nodeId];
    return [
      COUNTING_LESSON.tutor.persona,
      COUNTING_LESSON.tutor.sessionGuidance,
      COUNTING_LESSON.tutor.nodeInstruction,
      `Current screen: ${JSON.stringify(node.presentation)}.`,
      node.learningObjective,
      node.tutorBrief,
      OUTCOME_TOOL.description,
      "Use only the configured application token for this learner turn. Tokens are not learner evidence. Report the entire utterance. Acknowledge a correct answer with its number and object, then pause. Tools propose only; never announce a next scene or ask its question until the application supplies confirmed new screen context. Do not report tutor acknowledgment through the tool.",
    ].join("\n");
  }
  confirmRender(identity: RenderIdentity) {
    if (this.stopped || !this.proposals.confirmRender(identity)) return;
    if (this.proposals.state.phase === "complete") {
      this.stop("lesson-complete");
      this.state.status = "complete";
      this.emit();
      return;
    }
    this.configurationInstructions = this.nodeInstructions();
    this.questionPending = true;
    this.pendingInstructions = undefined;
    this.configureNextTurn();
    this.emit();
  }
  private configureNextTurn() {
    // A response ending does not consume the next learner-turn reservation.
    // Keep pending/acknowledged context and microphone readiness until speech
    // claims it, or an explicit invalidation/scene transition replaces it.
    if (this.stopped || this.proposals.hasReservedContext || (!this.ready && this.pendingInstructions)) return;
    const context = this.proposals.issueContext();
    if (!context) return;
    this.ready = false;
    this.state.status = "connecting";
    this.pendingInstructions = `${this.configurationInstructions}\nApplication token for the NEXT learner speech turn only: ${context}. Use it for that turn's report, quoting the entire learner utterance you actually heard. It expires when another learner turn starts. Never call tools during the opening greeting or a continuation. This token is application data, not learner evidence.`;
    this.send({
      type: "session.update",
      session: {
        voice: "eve",
        tools: [OUTCOME_TOOL],
        turn_detection: { type: "server_vad" },
        instructions: this.pendingInstructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: this.context!.sampleRate },
            transcription: { model: "grok-transcribe" },
          },
          output: { format: { type: "audio/pcm", rate: 24000 } },
        },
      },
    });
    if (this.openingSent) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.fail("Voice configuration timed out. Stop and try again."), 25_000);
    }
  }
  private advanceTools() {
    if (this.stopped) return;
    if (this.proposals.endRequested) {
      this.stop("learner-request");
      this.state.error = "Experiment ended at the learner's request; no correct-answer credit.";
      this.emit();
      return;
    }
    for (const result of this.proposals.drainResults())
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: result.call_id,
          output: JSON.stringify({ status: result.status, reason: result.reason }),
        },
      });
    this.proposals.tick();
    if (!this.proposals.feedbackResponsePending) {
      clearTimeout(this.feedbackResponseTimer);
      this.feedbackResponseTimer = undefined;
    } else if (!this.feedbackResponseTimer) {
      const responseId = this.responseId;
      this.feedbackResponseTimer = setTimeout(() => {
        this.feedbackResponseTimer = undefined;
        if (!this.stopped && this.responseId === responseId && this.proposals.feedbackResponsePending) {
          this.proposals.recordDecision("response.timed-out", "stalled-response");
          this.fail(
            "Tutor feedback response stalled. The learner answer was recorded, but the scene cannot advance. Press Start to restart.",
            "stalled-response",
          );
        }
      }, CONTINUATION_COMPLETE_TIMEOUT_MS);
    }
    clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
    if (this.proposals.state.phase === "rendering") {
      this.cancelContinuation("scene-transition");
      this.ready = false;
      if (this.responseId) this.blockedResponses.add(this.responseId);
      this.responseId = undefined;
      return;
    }
    if (this.proposals.state.quietSinceMs !== null && this.proposals.state.feedbackDelivered && !this.sources.size) {
      this.drainTimer = setTimeout(() => {
        this.advanceTools();
        this.emit();
      }, 260);
    }
    if (this.proposals.hasPending && !this.proposalTimer)
      this.proposalTimer = setTimeout(() => {
        this.proposalTimer = undefined;
        this.proposals.expirePending();
        this.advanceTools();
        this.emit();
      }, 1500);
    if (!this.proposals.hasPending) {
      clearTimeout(this.proposalTimer);
      this.proposalTimer = undefined;
    }
    if (!this.proposals.recoveryReason || this.sources.size) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
    } else {
      if (!this.recoveryTimer)
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = undefined;
          const reason = this.proposals.recoveryReason;
          const recovery = this.proposals.takeRecovery();
          if (recovery) {
            const instruction =
              recovery === "missing-report"
                ? "No usable report arrived. Ask once for the learner to repeat or clarify, without giving a count or claiming success."
                : "The learner's correct answer was already validated. Deliver brief accurate feedback once, then pause. Do not ask the learner to repeat or answer again.";
            this.requestContinuation(
              recovery,
              `${this.configurationInstructions}\n${instruction} Do not call any tools. Do not announce a new scene.`,
            );
          } else if (this.proposals.recoveryExhausted) {
            const message =
              reason === "missing-report"
                ? "No usable counting report after one retry. Press Start to restart, or leave the experiment."
                : reason === "contradictory-feedback"
                  ? "Tutor feedback contradicted the validated answer. The learner answer was recorded, but the scene cannot advance. Press Start to restart."
                  : reason === "missing-feedback-audio"
                    ? "Tutor feedback audio could not be verified. The learner answer was recorded, but the scene cannot advance. Press Start to restart."
                    : "Tutor feedback could not be verified. The learner answer was recorded, but the scene cannot advance. Press Start to restart.";
            this.fail(message, reason);
          }
          this.emit();
        }, 3000);
      return;
    }
    if (!this.ready) return;
    if (this.sources.size) {
      // Generation can be complete while playback drains. Prepare the next turn
      // then, so the acknowledgment round trip usually overlaps local audio.
      this.configureNextTurn();
      return;
    }
    const continuation = this.proposals.takeContinuation();
    if (continuation) {
      const instruction =
        continuation === "recovery"
          ? "The tool report was rejected. It establishes no success. Gently ask the learner to try again or clarify without supplying a count."
          : "The learner answer proposal was recorded. Respond naturally once.";
      this.requestContinuation(
        continuation === "accepted" ? "accepted-tool-only" : "rejected-tool-only",
        `${this.configurationInstructions}\n${instruction} Do not call any tools in this continuation. Do not announce a new scene.`,
      );
    } else this.configureNextTurn();
  }
  private play(encoded: string, itemId: string, contentIndex: number) {
    const context = this.context!;
    const binary = atob(encoded);
    if (!binary.length) return;
    if (binary.length % 2) throw new Error("Invalid PCM");
    const buffer = context.createBuffer(1, binary.length / 2, 24000);
    const samples = buffer.getChannelData(0);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const start = Math.max(context.currentTime, this.nextTime);
    this.nextTime = start + buffer.duration;
    if (this.item?.id !== itemId) this.item = { id: itemId, contentIndex, segments: [] };
    this.item.segments.push({ start, duration: buffer.duration });
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const audio = this.proposals.playbackIdentity(itemId);
    const alreadyPlaying = [...this.playbackItems.values()].some(
      item => item.response === audio.response && item.item === audio.item,
    );
    this.sources.add(source);
    this.playbackItems.set(source, audio);
    this.proposals.spoken(this.responseId);
    this.proposals.output(true, itemId);
    this.state.output = "playing";
    source.onended = () => {
      if (!this.sources.delete(source)) return;
      source.disconnect();
      this.playbackItems.delete(source);
      if (this.stopped) return;
      const itemDrained = ![...this.playbackItems.values()].some(
        item => item.response === audio.response && item.item === audio.item,
      );
      if (!this.sources.size) {
        this.proposals.output(false);
        this.state.output = "idle";
      }
      if (itemDrained) {
        this.proposals.playbackDrained(audio);
        this.proposals.recordDecision("audio.drained", "local-playback", audio);
      }
      if (!this.sources.size) this.advanceTools();
      if (itemDrained || !this.sources.size) this.emit();
    };
    source.start(start);
    if (!alreadyPlaying) this.proposals.recordDecision("audio.started", "local-playback", audio);
  }
  private clearPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    for (const audio of new Map(
      [...this.playbackItems.values()].map(item => [`${item.response}:${item.item}`, item]),
    ).values())
      this.proposals.recordDecision("audio.cleared", "playback-cleared", audio);
    this.playbackItems.clear();
    this.sources.clear();
    this.item = undefined;
    this.nextTime = 0;
    this.state.output = "idle";
    this.proposals.output(false);
  }
  stop(reason: "user-stop" | "failure" | "lesson-complete" | "learner-request" = "user-stop") {
    if (this.stopped) return;
    this.cancelContinuation(
      reason === "failure" ? "connection-failure" : reason === "lesson-complete" ? "scene-transition" : reason,
    );
    if (reason === "user-stop" || reason === "learner-request") this.proposals.recordDecision("lesson.stopped", reason);
    this.stopped = true;
    this.proposals.stop(
      reason === "failure" ? "connection-failure" : reason === "lesson-complete" ? "scene-transition" : reason,
    );
    clearTimeout(this.timer);
    clearTimeout(this.proposalTimer);
    clearTimeout(this.drainTimer);
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.feedbackResponseTimer);
    this.abort.abort();
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
    }
    this.stream?.getAudioTracks().forEach(track => track.removeEventListener("ended", this.microphoneEnded));
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
      this.worklet.disconnect();
    }
    this.microphone?.disconnect();
    this.clearPlayback();
    void this.context?.close().catch(() => {});
    this.state.status = "stopped";
    this.emit();
  }
}
