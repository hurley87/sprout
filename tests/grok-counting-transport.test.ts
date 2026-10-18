import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodePcm, GrokVoice, type VoiceSnapshot } from "../lib/experiments/grok-counting/transport";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    Socket.instances.push(this);
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  event(value: object) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
function microphoneTrack() {
  const events = new EventTarget();
  return {
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    end() {
      this.readyState = "ended";
      events.dispatchEvent(new Event("ended"));
    },
  };
}
let track = microphoneTrack();
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const sourceNode = () => ({
  ...node(),
  buffer: {},
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as (() => void) | null,
});
class Context {
  static instances: Context[] = [];
  sampleRate = 24000;
  currentTime = 10;
  destination = {};
  microphone = node();
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  sources: ReturnType<typeof sourceNode>[] = [];
  constructor() {
    Context.instances.push(this);
  }
  createMediaStreamSource() {
    return this.microphone;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const source = sourceNode();
    this.sources.push(source);
    return source;
  }
}
class Worklet {
  static instances: Worklet[] = [];
  connect = vi.fn();
  disconnect = vi.fn();
  port = { onmessage: null as ((e: { data: Float32Array }) => void) | null, close: vi.fn() };
  constructor() {
    Worklet.instances.push(this);
  }
}
let updates: VoiceSnapshot[];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
beforeEach(() => {
  updates = [];
  Socket.instances = [];
  Context.instances = [];
  Worklet.instances = [];
  track = microphoneTrack();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ value: "ephemeral", expires_at: Date.now() / 1000 + 60 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function connected() {
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  const socket = Socket.instances[0];
  socket.onopen?.();
  socket.event({ type: "session.created", session: { model: "echoed-model" } });
  socket.event({ type: "session.updated", session: socket.sent[0].session });
  return { voice, socket, context: Context.instances[0], worklet: Worklet.instances[0] };
}
it("configures the fixed scene, starts once after acknowledgment and streams PCM", async () => {
  const { voice, socket, worklet } = await connected();
  expect(socket.url).toContain("model=grok-voice-3.0");
  expect(socket.protocols).toEqual(["xai-client-secret.ephemeral"]);
  expect(socket.sent[0]).toMatchObject({
    type: "session.update",
    session: { tools: [{ name: "report_counting_answer" }], audio: { input: { format: { rate: 24000 } } } },
  });
  expect(JSON.stringify(socket.sent[0])).toContain("hello-duck");
  socket.event({ type: "session.updated", session: socket.sent[0].session });
  socket.event({ type: "session.created" });
  expect(socket.sent.filter(e => e.type === "session.update")).toHaveLength(1);
  expect(socket.sent.filter(e => e.type === "conversation.item.create")).toHaveLength(1);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  worklet.port.onmessage?.({ data: new Float32Array([0, 1, -1]) });
  expect(socket.sent.at(-1)).toEqual({
    type: "input_audio_buffer.append",
    audio: encodePcm(new Float32Array([0, 1, -1])),
  });
  expect(updates.at(-1)?.echoedModel).toBe("echoed-model");
  voice.stop();
});
it("replaces cumulative learner revisions and final tutor captions without duplication", async () => {
  const { voice, socket } = await connected();
  for (const [type, transcript] of [
    ["updated", "won"],
    ["updated", "one duck"],
    ["completed", "One duck."],
  ])
    socket.event({ type: `conversation.item.input_audio_transcription.${type}`, item_id: "u", transcript });
  socket.event({ type: "response.output_audio_transcript.delta", item_id: "a", delta: "Yes" });
  socket.event({ type: "response.output_audio_transcript.done", item_id: "a", transcript: "Yes, one duck." });
  expect(updates.at(-1)?.transcripts).toEqual([
    { id: "u", speaker: "Learner", text: "One duck.", final: true },
    { id: "a", speaker: "Tutor", text: "Yes, one duck.", final: true },
  ]);
  voice.stop();
});
it("drains audio independently of generation completion and truncates interrupted playback", async () => {
  const { voice, socket, context } = await connected();
  socket.event({ type: "response.created", response: { id: "r" } });
  const audio = {
    type: "response.output_audio.delta",
    item_id: "a",
    response_id: "r",
    delta: btoa("\0".repeat(48000)),
  };
  socket.event(audio);
  socket.event(audio);
  socket.event({ type: "response.output_audio.done" });
  socket.event({ type: "response.done" });
  expect(updates.at(-1)?.output).toBe("playing");
  context.currentTime = 10.25;
  socket.event({ type: "input_audio_buffer.speech_started" });
  expect(socket.sent.at(-1)).toEqual({
    type: "conversation.item.truncate",
    item_id: "a",
    content_index: 0,
    audio_end_ms: 250,
  });
  expect(context.sources.every(s => s.stop.mock.calls.length === 1)).toBe(true);
  socket.event(audio);
  expect(context.sources).toHaveLength(2);
  socket.event({ type: "response.created", response: { id: "r2" } });
  socket.event(audio);
  expect(context.sources).toHaveLength(2);
  socket.event({ ...audio, item_id: "b", response_id: "r2" });
  context.sources.at(-1)?.onended?.();
  expect(updates.at(-1)?.output).toBe("idle");
  voice.stop();
});
it("releases every resource and fences captured late callbacks after stop", async () => {
  const { voice, socket, context, worklet } = await connected();
  const late = socket.onmessage!;
  const mic = worklet.port.onmessage!;
  socket.event({ type: "response.audio.delta", item_id: "a", delta: "AAA=" });
  voice.stop();
  const count = updates.length;
  const sent = socket.sent.length;
  late({ data: JSON.stringify({ type: "session.updated" }) });
  mic({ data: new Float32Array([1]) });
  voice.stop();
  expect(updates).toHaveLength(count);
  expect(socket.sent).toHaveLength(sent);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(socket.close).toHaveBeenCalledOnce();
  expect(worklet.port.close).toHaveBeenCalledOnce();
  expect(worklet.disconnect).toHaveBeenCalledOnce();
  expect(context.microphone.disconnect).toHaveBeenCalledOnce();
  expect(context.sources[0].stop).toHaveBeenCalledOnce();
  expect(updates.at(-1)?.status).toBe("stopped");
});
it("stops a microphone acquired after cancellation without opening a socket", async () => {
  let resolve!: (value: typeof stream) => void;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise(r => {
          resolve = r;
        }),
    },
  });
  const voice = new GrokVoice(s => updates.push(s));
  const pending = voice.start();
  await flush();
  voice.stop();
  resolve(stream);
  await pending;
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Socket.instances).toHaveLength(0);
});
it("fences authorization completion after stop", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const voice = new GrokVoice(s => updates.push(s));
  const pending = voice.start();
  await flush();
  voice.stop();
  resolve(Response.json({ value: "late", expires_at: Date.now() / 1000 + 60 }));
  await pending;
  expect(Socket.instances).toHaveLength(0);
});
it("times out stalled startup and reports disconnects with cleanup", async () => {
  vi.useFakeTimers();
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  vi.advanceTimersByTime(25_000);
  expect(updates.at(-1)?.status).toBe("error");
  expect(track.stop).toHaveBeenCalledOnce();
});
it("reports disconnects with cleanup", async () => {
  const connection = await connected();
  connection.socket.onclose?.();
  expect(updates.at(-1)?.error).toContain("closed");
});

it("keeps cumulative played duration across drained chunks and excludes scheduling gaps", async () => {
  const { voice, socket, context } = await connected();
  const audio = { type: "response.output_audio.delta", item_id: "a", delta: btoa("\0".repeat(48000)) };
  socket.event(audio);
  context.currentTime = 11;
  context.sources[0].onended?.();
  context.currentTime = 12;
  socket.event(audio);
  context.currentTime = 12.25;
  socket.event({ type: "input_audio_buffer.speech_started" });
  expect(socket.sent.at(-1)).toMatchObject({ type: "conversation.item.truncate", audio_end_ms: 1250 });
  voice.stop();
});
it("does not restart a stopped or already-started instance", async () => {
  const { voice } = await connected();
  await voice.start();
  voice.stop();
  await voice.start();
  expect(Socket.instances).toHaveLength(1);
  expect(Context.instances).toHaveLength(1);
});

it("ignores premature/default updates and gates microphone and opening until our configuration is acknowledged", async () => {
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  const socket = Socket.instances[0];
  const worklet = Worklet.instances[0];
  socket.onopen?.();
  socket.event({ type: "session.updated", session: { instructions: "default" } });
  worklet.port.onmessage?.({ data: new Float32Array([1]) });
  expect(socket.sent).toHaveLength(0);
  expect(updates.at(-1)?.status).toBe("connecting");
  socket.event({ type: "session.created", session: { instructions: "" } });
  expect(socket.sent).toHaveLength(1);
  const intended = socket.sent[0].session as Record<string, unknown>;
  for (const session of [
    {},
    { ...intended, instructions: "default" },
    { ...intended, turn_detection: { type: null } },
    { ...intended, tools: [{ type: "function" }] },
    { ...intended, tools: [] },
    {
      ...intended,
      audio: {
        input: { format: { type: "audio/pcm", rate: 48000 } },
        output: { format: { type: "audio/pcm", rate: 24000 } },
      },
    },
    {
      ...intended,
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "grok-transcribe" } },
        output: { format: { type: "audio/pcmu" } },
      },
    },
    {
      ...intended,
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 } },
        output: { format: { type: "audio/pcm", rate: 24000 } },
      },
    },
  ]) {
    socket.event({ type: "session.updated", session });
    worklet.port.onmessage?.({ data: new Float32Array([1]) });
    expect(socket.sent).toHaveLength(1);
    expect(updates.at(-1)?.status).toBe("connecting");
  }
  // Real provider echoes may add defaults and omit voice; compare supported configuration fields.
  const { voice: omittedVoice, ...echo } = intended;
  void omittedVoice;
  socket.event({
    type: "session.updated",
    session: {
      ...echo,
      tools: [...(echo.tools as object[])].map(tool => Object.fromEntries(Object.entries(tool).reverse())),
      model: "echoed",
      extra_default: true,
    },
  });
  expect(updates.at(-1)?.status).toBe("listening");
  expect(socket.sent.map(e => e.type)).toEqual(["session.update", "conversation.item.create", "response.create"]);
  worklet.port.onmessage?.({ data: new Float32Array([1]) });
  expect(socket.sent.at(-1)?.type).toBe("input_audio_buffer.append");
  voice.stop();
});
it("keeps the startup deadline active after an unacknowledged update", async () => {
  vi.useFakeTimers();
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  const socket = Socket.instances[0];
  socket.event({ type: "session.created" });
  socket.event({ type: "session.updated", session: { instructions: "default" } });
  vi.advanceTimersByTime(25_000);
  expect(updates.at(-1)?.error).toContain("timed out");
  expect(socket.close).toHaveBeenCalledOnce();
});
it("ends the session and disposes playback, connection and microphone listeners when a track ends unexpectedly", async () => {
  const { voice, socket, context, worklet } = await connected();
  socket.event({ type: "response.output_audio.delta", item_id: "a", delta: "AAA=" });
  track.end();
  expect(updates.at(-1)?.status).toBe("error");
  expect(updates.at(-1)?.error).toContain("microphone disconnected");
  expect(track.stop).toHaveBeenCalledOnce();
  expect(track.removeEventListener).toHaveBeenCalledWith("ended", track.addEventListener.mock.calls[0][1]);
  expect(socket.close).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(context.sources[0].stop).toHaveBeenCalledOnce();
  expect(worklet.port.close).toHaveBeenCalledOnce();
  voice.stop();
});
it("removes the ended listener before intentional Stop and ignores queued termination callbacks", async () => {
  const { voice } = await connected();
  const handler = track.addEventListener.mock.calls[0][1] as () => void;
  track.stop.mockImplementation(() => track.end());
  voice.stop();
  handler();
  expect(track.removeEventListener).toHaveBeenCalledOnce();
  expect(updates.at(-1)?.status).toBe("stopped");
  expect(updates.at(-1)?.error).toBeUndefined();
});
it("handles microphone termination while startup is pending", async () => {
  let release!: () => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>(resolve => {
        release = () => resolve(Response.json({ value: "late", expires_at: Date.now() / 1000 + 60 }));
      }),
  );
  const voice = new GrokVoice(s => updates.push(s));
  const pending = voice.start();
  await flush();
  track.end();
  release();
  await pending;
  expect(updates.at(-1)?.error).toContain("microphone disconnected");
  expect(Socket.instances).toHaveLength(0);
});
it("rejects an already-ended microphone instead of waiting for an event", async () => {
  track.readyState = "ended";
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  expect(updates.at(-1)?.error).toContain("microphone disconnected");
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Socket.instances).toHaveLength(0);
});

function propose(socket: Socket, id = "call1", changes = {}) {
  const session = socket.sent.find(e => e.type === "session.update")!.session as { instructions: string };
  const token = JSON.parse(session.instructions.match(/(\{"context_token".*?\})/)![1]).context_token;
  socket.event({
    type: "response.function_call_arguments.done",
    response_id: "tools",
    call_id: id,
    name: "report_counting_answer",
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      support_state: "none",
      supporting_text: "One duck.",
      ...changes,
    }),
  });
}
function learnerAnswer(socket: Socket, transcript = "One duck.") {
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
  socket.event({ type: "response.created", response: { id: "tools" } });
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "learner",
    transcript,
  });
}
it("delivers a wire tool proposal and acknowledges once, continuing only after completed tool-only output", async () => {
  const { voice, socket } = await connected();
  learnerAnswer(socket);
  propose(socket);
  expect(updates.at(-1)?.answerAccepted).toBe(false);
  expect(updates.at(-1)?.proposal).toContain("Validated: correct");
  const outputs = () => socket.sent.filter(e => (e.item as { type?: string })?.type === "function_call_output");
  expect(outputs()).toHaveLength(1);
  propose(socket);
  expect(outputs()).toHaveLength(1);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  expect(updates.at(-1)?.answerAccepted).toBe(true);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(1); // Only ephemeral authorization.
  voice.stop();
});
it("acknowledges rejection with one recovery and ignores delayed calls after Stop", async () => {
  const { voice, socket } = await connected();
  learnerAnswer(socket);
  propose(socket, "wrong", { supporting_text: "Yes, one duck." });
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  expect(updates.at(-1)?.answerAccepted).toBe(false);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  const callback = socket.onmessage!;
  voice.stop();
  const count = socket.sent.length;
  callback({ data: JSON.stringify({ type: "response.function_call_arguments.done", call_id: "late" }) });
  expect(socket.sent).toHaveLength(count);
});
it("does not double-speak when a tool arrives alongside tutor audio", async () => {
  const { voice, socket, context } = await connected();
  learnerAnswer(socket);
  propose(socket);
  socket.event({ type: "response.output_audio.delta", response_id: "tools", item_id: "a", delta: "AAA=" });
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  context.sources[0].onended?.();
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  voice.stop();
});

it("retains the learner observation through real continuation events without restoring revision-bound acceptance", async () => {
  const { voice, socket } = await connected();
  learnerAnswer(socket);
  propose(socket);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  socket.event({ type: "response.created", response: { id: "continuation" } });
  socket.event({
    type: "response.output_audio_transcript.delta",
    response_id: "continuation",
    item_id: "a2",
    delta: "Yes, ",
  });
  socket.event({
    type: "response.output_audio_transcript.done",
    response_id: "continuation",
    item_id: "a2",
    transcript: "Yes, one duck.",
  });
  expect(updates.at(-1)).toMatchObject({ learnerAnswerAccepted: true, answerAccepted: false });
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "new" });
  expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
  voice.stop();
});
it("grounds calls emitted before final transcription, even when response.done arrives first", async () => {
  const { voice, socket } = await connected();
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
  socket.event({ type: "response.created", response: { id: "tools" } });
  propose(socket);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  expect(socket.sent.filter(e => (e.item as { type?: string })?.type === "function_call_output")).toHaveLength(0);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "learner",
    transcript: "One duck.",
  });
  expect(updates.at(-1)?.learnerAnswerAccepted).toBe(true);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  expect(socket.sent.filter(e => (e.item as { role?: string })?.role === "system")).toHaveLength(0);
  voice.stop();
});
it("expires missing final text once, recovers without success, and cannot loop on another tool failure", async () => {
  vi.useFakeTimers();
  const { voice, socket } = await connected();
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
  socket.event({ type: "response.created", response: { id: "tools" } });
  propose(socket);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  vi.advanceTimersByTime(1500);
  expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  socket.event({ type: "response.created", response: { id: "recovery" } });
  socket.event({
    type: "response.function_call_arguments.done",
    response_id: "recovery",
    call_id: "bad2",
    name: "unknown",
    arguments: "{}",
  });
  socket.event({ type: "response.done", response: { id: "recovery", status: "completed" } });
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  voice.stop();
});
it("rotates the next token at a response boundary and gates microphone on the exact new acknowledgment without replaying the opening", async () => {
  const { voice, socket, worklet } = await connected();
  learnerAnswer(socket);
  propose(socket, "incorrect", { answer_outcome: "unclear", supporting_text: "One duck." });
  // A rejected but already spoken response rotates context without extra speech.
  socket.event({
    type: "response.output_audio_transcript.done",
    response_id: "tools",
    item_id: "try",
    transcript: "Try again.",
  });
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  const configs = socket.sent.filter(e => e.type === "session.update");
  expect(configs).toHaveLength(2);
  const count = socket.sent.length;
  worklet.port.onmessage?.({ data: new Float32Array([1]) });
  socket.event({ type: "session.updated", session: configs[0].session });
  worklet.port.onmessage?.({ data: new Float32Array([1]) });
  expect(socket.sent).toHaveLength(count);
  socket.event({ type: "session.updated", session: configs[1].session });
  worklet.port.onmessage?.({ data: new Float32Array([1]) });
  expect(socket.sent.at(-1)?.type).toBe("input_audio_buffer.append");
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
  voice.stop();
});
it.each(["stop", "interrupt", "cancel"])("does not recover a waiting call after %s", async fault => {
  vi.useFakeTimers();
  const { voice, socket } = await connected();
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
  socket.event({ type: "response.created", response: { id: "tools" } });
  propose(socket);
  if (fault === "stop") voice.stop();
  if (fault === "interrupt") socket.event({ type: "input_audio_buffer.speech_started", item_id: "u2" });
  socket.event({ type: "response.done", response: { id: "tools", status: "cancelled" } });
  vi.advanceTimersByTime(1500);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
  voice.stop();
});

function tutor(socket: Socket, response: string, text: string, audio = true) {
  socket.event({
    type: "response.output_audio_transcript.done",
    response_id: response,
    item_id: `a-${response}`,
    transcript: text,
  });
  if (audio)
    socket.event({
      type: "response.output_audio.delta",
      response_id: response,
      item_id: `a-${response}`,
      delta: btoa("\0\0".repeat(2400)),
    });
}
it("completes all authored edges only after playback drain and exact render confirmation, then config acknowledgment", async () => {
  vi.useFakeTimers();
  const { voice, socket, context } = await connected();
  for (const [i, text, ack, next] of [
    [1, "One duck.", "Yes, one duck.", "count-2-ducks"],
    [2, "Two ducks.", "That's right, two ducks.", "count-3-butterflies"],
    [3, "Three butterflies.", "Three butterflies!", null],
  ] as const) {
    const user = `u-${i}`,
      response = `r-${i}`;
    const config = socket.sent.filter(e => e.type === "session.update").at(-1)!;
    const token = JSON.parse(
      (config.session as { instructions: string }).instructions.match(/(\{"context_token".*?\})/)![1],
    ).context_token;
    socket.event({ type: "input_audio_buffer.speech_started", item_id: user });
    socket.event({ type: "input_audio_buffer.speech_stopped", item_id: user });
    socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: user, transcript: text });
    socket.event({ type: "response.created", response: { id: response } });
    if (i > 1) socket.event({ type: "response.created", response: { id: `r-${i - 1}` } });
    // Alternate acknowledgment/tool event order, independently of audible drain.
    if (i !== 2) tutor(socket, response, ack);
    const call = {
      type: "response.function_call_arguments.done",
      name: "report_counting_answer",
      call_id: `c-${i}`,
      response_id: response,
      arguments: JSON.stringify({
        context_token: token,
        supporting_text: text,
        answer_outcome: "correct",
        support_state: "none",
      }),
    };
    socket.event(call);
    socket.event(call); // Duplicate never delivers another result or transition.
    if (i === 2) tutor(socket, response, ack);
    socket.event({ type: "response.done", response: { id: response, status: "completed" } });
    vi.advanceTimersByTime(1000);
    expect(updates.at(-1)?.render).toBeUndefined();
    expect(socket.sent.filter(e => e.type === "session.update")).toHaveLength(i);
    context.sources.at(-1)!.onended?.();
    vi.advanceTimersByTime(260);
    const identity = updates.at(-1)!.render!;
    expect(identity.nodeId).toBe(next);
    expect(socket.sent.filter(e => e.type === "session.update")).toHaveLength(i);
    voice.confirmRender({ ...identity, token: "stale" });
    voice.confirmRender({ ...identity, sceneId: "wrong-scene" });
    expect(socket.sent.filter(e => e.type === "session.update")).toHaveLength(i);
    const questions = socket.sent.filter(e => e.type === "response.create").length;
    voice.confirmRender(identity);
    voice.confirmRender(identity);
    if (next) {
      const updated = socket.sent.filter(e => e.type === "session.update").at(-1)!;
      expect(JSON.stringify(updated)).toContain(next === "count-2-ducks" ? "duck-friends" : "butterfly-garden");
      expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(questions);
      socket.event({ type: "session.updated", session: config.session });
      expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(questions);
      socket.event({ type: "session.updated", session: updated.session });
      socket.event({ type: "session.updated", session: updated.session });
      expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(questions + 1);
    } else {
      expect(updates.at(-1)).toMatchObject({ status: "complete", complete: true, output: "idle" });
      expect(socket.close).toHaveBeenCalledOnce();
      expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(questions);
    }
    // Old scene calls/transcripts cannot affect a new scene or repeat closing speech.
    socket.event(call);
    tutor(socket, response, "One duck.");
  }
  expect(fetch).toHaveBeenCalledTimes(1); // Authorization only, no classifier.
});
it.each(["correction", "interrupt", "cancel", "stop"])(
  "revokes pending success on %s during acknowledgment playback",
  async fault => {
    vi.useFakeTimers();
    const { voice, socket, context } = await connected();
    learnerAnswer(socket);
    propose(socket);
    tutor(socket, "tools", "Yes, one duck.");
    socket.event({
      type: "response.done",
      response: { id: "tools", status: fault === "cancel" ? "cancelled" : "completed" },
    });
    if (fault === "correction")
      socket.event({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "learner",
        transcript: "Two ducks.",
      });
    if (fault === "interrupt") socket.event({ type: "input_audio_buffer.speech_started", item_id: "u2" });
    if (fault === "stop") voice.stop();
    context.sources[0].onended?.();
    vi.advanceTimersByTime(5000);
    expect(updates.every(s => !s.render && s.nodeId === "count-1-duck")).toBe(true);
    expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
    voice.stop();
  },
);
it("bounds missing-call clarification to one retry and gives thinking pauses room", async () => {
  vi.useFakeTimers();
  const { voice, socket } = await connected();
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
  vi.advanceTimersByTime(60000);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  socket.event({ type: "response.created", response: { id: "tools" } });
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  vi.advanceTimersByTime(60000);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "learner",
    transcript: "One duck.",
  });
  vi.advanceTimersByTime(3000);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  socket.event({ type: "response.created", response: { id: "retry" } });
  tutor(socket, "retry", "Could you say that again?", false);
  socket.event({ type: "response.done", response: { id: "retry", status: "completed" } });
  const config = socket.sent.filter(e => e.type === "session.update").at(-1)!;
  socket.event({ type: "session.updated", session: config.session });
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "u2" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "u2" });
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u2",
    transcript: "One duck.",
  });
  socket.event({ type: "response.created", response: { id: "missing-again" } });
  socket.event({ type: "response.done", response: { id: "missing-again", status: "completed" } });
  vi.advanceTimersByTime(3000);
  expect(updates.at(-1)).toMatchObject({ status: "error", learnerAnswerAccepted: false });
  expect(updates.at(-1)?.error).toContain("one retry");
  vi.advanceTimersByTime(60000);
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(2);
  voice.stop();
});
it.each(["Move on", "Stop"])("ends %s without following an edge or granting success", async transcript => {
  const { voice, socket } = await connected();
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "u" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "u" });
  socket.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "u", transcript });
  expect(updates.at(-1)).toMatchObject({
    status: "stopped",
    learnerAnswerAccepted: false,
    answerAccepted: false,
    nodeId: "count-1-duck",
  });
  expect(socket.close).toHaveBeenCalledOnce();
  voice.stop();
});

it.each(["no audio", "generic praise", "question", "old response"])(
  "cannot advance with %s instead of grounded audible acknowledgment",
  async fault => {
    vi.useFakeTimers();
    const { voice, socket, context } = await connected();
    learnerAnswer(socket);
    propose(socket);
    tutor(
      socket,
      fault === "old response" ? "old" : "tools",
      fault === "generic praise" ? "Great job!" : fault === "question" ? "One duck?" : "Yes, one duck.",
      fault !== "no audio",
    );
    socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
    context.sources.at(-1)?.onended?.();
    vi.advanceTimersByTime(5000);
    expect(updates.every(s => !s.render && s.nodeId === "count-1-duck")).toBe(true);
    voice.stop();
  },
);
it("allows a grounded wrong answer then a correct fresh turn without crediting the wrong turn", async () => {
  vi.useFakeTimers();
  const { voice, socket, context } = await connected();
  learnerAnswer(socket, "Two ducks.");
  propose(socket, "wrong", { answer_outcome: "incorrect", supporting_text: "Two ducks." });
  tutor(socket, "tools", "Try again.", false);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  const configuration = socket.sent.filter(e => e.type === "session.update").at(-1)!;
  socket.event({ type: "session.updated", session: configuration.session });
  const token = JSON.parse(
    (configuration.session as { instructions: string }).instructions.match(/(\{"context_token".*?\})/)![1],
  ).context_token;
  socket.event({ type: "input_audio_buffer.speech_started", item_id: "u2" });
  socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "u2" });
  socket.event({ type: "response.created", response: { id: "correct" } });
  socket.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u2",
    transcript: "One duck.",
  });
  tutor(socket, "correct", "Yes, one duck.");
  socket.event({
    type: "response.function_call_arguments.done",
    response_id: "correct",
    call_id: "fresh",
    name: "report_counting_answer",
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      supporting_text: "One duck.",
      support_state: "none",
    }),
  });
  socket.event({ type: "response.done", response: { id: "correct", status: "completed" } });
  context.sources.at(-1)?.onended?.();
  vi.advanceTimersByTime(260);
  expect(updates.at(-1)?.render?.nodeId).toBe("count-2-ducks");
  voice.stop();
});

it("accepts the live nested function echo only with the entire exact tool definition and opens once", async () => {
  const voice = new GrokVoice(s => updates.push(s));
  await voice.start();
  const socket = Socket.instances[0];
  socket.event({ type: "session.created" });
  const expected = socket.sent[0].session as {
    tools: { type: string; name: string; description: string; parameters: unknown }[];
  };
  const { type, ...definition } = expected.tools[0];
  for (const tools of [
    [{ type, function: { ...definition, name: "other" } }],
    [{ type, function: { ...definition, parameters: {} } }],
    [{ type, name: "conflicting", function: definition }],
    [
      { type, function: definition },
      { type, function: definition },
    ],
    [{ type: "mcp", function: definition }],
  ]) {
    socket.event({ type: "session.updated", session: { ...expected, tools } });
    expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(0);
    expect(updates.at(-1)?.status).toBe("connecting");
  }
  socket.event({ type: "session.updated", session: { ...expected, tools: [{ type, function: definition }] } });
  socket.event({ type: "session.updated", session: { ...expected, tools: [{ type, function: definition }] } });
  expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  expect(updates.at(-1)?.status).toBe("listening");
  voice.stop();
});

it.each(["Um", "I'm thinking", "Hello"])(
  "does not turn a finalized thinking/non-answer pause (%s) into missing-call recovery",
  async text => {
    vi.useFakeTimers();
    const { voice, socket } = await connected();
    learnerAnswer(socket, text);
    socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
    const config = socket.sent.filter(e => e.type === "session.update").at(-1)!;
    socket.event({ type: "session.updated", session: config.session });
    vi.advanceTimersByTime(60000);
    expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
    expect(updates.at(-1)?.learnerAnswerAccepted).toBe(false);
    voice.stop();
  },
);

it.each(["before drain", "after drain"])(
  "coordinates delayed learner final %s with already completed acknowledgment and tool",
  async timing => {
    vi.useFakeTimers();
    const { voice, socket, context } = await connected();
    socket.event({ type: "input_audio_buffer.speech_started", item_id: "learner" });
    socket.event({ type: "input_audio_buffer.speech_stopped", item_id: "learner" });
    socket.event({ type: "response.created", response: { id: "tools" } });
    tutor(socket, "tools", "Yes, one duck.");
    propose(socket);
    socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
    if (timing === "after drain") context.sources[0].onended?.();
    socket.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "learner",
      transcript: "One duck.",
    });
    if (timing === "before drain") context.sources[0].onended?.();
    vi.advanceTimersByTime(260);
    expect(updates.at(-1)?.render?.nodeId).toBe("count-2-ducks");
    voice.stop();
  },
);

it("requires playback of the acknowledgment's own item, not unrelated audio from the same response", async () => {
  vi.useFakeTimers();
  const { voice, socket, context } = await connected();
  learnerAnswer(socket);
  propose(socket);
  socket.event({
    type: "response.output_audio.delta",
    response_id: "tools",
    item_id: "different-item",
    delta: btoa("\0\0".repeat(2400)),
  });
  tutor(socket, "tools", "Yes, one duck.", false);
  socket.event({ type: "response.done", response: { id: "tools", status: "completed" } });
  context.sources[0].onended?.();
  vi.advanceTimersByTime(500);
  expect(updates.at(-1)?.render).toBeUndefined();
  voice.stop();
});
