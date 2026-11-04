import { beforeEach, expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
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
