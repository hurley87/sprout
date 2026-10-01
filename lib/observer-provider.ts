import {
  validateObserverProposal,
  type CanonicalObservationRecord,
  type ObserverProposal,
} from "./observation-contracts";

export const AUDIO_LIMIT_BYTES = 20 * 1024 * 1024;
export const PROVIDER_TIMEOUT_MS = 90_000;

export type ObserverProvider = {
  transcribe(audio: Blob, mimeType: string, signal: AbortSignal): Promise<string>;
  propose(input: { transcript: string; canonicalSnapshot: string }, signal: AbortSignal): Promise<unknown>;
};

export class ObserverProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObserverProviderError";
  }
}

const transcriptionExtensions: Record<string, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mpga",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

function transcriptionExtension(mimeType: string): string | undefined {
  const match = /^\s*(audio\/[a-z0-9.+-]+)\s*(?:;\s*codecs\s*=\s*(?:"([a-z0-9._-]+)"|([a-z0-9._-]+))\s*)?$/i.exec(
    mimeType,
  );
  if (!match) return undefined;
  const baseType = match[1].toLowerCase();
  const codec = (match[2] ?? match[3])?.toLowerCase();
  if (codec && (!(baseType === "audio/webm" || baseType === "audio/ogg") || codec !== "opus")) return undefined;
  return transcriptionExtensions[baseType];
}

const textSchema = { type: "string" } as const;
const nullableInteger = { anyOf: [{ type: "integer" }, { type: "null" }] } as const;
const proposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["observer_proposal"] },
          proposalId: textSchema,
          sessionId: textSchema,
          exchangeAtMs: { type: "integer" },
          observation: {
            type: "object",
            additionalProperties: false,
            properties: {
              behavior: {
                type: "string",
                enum: ["quantity_identification", "counting_aloud_with_total", "uncertain_exchange"],
              },
              outcome: { type: "string", enum: ["correct", "incorrect", "uncertain"] },
              speakerAttribution: { type: "string", enum: ["child_or_nearby_speaker", "unknown"] },
              statedTotal: nullableInteger,
              countSequenceObserved: { type: "boolean" },
              targetQuantity: nullableInteger,
              description: textSchema,
              support: {
                type: "object",
                additionalProperties: false,
                properties: {
                  status: { type: "string", enum: ["recorded", "not_established"] },
                  kinds: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["hint", "choice", "modeled_answer", "counting_together", "parent_reported_assistance"],
                    },
                  },
                  sourceEventIds: { type: "array", items: textSchema },
                  recordingSourceIds: { type: "array", items: textSchema },
                },
                required: ["status", "kinds", "sourceEventIds", "recordingSourceIds"],
              },
              uncertaintyReasons: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "ambiguous_speaker",
                    "unclear_speech",
                    "silence",
                    "missing_scene_context",
                    "disrupted_exchange",
                    "conflicting_context",
                  ],
                },
              },
            },
            required: [
              "behavior",
              "outcome",
              "speakerAttribution",
              "statedTotal",
              "countSequenceObserved",
              "targetQuantity",
              "description",
              "support",
              "uncertaintyReasons",
            ],
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                eventId: textSchema,
                role: { type: "string", enum: ["response", "scene", "support", "exchange_context"] },
              },
              required: ["eventId", "role"],
            },
          },
        },
        required: ["kind", "proposalId", "sessionId", "exchangeAtMs", "observation", "sources"],
      },
    },
  },
  required: ["proposals"],
} as const;

/** OpenAI HTTP adapter; no credential or provider work runs in the browser. */
export function createOpenAIObserverProvider(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): ObserverProvider {
  if (!apiKey?.trim())
    throw new ObserverProviderError("Observer provider configuration is unavailable (OPENAI_API_KEY).");

  return {
    async transcribe(audio, mimeType, signal) {
      if (audio.size <= 0 || audio.size > AUDIO_LIMIT_BYTES)
        throw new ObserverProviderError("Recording exceeds the Observer audio size limit.");
      const form = new FormData();
      const extension = transcriptionExtension(mimeType);
      if (!extension) throw new ObserverProviderError("Saved recording MIME type is unsupported for transcription.");
      form.set("file", audio, `session.${extension}`);
      form.set("model", "gpt-transcribe");
      const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      });
      if (!response.ok) throw new ObserverProviderError(`Audio transcription failed (HTTP ${response.status}).`);
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || typeof (body as { text?: unknown }).text !== "string")
        throw new ObserverProviderError("Audio transcription returned a malformed response.");
      return (body as { text: string }).text;
    },
    async propose({ transcript, canonicalSnapshot }, signal) {
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_OBSERVER_MODEL || "gpt-6-astra",
          store: false,
          instructions: [
            "Propose only concrete, evidence-linked observations for a parent's review; never diagnose, grade, or claim mastery.",
            "The session record is canonical. Generated Sprout/control events are diagnostics, not delivered speech.",
            "Use only canonical event IDs, and only response utterances with clear child_or_nearby_speaker attribution, finalized state, explicit sessionTiming with mapped_provider, source_input_bound or source_timeline_bound provenance, and stable displayed scene across the entire speech interval for concrete claims.",
            "A correct total alone is quantity identification. Claim counting aloud only when the canonical response itself contains a count sequence and total.",
            "Never infer pointing, touch-counting, independence from absent support rows, or semantic help timing from untimed transcription.",
            "When speech, speaker, timing, scene, silence, support, or interruption is unclear, omit the conclusion. Return [] when no usable evidence exists.",
            "Legacy startMs/endMs and providerTiming are provider offsets, not session time. firstObservedAtMs/lastObservedAtMs are arrival times, not acoustic bounds. responseScene is application transcript context, not proof of a scene throughout speech. source_input_bound is the entire possible source-input interval through transcript receipt, not an exact speech interval. source_timeline_bound narrows the earliest possible start using the source creation request and approximate provider session offset; its end remains transcript receipt. It is not exact acoustic timing. All scene and support relationships must hold over the entire bound. Missing trustworthy timing must remain uncertain or omitted. needs_confirmation recognition cannot establish an incorrect answer, difficulty, or instructional support. A clarification request is not a counting hint.",
            "Audio transcription is untimed. It is corroborative text only and never establishes a timestamp or source reference.",
          ].join(" "),
          input: JSON.stringify({ transcript, canonicalSnapshot }),
          text: { format: { type: "json_schema", name: "observer_proposals", strict: true, schema: proposalSchema } },
          max_output_tokens: 12000,
        }),
        signal,
      });
      if (!response.ok) throw new ObserverProviderError(`Observer analysis failed (HTTP ${response.status}).`);
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new ObserverProviderError("Observer returned a malformed response.");
      const data = body as { status?: unknown; incomplete_details?: unknown; output?: unknown; output_text?: unknown };
      if (data.status !== "completed" || data.incomplete_details)
        throw new ObserverProviderError("Observer response was refused or incomplete.");
      if (typeof data.output_text === "string") return parseOutput(data.output_text);
      if (Array.isArray(data.output)) {
        for (const item of data.output) {
          if (!item || typeof item !== "object") continue;
          const content = (item as { content?: unknown }).content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            if (part && typeof part === "object" && (part as { type?: unknown }).type === "refusal")
              throw new ObserverProviderError("Observer declined to analyze the saved recording.");
            if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
              return parseOutput((part as { text: string }).text);
          }
        }
      }
      throw new ObserverProviderError("Observer response contained no completed structured output.");
    },
  };
}

function parseOutput(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || !Array.isArray((value as { proposals?: unknown }).proposals))
      throw new Error();
    return (value as { proposals: unknown[] }).proposals;
  } catch {
    throw new ObserverProviderError("Observer returned malformed structured output.");
  }
}

export async function analyzeSavedRecording(args: {
  provider: ObserverProvider;
  audio: Blob;
  mimeType: string;
  canonicalSnapshot: string;
  signal: AbortSignal;
}): Promise<ObserverProposal[]> {
  if (args.audio.size <= 0 || args.audio.size > AUDIO_LIMIT_BYTES)
    throw new ObserverProviderError("Recording exceeds the Observer audio size limit.");
  const transcript = await args.provider.transcribe(args.audio, args.mimeType, args.signal);
  const raw = await args.provider.propose({ transcript, canonicalSnapshot: args.canonicalSnapshot }, args.signal);
  if (!Array.isArray(raw) || raw.length > 1000)
    throw new ObserverProviderError("Observer proposal batch is invalid or exceeds 1,000 rows.");
  const snapshot = JSON.parse(args.canonicalSnapshot) as {
    sessionId: string;
    state: string;
    recordStatus: string;
    recording?: { startOffsetMs: number; durationMs: number } | null;
    events: CanonicalObservationRecord["events"];
  };
  const record: CanonicalObservationRecord = {
    session: { _id: snapshot.sessionId, state: snapshot.state, recordStatus: snapshot.recordStatus },
    ...(snapshot.recording
      ? { recording: { recordingId: `${snapshot.sessionId}:recording`, ...snapshot.recording } }
      : {}),
    events: snapshot.events,
  };
  return raw.map(proposal => {
    const normalized = normalizeNullOptionals(proposal);
    let validated = validateObserverProposal(normalized, record);
    // Timestamp bookkeeping belongs to the app. Repair only this field after
    // every other claim/reference check passes, then run the full validator again.
    // Publication still validates the resulting timestamp against its own snapshot.
    if (!validated.ok && validated.issues.every(issue => issue.path === "exchangeAtMs")) {
      const candidate = normalized as ObserverProposal;
      const response = candidate.sources.find(source => source.role === "response" && "eventId" in source);
      const event =
        response && "eventId" in response ? record.events.find(event => event._id === response.eventId) : undefined;
      if (event?.evidence?.type === "utterance" && event.evidence.speaker !== "sprout")
        validated = validateObserverProposal({ ...candidate, exchangeAtMs: event.atMs }, record);
    }
    if (!validated.ok)
      throw new ObserverProviderError(
        `Observer cited invalid evidence: ${validated.issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`,
      );
    return validated.value;
  });
}

function normalizeNullOptionals(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const proposal = input as Record<string, unknown>;
  if (!proposal.observation || typeof proposal.observation !== "object") return input;
  const observation = proposal.observation as Record<string, unknown>;
  return {
    ...proposal,
    observation: Object.fromEntries(
      Object.entries(observation)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => [
          key,
          key === "support" && value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>).filter(([, nested]) => nested !== null),
              )
            : value,
        ]),
    ),
  };
}
