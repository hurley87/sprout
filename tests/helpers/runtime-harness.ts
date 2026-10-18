import { vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../../lib/events";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../../lib/lesson-runtime/lesson-runtime-reducer";

// Distribute Omit over the event union so callers retain each event's payload checks.
type UntimedEvent<Event = LessonRuntimeEvent> = Event extends LessonRuntimeEvent ? Omit<Event, "atMs"> : never;

/** Only supplies the local clock. Tests explicitly own identities and event order. */
export function createReducerHarness(runtimeId: string, options: Parameters<typeof createLessonRuntime>[1]) {
  let state = createLessonRuntime(runtimeId, options);
  return {
    get state() { return state; },
    send(event: UntimedEvent, deltaMs = 1) {
      const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + deltaMs }, options.lesson);
      state = result.state;
      return result;
    },
  };
}

/** An ordinary complete learner turn, not a substitute for stale-source or VAD tests.
 * Revision is explicit; every event still passes through the reducer. */
export function prepareLearnerClassification(
  harness: ReturnType<typeof createReducerHarness>,
  revision: number,
) {
  harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
  harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), speaker: "child", revision });
  harness.send({ type: "child.turn.ended", source: runtimeSource(harness.state) });
  const source = classificationSource(harness.state);
  if (!source) throw new Error("Learner turn is not eligible for classification");
  return source;
}

type RuntimeTransport = {
  receive: ((event: ProviderEvent) => void) | undefined;
  send: (command: ClientCommand) => void;
  close: () => void;
  start?: (lessonId: string) => void;
};

// Keep each test file's hoisted mocks local; send/close retain their mock APIs.
export function mockBrowserTransport(transport: RuntimeTransport, options: { requestLiveSession?: boolean } = {}) {
  return class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void, _failed: () => void, lessonId: string) {
      transport.start?.(lessonId);
      transport.receive = receive;
      if (options.requestLiveSession) {
        // Preserve the awaited session boundary in lesson-ID propagation tests.
        await fetch("/api/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: "mock-offer", lessonId }),
        });
      }
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close = transport.close;
  };
}

export function useRuntimeFakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
}

// These helpers only emit synchronous events. Tests own all timer advancement.
export function providerEvents(emit: (event: ProviderEvent) => void) {
  return {
    acknowledgeSteering(eventId: string, startMs: number) {
      emit({
        type: "context.appended",
        name: "session.instructions.appended",
        clientEventId: eventId,
        startMs,
      });
    },
    childTurn(transcript: string, startMs: number) {
      emit({ type: "microphone.activity_started" });
      emit({ type: "transcript", speaker: "child", delta: transcript, startMs, endMs: startMs + 100 });
      emit({ type: "microphone.speech_stopped", quietMs: 900 });
    },
    tutorTurn(transcript: string, startMs: number) {
      emit({ type: "transcript", speaker: "sprout", delta: transcript, startMs, endMs: startMs + 100 });
      emit({ type: "output.activity", state: "active" });
      emit({ type: "output.activity", state: "quiet" });
    },
  };
}
