import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, LocationNotFoundError, ServiceUnavailableError } from "../errors.js"

export const VoiceTransportType = Schema.Literals(["webrtc", "websocket"]).annotate({
  identifier: "VoiceTransportType",
})

export const VoiceModel = Schema.Struct({
  model: Schema.String,
  provider: Schema.String,
  transports: Schema.Array(VoiceTransportType),
  available: Schema.Boolean,
}).annotate({ identifier: "VoiceModel" })

export const VoiceWebRTCTransportInput = Schema.Struct({
  type: Schema.Literal("webrtc"),
  sdp: Schema.String,
  dcid: Schema.optional(Schema.Number),
}).annotate({ identifier: "VoiceWebRTCTransportInput" })

export const VoiceWebSocketTransportInput = Schema.Struct({
  type: Schema.Literal("websocket"),
}).annotate({ identifier: "VoiceWebSocketTransportInput" })

export const VoiceTransportInput = Schema.Union([
  VoiceWebRTCTransportInput,
  VoiceWebSocketTransportInput,
]).annotate({ identifier: "VoiceTransportInput" })

export const VoiceWebRTCTransport = Schema.Struct({
  type: Schema.Literal("webrtc"),
  sdp: Schema.String,
}).annotate({ identifier: "VoiceWebRTCTransport" })

export const VoiceWebSocketTransport = Schema.Struct({
  type: Schema.Literal("websocket"),
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.Number,
}).annotate({ identifier: "VoiceWebSocketTransport" })

export const VoiceTransport = Schema.Union([
  VoiceWebRTCTransport,
  VoiceWebSocketTransport,
]).annotate({ identifier: "VoiceTransport" })

export const VoiceTranscriptionStatus = Schema.Struct({
  ready: Schema.Boolean.annotate({ description: "Whether a recording would be transcribed now" }),
  engine: Schema.optional(Schema.Literals(["openai", "endpoint", "local"])).annotate({
    description: "What would transcribe: OpenAI, a configured OpenAI-compatible endpoint, or whisper.cpp on the server",
  }),
  openai: Schema.Boolean.annotate({ description: "Whether the server has an OpenAI API key" }),
  whisper: Schema.optional(Schema.String).annotate({ description: "Path of whisper.cpp's whisper-cli" }),
  model: Schema.optional(Schema.String).annotate({ description: "Path of the whisper.cpp model" }),
  homebrew: Schema.Boolean.annotate({ description: "Whether setup can install whisper.cpp with Homebrew" }),
  models: Schema.String.annotate({ description: "Folder setup downloads models into" }),
  setup: Schema.optional(
    Schema.Struct({
      step: Schema.Literals(["install", "download"]),
      received: Schema.optional(Schema.Number),
      total: Schema.optional(Schema.Number),
    }),
  ).annotate({ description: "Local setup in progress; the download counts bytes" }),
  error: Schema.optional(Schema.String).annotate({ description: "Why the last local setup failed" }),
}).annotate({ identifier: "VoiceTranscriptionStatus" })

export const VoiceLocalModel = Schema.Literals(["base.en", "base"]).annotate({
  identifier: "VoiceLocalModel",
  description: "whisper.cpp model: base.en understands English only, base any language; both are about 142 MB",
})

export const VoiceGroup = HttpApiGroup.make("server.voice")
  .add(
    HttpApiEndpoint.get("voice.models", "/api/experimental/voice/models", {
      success: Schema.Struct({
        data: Schema.Struct({
          models: Schema.Array(VoiceModel),
          default: Schema.optional(Schema.String),
        }),
      }).annotate({ identifier: "VoiceModelsResponse" }),
      error: [ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.models",
        summary: "List voice models",
        description:
          "List supported voice models, their transports, and whether the server has a usable API key for each provider.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("voice.session", "/api/experimental/voice/session", {
      payload: Schema.Struct({
        model: Schema.String,
        session: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        transport: VoiceTransportInput,
      }),
      success: Schema.Struct({
        data: Schema.Struct({
          transport: VoiceTransport,
        }),
      }).annotate({ identifier: "VoiceSessionResponse" }),
      error: [InvalidRequestError, ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.session",
        summary: "Create voice session",
        description:
          "Create a server-brokered voice session using the server's configured provider credentials and return the WebRTC SDP answer or WebSocket ephemeral token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("voice.transcribe", "/api/experimental/voice/transcribe", {
      payload: Schema.Struct({
        audio: Schema.String.annotate({ description: "The recording, base64-encoded" }),
        mime: Schema.String.check(Schema.isPattern(/^audio\/[\w.+-]+/u)).annotate({
          description: "The recording's media type, such as audio/wav",
        }),
      }),
      success: Schema.Struct({
        data: Schema.Struct({
          text: Schema.String,
        }),
      }).annotate({ identifier: "VoiceTranscribeResponse" }),
      error: [InvalidRequestError, ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.transcribe",
        summary: "Transcribe speech",
        description:
          "Experimental: may change without compatibility guarantees. Transcribe a recording to text with the server's experimental.transcription config: OpenAI Whisper with the server's OpenAI key by default, an OpenAI-compatible endpoint, or a local Whisper command.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("voice.transcription", "/api/experimental/voice/transcription", {
      success: Schema.Struct({ data: VoiceTranscriptionStatus }).annotate({
        identifier: "VoiceTranscriptionResponse",
      }),
      error: [ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.transcription",
        summary: "Get transcription status",
        description:
          "Experimental: may change without compatibility guarantees. Report what would transcribe voice input, whether it is ready, what local whisper.cpp setup still needs, and the progress of a running setup.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("voice.setup", "/api/experimental/voice/transcription/setup", {
      payload: Schema.Struct({ model: VoiceLocalModel }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.setup",
        summary: "Set up local transcription",
        description:
          "Experimental: may change without compatibility guarantees. Start setting up whisper.cpp on the server in the background: install it with Homebrew when it is missing, then download the model when none is found. Poll the transcription status for progress.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "voice",
      description: "Experimental server-brokered voice session routes.",
    }),
  )
