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
  | "startup.first_provider_output";
