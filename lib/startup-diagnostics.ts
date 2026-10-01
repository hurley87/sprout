import type { Diagnostic } from "./session";

export type StartupStage =
  | "startup.media_started"
  | "startup.microphone_ready"
  | "startup.media_ready"
  | "startup.live_connection_started"
  | "startup.offer_ready"
  | "startup.ice_ready"
  | "startup.provider_request_started"
  | "startup.provider_response_received"
  | "startup.remote_description_applied"
  | "startup.provider_session_started"
  | "startup.live_ready"
  | "startup.lesson_state_ready"
  | "startup.initial_scene_displayed"
  | "startup.initial_instruction_sent"
  | "startup.first_provider_output"
  | "startup.first_tutor_transcript"
  | "startup.first_tutor_speech";

/** One browser attempt clock. Missing milestones stay null, including failed starts.
 * Provider request time includes the local route, network and provider creation;
 * decoded speech/transcript observations do not prove audible delivery. */
export function startupTiming(events: readonly Diagnostic[]) {
  const at = (type: string) => events.find(event => event.type === type)?.at ?? null;
  const duration = (from: string, to: string) => {
    const start = at(from);
    const end = at(to);
    return start === null || end === null || end < start ? null : end - start;
  };
  return {
    clock: "attempt_relative_ms",
    attempt_started_at: at("attempt.started"),
    media_started_at: at("startup.media_started"),
    microphone_ready_at: at("startup.microphone_ready"),
    media_ready_at: at("startup.media_ready"),
    live_connection_started_at: at("startup.live_connection_started"),
    offer_ready_at: at("startup.offer_ready"),
    ice_ready_at: at("startup.ice_ready"),
    provider_request_started_at: at("startup.provider_request_started"),
    provider_response_received_at: at("startup.provider_response_received"),
    remote_description_applied_at: at("startup.remote_description_applied"),
    provider_session_started_at: at("startup.provider_session_started"),
    live_ready_at: at("startup.live_ready"),
    lesson_state_ready_at: at("startup.lesson_state_ready"),
    initial_scene_displayed_at: at("startup.initial_scene_displayed"),
    initial_instruction_sent_at: at("startup.initial_instruction_sent"),
    first_provider_output_at: at("startup.first_provider_output"),
    first_tutor_transcript_at: at("startup.first_tutor_transcript"),
    first_tutor_speech_at: at("startup.first_tutor_speech"),
    media_setup_ms: duration("startup.media_started", "startup.media_ready"),
    provider_request_ms: duration("startup.provider_request_started", "startup.provider_response_received"),
    sdp_to_provider_started_ms: duration("startup.remote_description_applied", "startup.provider_session_started"),
    attempt_to_live_ready_ms: duration("attempt.started", "startup.live_ready"),
    attempt_to_initial_scene_ms: duration("attempt.started", "startup.initial_scene_displayed"),
    live_ready_to_instruction_ms: duration("startup.live_ready", "startup.initial_instruction_sent"),
    instruction_to_first_output_ms: duration("startup.initial_instruction_sent", "startup.first_provider_output"),
    attempt_to_first_output_ms: duration("attempt.started", "startup.first_provider_output"),
    attempt_to_first_transcript_ms: duration("attempt.started", "startup.first_tutor_transcript"),
    attempt_to_first_speech_ms: duration("attempt.started", "startup.first_tutor_speech"),
  };
}
