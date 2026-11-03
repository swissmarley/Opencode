import { beforeEach, expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { allSkins } from "../src/skin"

// Other app tests can leave a home draft in the process-wide stash, which these tests type after.
beforeEach(() => {
  takeDraft(undefined)
})

// Ramp glyphs that the home screen never draws itself, as in vortex-app.test.tsx.
const glyphs = /[·$&#@]/g
const backgroundCells = (frame: string) => frame.match(glyphs)?.length ?? 0

// Skins restyle the chrome only: the animated background is a separate setting they never change.
test.each(Object.keys(allSkins()))("the %s skin keeps the vortex background", async (id) => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "vortex", skin: id, theme: { name: allSkins()[id]?.theme ?? "opencode" } },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await settled(setup, (frame) => backgroundCells(frame) > 50)
})

test("choosing a skin with /skins leaves the background setting and vortex in place", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "vortex" },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await settled(setup, (frame) => backgroundCells(frame) > 50)

  setup.mockInput.typeText("/skins")
  await setup.waitForFrame((frame) => frame.includes("Browse") || frame.includes("Switch skin"))
  setup.mockInput.pressEnter()
  await setup.waitFor(
    () =>
      setup.captureCharFrame().includes("LCD Classic") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.typeText("neon")
  await setup.waitForFrame((frame) => frame.includes("Neon Arcade"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().skin === "neon-arcade")

  expect(setup.config().background).toBe("vortex")
  await settled(setup, (frame) => backgroundCells(frame) > 50 && !frame.includes("Search skins"))
})

async function settled(setup: Awaited<ReturnType<typeof createAppFixture>>, matches: (frame: string) => boolean) {
  const started = Date.now()
  while (!matches(setup.captureCharFrame())) {
    if (Date.now() - started > 5_000)
      throw new Error(`Timed out waiting for the background frame:\n${setup.captureCharFrame()}`)
    await Bun.sleep(25)
  }
  return setup.captureCharFrame()
}
