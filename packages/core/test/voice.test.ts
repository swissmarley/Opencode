import { expect } from "bun:test"
import { RequestExecutor } from "@opencode/ai/route"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Voice } from "@opencode/core/voice"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { ConfigTranscription } from "@opencode/schema/config/transcription"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const credential = (id: string, method: "key" | "oauth") => ({
  type: "credential" as const,
  id: Credential.ID.make(id),
  label: id,
  method,
})

const keys: Record<string, string> = {
  active: "sk-active",
  stored: "sk-stored",
  XAI_API_KEY: "xai-env-key",
  GEMINI_API_KEY: "gemini-env-key",
  OPENCODE_API_KEY: "opencode-env-key",
}

// A ChatGPT sign-in can't start voice sessions, so resolving one fails the test; an OpenCode Console sign-in can.
const resolveCredential: Integration.Interface["connection"]["resolve"] = (connection) => {
  if (connection.type === "env") return Effect.succeed(Credential.Key.make({ type: "key", key: keys[connection.name] }))
  if (connection.id === "chatgpt") return Effect.die("a ChatGPT sign-in was resolved")
  if (connection.id === "console")
    return Effect.succeed(
      Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "console-access",
        refresh: "console-refresh",
        expires: 1,
        metadata: { orgID: "wrk_console" },
      }),
    )
  return Effect.succeed(Credential.Key.make({ type: "key", key: keys[connection.id] }))
}

const unused = () => Effect.die("unused")

const mockIntegration = (
  connections: (id: Integration.ID) => Integration.Info["connections"],
  resolve: Integration.Interface["connection"]["resolve"] = () => Effect.die("Voice.models resolved a credential"),
) =>
  Layer.mock(Integration.Service, {
    revision: () => 0,
    get: (id) => Effect.succeed({ id, name: id, methods: [], connections: connections(id) }),
    connection: {
      active: unused,
      resolve,
      key: unused,
      external: unused,
      activate: unused,
      update: unused,
      remove: unused,
      status: unused,
    },
    oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
    command: { connect: unused, status: unused, cancel: unused },
  })

const voiceLayer = (
  integration: Layer.Layer<Integration.Service>,
  executor: Layer.Layer<RequestExecutor.Service>,
  transcription?: ConfigTranscription.Info,
  // No models are found in these folders unless a test puts one there.
  global = Global.make({
    data: "/nonexistent/opencode-data",
    home: "/nonexistent/opencode-home",
    bin: "/nonexistent/opencode-bin",
  }),
  downloads: HttpClient.HttpClient = HttpClient.make(() => Effect.die("unexpected download")),
) =>
  Voice.layer.pipe(
    Layer.provide([
      integration,
      executor,
      Layer.succeed(Global.Service, global),
      Layer.succeed(HttpClient.HttpClient, downloads),
      Config.testLayer(
        transcription
          ? [
              new Document({
                type: "document",
                info: new Info({ experimental: new ConfigExperimental.Info({ transcription }) }),
              }),
            ]
          : [],
      ),
      LayerNode.compile(LayerNode.group([FSUtil.node, AppProcess.node])),
    ]),
  )

// Answers every upstream request with `respond`, recording what was sent.
const recordingExecutor = (requests: HttpClientRequest.HttpClientRequest[], respond: () => Response) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((req: HttpClientRequest.HttpClientRequest) =>
          Effect.sync(() => {
            requests.push(req)
            return HttpClientResponse.fromWeb(req, respond())
          }),
        ),
      ),
    ),
  )

// Starts a session with each integration's connections, recording the requests it sends upstream.
const start = (
  model: string,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
) =>
  Effect.flatMap(Voice.Service, (voice) =>
    voice.session({
      model,
      transport:
        model.startsWith("grok-") || model.startsWith("gemini-")
          ? { type: "websocket" }
          : { type: "webrtc", sdp: "v=0" },
    }),
  ).pipe(
    Effect.provide(
      voiceLayer(
        mockIntegration((id) => connections[id] ?? [], resolveCredential),
        recordingExecutor(requests, () =>
          model.startsWith("gemini-")
            ? Response.json({ name: "auth_tokens/ek_gemini" })
            : model.startsWith("grok-")
              ? Response.json({ value: "ek_xai", expires_at: 1760000999 })
              : Response.json({ transport: { sdp: "v=0\r\no=answer\r\n" } }),
        ),
      ),
    ),
  )

it.effect("uses the first key or env connection Integration lists and never a ChatGPT sign-in", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1760000000_000)
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const call = (model: string, connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      start(model, connections, requests)

    yield* call("gpt-live-1", { openai: [credential("active", "key"), credential("stored", "key")] })
    yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth"), credential("stored", "key")] })
    const grok = yield* call("grok-voice-3.0", { xai: [{ type: "env", name: "XAI_API_KEY" }] })
    const gemini = yield* call("gemini-3.8-live", { google: [{ type: "env", name: "GEMINI_API_KEY" }] })
    expect(requests.map((req) => req.headers.authorization ?? req.headers["x-goog-api-key"])).toEqual([
      "Bearer sk-active",
      "Bearer sk-stored",
      "Bearer xai-env-key",
      "gemini-env-key",
    ])
    expect(grok).toEqual({
      type: "websocket",
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
      token: "ek_xai",
      expiresAt: 1760000999,
    })
    expect(gemini).toEqual({
      type: "websocket",
      url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
      token: "auth_tokens/ek_gemini",
      expiresAt: 1760000060,
    })

    const signInOnly = yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth")] }).pipe(Effect.flip)
    expect(signInOnly._tag).toBe("Voice.UnavailableError")
    expect(signInOnly.message).toContain("OpenAI API key")

    const missingGoogle = yield* call("gemini-3.8-live", {}).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("GEMINI_API_KEY")
  }),
)

it.effect(
  "starts GPT-Live on OpenCode's hosted endpoint with an OpenCode Console connection only without an OpenAI key",
  () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = []
      const opencode = { opencode: [credential("console", "oauth")] }

      yield* start("gpt-live-1", { openai: [credential("chatgpt", "oauth")], ...opencode }, requests)
      yield* start("gpt-live-1", { opencode: [{ type: "env", name: "OPENCODE_API_KEY" }] }, requests)
      yield* start("gpt-live-1", { openai: [credential("active", "key")], ...opencode }, requests)
      expect(
        requests.map((req): (string | undefined)[] => [
          req.url,
          req.headers.authorization,
          req.headers["x-opencode-org-id"],
        ]),
      ).toEqual([
        ["https://opencode.ai/inference/openai/v1/live/sessions", "Bearer console-access", "wrk_console"],
        ["https://opencode.ai/inference/openai/v1/live/sessions", "Bearer opencode-env-key", undefined],
        ["https://api.openai.com/v1/live/sessions", "Bearer sk-active", undefined],
      ])

      const realtime = yield* start("gpt-realtime-2.1", opencode, requests).pipe(Effect.flip)
      expect(realtime).toMatchObject({ _tag: "Voice.UnavailableError", service: "openai" })
      expect(requests).toHaveLength(3)
    }),
)

it.effect("lists voice models with availability and default without resolving credentials", () =>
  Effect.gen(function* () {
    const list = (connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      Effect.flatMap(Voice.Service, (voice) => voice.models()).pipe(
        Effect.provide(
          voiceLayer(
            mockIntegration((id) => connections[id] ?? []),
            Layer.mock(RequestExecutor.Service, {}),
          ),
        ),
      )

    expect(
      yield* list({
        openai: [credential("chatgpt", "oauth")],
        xai: [{ type: "env", name: "XAI_API_KEY" }],
        google: [credential("gemini", "key")],
      }),
    ).toEqual({
      models: [
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: false },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: false },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: true },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: true },
      ],
      default: "grok-voice-3.0",
    })

    expect(
      yield* list({ openai: [credential("chatgpt", "oauth")], opencode: [credential("console", "oauth")] }),
    ).toEqual({
      models: [
        { model: "gpt-live-1", provider: "opencode", transports: ["webrtc"], available: true },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: false },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
      ],
      default: "gpt-live-1",
    })

    const none = yield* list({ openai: [credential("chatgpt", "oauth")] })
    expect(none).toEqual({
      models: [
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: false },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: false },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
      ],
    })
    expect("default" in none).toBe(false)
  }),
)

// A short WAV-shaped payload; transcription routes forward the bytes without decoding them.
const audio = Buffer.from("RIFF....WAVEfmt ").toString("base64")

const transcribe = (
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  transcription: ConfigTranscription.Info | undefined,
  requests: HttpClientRequest.HttpClientRequest[] = [],
  global?: Global.Interface,
) =>
  Effect.flatMap(Voice.Service, (voice) => voice.transcribe({ audio, mime: "audio/wav" })).pipe(
    Effect.provide(
      voiceLayer(
        mockIntegration((id) => connections[id] ?? [], resolveCredential),
        recordingExecutor(requests, () => Response.json({ text: " Fix the login\n  bug. " })),
        transcription,
        global,
      ),
    ),
  )

it.effect("transcribes with OpenAI Whisper using the server's OpenAI key", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const result = yield* transcribe(
      { openai: [credential("chatgpt", "oauth"), credential("stored", "key")] },
      undefined,
      requests,
    )
    expect(result).toEqual({ text: "Fix the login bug." })
    expect(requests.map((req) => [req.url, req.headers.authorization])).toEqual([
      ["https://api.openai.com/v1/audio/transcriptions", "Bearer sk-stored"],
    ])

    const signInOnly = yield* transcribe({ openai: [credential("chatgpt", "oauth")] }, { provider: "openai" }).pipe(
      Effect.flip,
    )
    expect(signInOnly).toMatchObject({ _tag: "Voice.UnavailableError", service: "openai" })
    expect(signInOnly.message).toContain("OPENAI_API_KEY")

    // Without a key or a model, the error explains both ways to set voice input up.
    const neither = yield* transcribe({ openai: [credential("chatgpt", "oauth")] }, undefined).pipe(Effect.flip)
    expect(neither).toMatchObject({ _tag: "Voice.UnavailableError", service: "transcription" })
    expect(neither.message).toContain("whisper.cpp")
    expect(neither.message).toContain("OpenAI API key")
    expect(neither.message).toContain("ggml-base.en.bin")
  }),
)

it.effect("sends an OpenAI-compatible endpoint only the key configured for it", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const openai = { openai: [credential("active", "key")] }
    yield* transcribe(openai, { base_url: "http://127.0.0.1:8080/v1", model: "large-v3" }, requests)
    yield* transcribe(openai, { base_url: "https://api.groq.com/openai/v1", api_key: "gsk-groq" }, requests)
    expect(requests.map((req): (string | undefined)[] => [req.url, req.headers.authorization])).toEqual([
      ["http://127.0.0.1:8080/v1/audio/transcriptions", undefined],
      ["https://api.groq.com/openai/v1/audio/transcriptions", "Bearer gsk-groq"],
    ])
  }),
)

it.live("transcribes locally with the configured command and its placeholders", () =>
  Effect.gen(function* () {
    // Prints what the command received, the way whisper.cpp prints one line per segment.
    const script = `const [file, model, language] = process.argv.slice(1); console.log(" [BLANK_AUDIO]"); console.log(require("fs").readFileSync(file, "utf8").slice(0, 4), model, language)`
    const result = yield* transcribe(
      {},
      {
        provider: "local",
        model: "base.en",
        language: "de",
        command: [process.execPath, "-e", script, "{file}", "{model}", "{language}"],
      },
    )
    expect(result).toEqual({ text: "RIFF base.en de" })

    const missing = yield* transcribe({}, { provider: "local" }).pipe(Effect.flip)
    expect(missing._tag).toBe("Voice.InvalidRequestError")
    expect(missing.message).toContain("whisper.cpp")

    const failing = yield* transcribe(
      {},
      { provider: "local", command: [process.execPath, "-e", "process.exit(3)"] },
    ).pipe(Effect.flip)
    expect(failing).toMatchObject({ _tag: "Voice.UnavailableError", service: "local" })
  }),
)

it.live("falls back to whisper.cpp without an OpenAI key, finding a downloaded model", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const data = path.join(tmp.path, "data")
    const home = path.join(tmp.path, "home")
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(data, "whisper"), { recursive: true })
      await fs.mkdir(path.join(home, "models"), { recursive: true })
      await fs.writeFile(path.join(data, "whisper", "ggml-small.bin"), "")
      await fs.writeFile(path.join(data, "whisper", "notes.txt"), "")
      await fs.writeFile(path.join(home, "models", "ggml-base.en.bin"), "")
    })
    const command = [process.execPath, "-e", "console.log(process.argv[1])", "{model}"]
    const signInOnly = { openai: [credential("chatgpt", "oauth")] }

    // OpenCode's data folder comes before ~/models.
    expect(yield* transcribe(signInOnly, { command }, [], Global.make({ data, home }))).toEqual({
      text: path.join(data, "whisper", "ggml-small.bin"),
    })
    yield* Effect.promise(() => fs.rm(path.join(data, "whisper"), { recursive: true }))
    expect(yield* transcribe(signInOnly, { command }, [], Global.make({ data, home }))).toEqual({
      text: path.join(home, "models", "ggml-base.en.bin"),
    })
  }),
)

const status = (
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  transcription: ConfigTranscription.Info | undefined,
) =>
  Effect.flatMap(Voice.Service, (voice) => voice.transcription()).pipe(
    Effect.provide(
      voiceLayer(
        mockIntegration((id) => connections[id] ?? []),
        Layer.mock(RequestExecutor.Service, {}),
        transcription,
      ),
    ),
  )

it.effect("reports what transcription would use and whether it is ready, without resolving credentials", () =>
  Effect.gen(function* () {
    const key = { openai: [credential("stored", "key")] }
    const signInOnly = { openai: [credential("chatgpt", "oauth")] }
    expect(yield* status(key, undefined)).toMatchObject({ ready: true, engine: "openai", openai: true })
    expect(yield* status(signInOnly, { base_url: "http://127.0.0.1:8080/v1" })).toMatchObject({
      ready: true,
      engine: "endpoint",
      openai: false,
    })
    expect(yield* status(signInOnly, { command: ["whisper-local"] })).toMatchObject({ ready: true, engine: "local" })
    // No model can be found in the test's folders, so local transcription isn't ready even where whisper-cli is.
    expect(yield* status(signInOnly, undefined)).toMatchObject({
      ready: false,
      engine: "local",
      openai: false,
      models: "/nonexistent/opencode-data/whisper",
    })
    expect(yield* status(key, { provider: "local" })).toMatchObject({ ready: false, engine: "local", openai: true })
  }),
)

it.live("sets up whisper.cpp by downloading a model next to an installed whisper-cli", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const global = Global.make({
      data: path.join(tmp.path, "data"),
      home: path.join(tmp.path, "home"),
      bin: path.join(tmp.path, "bin"),
    })
    // A stand-in whisper-cli in OpenCode's bin folder, so setup skips installing it.
    yield* Effect.promise(async () => {
      await fs.mkdir(global.bin, { recursive: true })
      const name = process.platform === "win32" ? "whisper-cli.cmd" : "whisper-cli"
      await fs.writeFile(path.join(global.bin, name), "#!/bin/sh\n", { mode: 0o755 })
    })
    const requested: string[] = []
    const model = new Uint8Array(4096).fill(7)
    const downloads = HttpClient.make((req: HttpClientRequest.HttpClientRequest) =>
      Effect.sync(() => {
        requested.push(req.url)
        return HttpClientResponse.fromWeb(
          req,
          new Response(model, { headers: { "content-length": String(model.length) } }),
        )
      }),
    )
    const voiceWith = voiceLayer(
      mockIntegration(() => []),
      Layer.mock(RequestExecutor.Service, {}),
      undefined,
      global,
      downloads,
    )
    const result = yield* Effect.gen(function* () {
      const voice = yield* Voice.Service
      expect(yield* voice.transcription()).toMatchObject({ ready: false, engine: "local" })
      yield* voice.setup({ model: "base" })
      const deadline = Date.now() + 10_000
      while ((yield* voice.transcription()).setup && Date.now() < deadline) yield* Effect.sleep("10 millis")
      return yield* voice.transcription()
    }).pipe(Effect.provide(voiceWith))

    const target = path.join(global.data, "whisper", "ggml-base.bin")
    expect(requested).toEqual(["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"])
    expect(result).toMatchObject({ ready: true, engine: "local", model: target })
    expect(result.error).toBeUndefined()
    expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(target)))).toEqual(model)
  }),
)
