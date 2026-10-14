import { vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../../lib/events";

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
