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
const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] };
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
  track.stop.mockClear();
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
  socket.event({ type: "session.updated", session: { model: "echoed-model" } });
  return { voice, socket, context: Context.instances[0], worklet: Worklet.instances[0] };
}
it("configures the fixed scene, starts once after acknowledgment and streams PCM", async () => {
  const { voice, socket, worklet } = await connected();
  expect(socket.url).toContain("model=grok-voice-3.0");
  expect(socket.protocols).toEqual(["xai-client-secret.ephemeral"]);
  expect(socket.sent[0]).toMatchObject({
    type: "session.update",
    session: { tools: [], audio: { input: { format: { rate: 24000 } } } },
  });
  expect(JSON.stringify(socket.sent[0])).toContain("hello-duck");
  socket.event({ type: "session.updated" });
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
