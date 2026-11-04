export * as Voice from "./voice.js"

import { ai, type AIError, Media } from "@opencode/ai/effect"
import {
  Realtime,
  TranscriptionClient,
  type RealtimeSession,
  type RealtimeTransport,
  type RealtimeTransportInput,
  type RealtimeTransportType,
} from "@opencode/ai/experimental"
import { configure } from "@opencode/ai/providers/openai"
import { RequestExecutor } from "@opencode/ai/route"
import type { ConfigTranscription } from "@opencode/schema/config/transcription"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { ChildProcess } from "effect/process"
import os from "os"
import path from "path"
import { Config } from "./config.js"
import { Credential } from "./credential.js"
import { requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { which } from "./util/which.js"

export interface ModelInfo {
  readonly model: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
}

export interface Models {
  readonly models: readonly ModelInfo[]
  readonly default?: string
}

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

export interface TranscribeInput {
  /** Base64-encoded recording. */
  readonly audio: string
  readonly mime: string
}

export interface Transcript {
  readonly text: string
}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Voice.InvalidRequestError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Voice.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = InvalidRequestError | UnavailableError

export interface Interface {
  readonly models: () => Effect.Effect<Models>
  readonly session: (input: SessionInput) => Effect.Effect<RealtimeTransport, Error>
  /** Transcribes a recording with `experimental.transcription` from the server's config. */
  readonly transcribe: (input: TranscribeInput) => Effect.Effect<Transcript, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Voice") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const integrations = yield* Integration.Service
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const processes = yield* AppProcess.Service
    const global = yield* Global.Service
    const transcriptions = yield* TranscriptionClient.Service

    // Integration lists the active credential first, then newer stored credentials, then non-empty env vars.
    const findConnection = (provider: string, methods: readonly string[] = ["key"]) =>
      integrations
        .get(Integration.ID.make(provider))
        .pipe(
          Effect.map((info) => info?.connections.find((item) => item.type === "env" || methods.includes(item.method))),
        )

    // Where an engine's sessions start: its provider with the server's key or, for GPT-Live without an OpenAI key,
    // OpenCode's hosted GPT-Live with the server's OpenCode Console connection, whose sign-in works as well as a key.
    const source = Effect.fnUntraced(function* (engine: (typeof Realtime.engines)[number]) {
      const connection = yield* findConnection(engine.provider)
      if (connection) return { provider: engine.provider, connection }
      if (engine.id !== "openai-live") return undefined
      const hosted = yield* findConnection(openCodeLive.provider, ["key", "oauth"])
      return hosted && { provider: openCodeLive.provider, connection: hosted }
    })

    const models = Effect.fn("Voice.models")(function* () {
      const list = yield* Effect.forEach(Realtime.engines, (engine) =>
        source(engine).pipe(
          Effect.map((found) => ({
            model: engine.model,
            provider: found?.provider ?? engine.provider,
            transports: engine.transports,
            available: found !== undefined,
          })),
        ),
      )
      const first = list.find((item) => item.available)?.model
      return first ? { models: list, default: first } : { models: list }
    })

    const session = Effect.fn("Voice.session")(function* (input: SessionInput) {
      const engine = Realtime.engine(input.model)
      if (!engine) return yield* new InvalidRequestError({ message: `Unsupported voice model: ${input.model}` })

      const found = yield* source(engine)
      const credential = found
        ? yield* integrations.connection
            .resolve(found.connection)
            .pipe(Effect.mapError((error) => new UnavailableError({ service: found.provider, message: error.message })))
        : undefined
      const access = found && credential && sessionAccess(found.provider, credential)
      if (found === undefined || access === undefined)
        return yield* new UnavailableError({
          service: engine.provider,
          message: engine.id === "openai-live" ? missingLiveKeyMessage : missingKeyMessage[engine.provider],
        })

      return yield* Realtime.connect({
        model: input.model,
        session: input.session,
        transport: input.transport,
        ...access,
      }).pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError(
          (error: AIError): Error =>
            error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
              ? new InvalidRequestError({ message: error.message })
              : new UnavailableError({ message: error.message, service: found.provider }),
        ),
      )
    })

    // OpenAI's own API takes the server's OpenAI key. Any other endpoint gets only the key configured for it, so the
    // OpenAI key never leaves for a third party.
    const transcribeRemote = Effect.fnUntraced(function* (
      settings: ConfigTranscription.Info,
      input: TranscribeInput,
      apiKey: Redacted.Redacted<string> | false,
    ) {
      const response = yield* ai.experimental.transcription
        .generate({
          model: configure({ apiKey, baseURL: settings.base_url }).transcription(settings.model ?? "whisper-1"),
          audio: Media.base64(input.audio, input.mime),
          language: settings.language,
          prompt: settings.prompt,
        })
        .pipe(
          Effect.provideService(TranscriptionClient.Service, transcriptions),
          Effect.mapError(
            (error): Error =>
              error.reason._tag === "InvalidRequest" || error.reason._tag === "UnsupportedOperation"
                ? new InvalidRequestError({ message: error.message })
                : new UnavailableError({
                    message: error.message,
                    service: settings.base_url ? "transcription" : "openai",
                  }),
          ),
        )
      return response.text
    })

    const openAIKey = Effect.fnUntraced(function* () {
      const connection = yield* findConnection("openai")
      const credential = connection
        ? yield* integrations.connection
            .resolve(connection)
            .pipe(Effect.mapError((error) => new UnavailableError({ service: "openai", message: error.message })))
        : undefined
      if (credential?.type !== "key")
        return yield* new UnavailableError({ service: "openai", message: missingTranscriptionKeyMessage })
      return Redacted.make(credential.key)
    })

    // A downloaded whisper.cpp model, so local transcription works without naming one.
    const findModel = Effect.fnUntraced(function* () {
      const directories = modelDirectories(global)
      const found = yield* Effect.forEach(directories, (directory) =>
        fs.readDirectory(directory).pipe(
          Effect.map((names) => names.filter((name) => /^ggml-.+\.bin$/.test(name)).sort()),
          Effect.map((names) => (names[0] ? path.join(directory, names[0]) : undefined)),
          Effect.orElseSucceed(() => undefined),
        ),
      )
      return found.find((item) => item !== undefined)
    })

    const transcribeLocal = Effect.fn(function* (
      settings: ConfigTranscription.Info,
      input: TranscribeInput,
      model: string | undefined,
      binary: string | null | undefined,
    ) {
      const file = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-voice-" }).pipe(
        Effect.map((dir) => path.join(dir, `speech.${audioExtension(input.mime)}`)),
        Effect.tap((file) => fs.writeFile(file, Buffer.from(input.audio, "base64"))),
        Effect.mapError((error) => new UnavailableError({ service: "local", message: error.message })),
      )
      const values: Record<string, string> = {
        file,
        model: model ?? "",
        language: settings.language ?? "auto",
        prompt: settings.prompt ?? "",
      }
      const [command, ...args] = (
        settings.command ?? whisperCommand(binary ?? "whisper-cli", settings.prompt !== undefined)
      ).map((arg) => arg.replace(/\{(file|model|language|prompt)\}/g, (_, name: string) => values[name]))
      const result = yield* processes
        .run(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }), { timeout: "3 minutes" })
        .pipe(
          Effect.flatMap(AppProcess.requireSuccess),
          Effect.mapError((error) => new UnavailableError({ service: "local", message: error.message })),
        )
      return result.stdout.toString("utf8")
    }, Effect.scoped)

    const transcribe = Effect.fn("Voice.transcribe")(function* (input: TranscribeInput) {
      const settings = Config.latest(yield* config.entries(), "experimental")?.transcription ?? {}
      return { text: cleanTranscript(yield* route(settings, input)) }
    })

    // Without a provider or base_url, the server's OpenAI key wins and whisper.cpp is the fallback, so voice input
    // works out of the box on a machine with either one.
    const route = Effect.fnUntraced(function* (settings: ConfigTranscription.Info, input: TranscribeInput) {
      if (settings.base_url)
        return yield* transcribeRemote(settings, input, settings.api_key ? Redacted.make(settings.api_key) : false)
      if (settings.provider === "openai") return yield* transcribeRemote(settings, input, yield* openAIKey())
      if (settings.provider !== "local") {
        const key = yield* openAIKey().pipe(Effect.option)
        if (key._tag === "Some") return yield* transcribeRemote(settings, input, key.value)
      }
      const model = settings.model ? expandHome(settings.model) : yield* findModel()
      const binary = settings.command ? undefined : findWhisper()
      const missing = localMissing(settings, binary, model)
      if (missing)
        return yield* settings.provider === "local"
          ? new InvalidRequestError({ message: missing })
          : new UnavailableError({ service: "transcription", message: `${missingTranscriptionMessage} ${missing}` })
      return yield* transcribeLocal(settings, input, model, binary)
    })

    // What local transcription still needs, in words a person can act on, or undefined when it can run.
    const localMissing = (settings: ConfigTranscription.Info, binary: string | null | undefined, model?: string) => {
      if (settings.command) return undefined
      const install = process.platform === "darwin" ? " (brew install whisper-cpp)" : ""
      const directories = modelDirectories(global).join(" or ")
      if (!binary)
        return `Install whisper.cpp${install} so whisper-cli is on the PATH, and download a model such as ggml-base.en.bin into ${directories}.`
      if (!model)
        return `Download a whisper.cpp model such as ggml-base.en.bin into ${directories}, or set experimental.transcription.model to its path.`
      return undefined
    }

    return Service.of({ models, session, transcribe })
  }),
).pipe(Layer.provide(TranscriptionClient.layer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Integration.node, Config.node, FSUtil.node, AppProcess.node, Global.node, requestExecutor],
})

/** whisper.cpp prints one line per segment; these flags drop its timestamps and progress output. */
const whisperCommand = (binary: string, prompt: boolean) => [
  binary,
  "--model",
  "{model}",
  "--file",
  "{file}",
  "--language",
  "{language}",
  "--no-timestamps",
  "--no-prints",
  ...(prompt ? ["--prompt", "{prompt}"] : []),
]

// whisper.cpp names silence and noise with bracketed tags instead of returning nothing.
const cleanTranscript = (text: string) =>
  text
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

const audioExtension = (mime: string) => {
  const subtype = mime.split(";")[0].split("/")[1]?.replace(/^x-/, "")
  if (!subtype || subtype === "wave") return "wav"
  return subtype === "mpeg" ? "mp3" : subtype
}

const expandHome = (file: string) =>
  file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file

/**
 * whisper.cpp's CLI. The background server may start without the login shell's PATH, so Homebrew's folders are
 * searched too.
 */
const findWhisper = () => which("whisper-cli", undefined, ["/opt/homebrew/bin", "/usr/local/bin"].join(path.delimiter))

/** Where downloaded whisper.cpp models are found when none is configured: OpenCode's data folder, then ~/models. */
const modelDirectories = (global: Global.Interface) => [
  path.join(global.data, "whisper"),
  path.join(global.home, "models"),
]

/** OpenCode hosts GPT-Live on its OpenAI account, billed to the workspace whose credential starts a session. */
const openCodeLive = { provider: "opencode", baseURL: "https://opencode.ai/inference/openai/v1" } as const

/**
 * What a credential starts a session with: a provider's API key on its own API, or an OpenCode Console API key or
 * account sign-in on OpenCode's hosted GPT-Live, for the workspace the sign-in chose.
 */
const sessionAccess = (provider: string, credential: Credential.Value) => {
  if (provider !== openCodeLive.provider)
    return credential.type === "key" ? { apiKey: Redacted.make(credential.key) } : undefined
  if (credential.type === "external") return undefined
  const orgID = credential.metadata?.orgID
  return {
    apiKey: Redacted.make(credential.type === "oauth" ? credential.access : credential.key),
    baseURL: openCodeLive.baseURL,
    ...(typeof orgID === "string" ? { headers: { "x-opencode-org-id": orgID } } : {}),
  }
}

const missingTranscriptionKeyMessage =
  "Voice input needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't transcribe audio."

const missingTranscriptionMessage =
  "Voice input transcribes with a local whisper.cpp model, or with OpenAI when the server has an OpenAI API key."

const missingLiveKeyMessage =
  "GPT-Live needs an OpenAI API key (a stored key or OPENAI_API_KEY) or an OpenCode Console connection on the server. ChatGPT sign-in can't start voice sessions."

const missingKeyMessage = {
  openai:
    "Voice needs an OpenAI API key on the server (a stored key or OPENAI_API_KEY). ChatGPT sign-in can't start voice sessions.",
  xai: "Voice needs an xAI API key on the server (a stored key or XAI_API_KEY).",
  google:
    "Voice needs a Google API key on the server (a stored key, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY).",
} as const
