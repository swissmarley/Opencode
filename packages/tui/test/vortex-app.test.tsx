import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"
import { VORTEX_RAMP } from "../src/ui/vortex"

// Ramp glyphs that the home screen never draws itself (`+`, `x`, `.` and friends do appear in its text).
const glyphs = /[·$&#@]/g
const backgroundCells = (frame: string) => frame.match(glyphs)?.length ?? 0

test("the app composites the vortex behind the UI and the toggle cycles it off", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    // Animations off keeps the frame still; an explicit background still paints its first frame.
    config: { animations: false, background: "vortex", keybinds: { "app.toggle.background": "f7" } },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await setup.waitForVisualIdle()
  const vortex = setup.captureCharFrame()
  expect(backgroundCells(vortex)).toBeGreaterThan(50)

  setup.mockInput.pressKey("F7")
  await setup.waitFor(() => setup.config().background === "watermark")
  for (const mood of ["matrix", "ripple", "warp", "embers", "aurora", "off"]) {
    setup.mockInput.pressKey("F7")
    await setup.waitFor(() => setup.config().background === mood)
  }
  // The mode toast clears after a moment; compare against the settled frame.
  const off = await settled(setup, (frame) => backgroundCells(frame) === 0 && !frame.includes("Background: "))

  // Everything that is not background is identical with and without the vortex.
  const offLines = off.split("\n")
  vortex.split("\n").forEach((line, y) => {
    Array.from(line).forEach((char, x) => {
      const plain = Array.from(offLines[y]!)[x]
      if (char !== plain) {
        expect(plain).toBe(" ")
        expect(VORTEX_RAMP.includes(char)).toBe(true)
      }
    })
  })

  setup.mockInput.pressKey("F7")
  await setup.waitFor(() => setup.config().background === "vortex")
  await settled(setup, (frame) => backgroundCells(frame) > 50)
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
