import { beforeEach, expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"

// Other app tests can leave a home draft in the process-wide stash, which these tests type after.
beforeEach(() => {
  takeDraft(undefined)
})

test("the prompt shows a microphone button and a /voice command", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, background: "off" },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await setup.waitFor(() => setup.renderer.root.findDescendantById("prompt.voice") !== undefined)
  await setup.waitForFrame((text) => text.split("\n").some((line) => line.trimEnd().endsWith("mic")))

  setup.mockInput.typeText("/voice")
  await setup.waitForFrame((text) => text.includes("Start voice input"))
})

test("voice.button: false hides the microphone button", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, background: "off", voice: { button: false } },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await setup.renderOnce()
  expect(setup.renderer.root.findDescendantById("prompt.voice")).toBeUndefined()
})

const notReady = { ready: false, engine: "local", openai: false, homebrew: false, models: "/data/whisper" }

test("voice input without a way to transcribe opens setup, and an OpenAI key typed into the form makes it ready", async () => {
  const keys: unknown[] = []
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, background: "off" },
    fetch: async (url, request) => {
      if (url.pathname === "/api/experimental/voice/transcription")
        return Response.json({
          data: keys.length ? { ...notReady, ready: true, engine: "openai", openai: true } : notReady,
        })
      if (url.pathname === "/api/integration/openai/connect/key" && request.method === "POST") {
        keys.push(await request.json())
        return new Response(null, { status: 204 })
      }
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)

  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey(" ")
  await setup.waitForFrame((text) => text.includes("Set up voice input") && text.includes("With an OpenAI API key"))
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
  setup.mockInput.typeText("OpenAI API")
  setup.mockInput.pressEnter()

  await setup.waitForFrame((text) => text.includes("platform.openai.com/api-keys"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  setup.mockInput.typeText("sk-test-key")
  setup.mockInput.pressEnter()

  await setup.waitFor(() => keys.length === 1)
  expect(keys).toEqual([{ key: "sk-test-key" }])
  await setup.waitForFrame((text) => text.includes("Voice input is ready"))
})

test("/voice-setup installs locally and shows the download's progress until voice input is ready", async () => {
  const requests: unknown[] = []
  let polls = 0
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, background: "off" },
    fetch: async (url, request) => {
      if (url.pathname === "/api/experimental/voice/transcription/setup" && request.method === "POST") {
        requests.push(await request.json())
        return new Response(null, { status: 204 })
      }
      if (url.pathname !== "/api/experimental/voice/transcription") return
      if (requests.length === 0) return Response.json({ data: { ...notReady, whisper: "/usr/bin/whisper-cli" } })
      polls++
      if (polls < 4)
        return Response.json({
          data: {
            ...notReady,
            whisper: "/usr/bin/whisper-cli",
            setup: { step: "download", received: 71_000_000, total: 142_000_000 },
          },
        })
      return Response.json({
        data: { ...notReady, ready: true, whisper: "/usr/bin/whisper-cli", model: "/data/whisper/ggml-base.en.bin" },
      })
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)

  setup.mockInput.typeText("/voice-setup")
  await setup.waitForFrame((text) => text.includes("Set up voice input"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((text) => text.includes("On this computer, English") && text.includes("142 MB download"))
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
  setup.mockInput.pressEnter()

  await setup.waitForFrame((text) => text.includes("Downloading the model… 50% (71 of 142 MB)"), { maxPasses: 90 })
  expect(requests).toEqual([{ model: "base.en" }])
  await setup.waitForFrame((text) => text.includes("Voice input is ready"), { maxPasses: 120 })
})
