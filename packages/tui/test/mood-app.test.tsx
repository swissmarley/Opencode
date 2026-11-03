import { beforeEach, expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"
import { takeDraft } from "../src/component/prompt/draft-stash"

// Other app tests can leave a home draft in the process-wide stash, which these tests type after.
beforeEach(() => {
  takeDraft(undefined)
})

// Vortex ramp glyphs the home screen never draws itself, as in vortex-app.test.tsx.
const vortexCells = (frame: string) => frame.match(/[·$&#@]/g)?.length ?? 0
// Only the katakana: digits are also matrix glyphs but can appear in ordinary UI text.
const matrixCells = (frame: string) => frame.match(/[\uFF66-\uFF9D]/g)?.length ?? 0

test("/mood:matrix and /mood:vortex switch the animated background", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "vortex" },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await settled(setup, (frame) => vortexCells(frame) > 50 && matrixCells(frame) === 0)

  await mood(setup, "matrix")
  expect(setup.config().background).toBe("matrix")
  await settled(setup, (frame) => matrixCells(frame) > 50 && vortexCells(frame) === 0)

  await mood(setup, "vortex")
  expect(setup.config().background).toBe("vortex")
  await settled(setup, (frame) => vortexCells(frame) > 50 && matrixCells(frame) === 0)
})

test("/mood:<name> paints each of the newer moods into the empty background", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "off" },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await setup.waitForVisualIdle()
  const off = setup.captureCharFrame().split("\n")
  // Cells that were blank with the background off and now hold a glyph.
  const painted = (frame: string) =>
    frame
      .split("\n")
      .flatMap((line, y) => Array.from(line).filter((char, x) => char !== " " && Array.from(off[y] ?? "")[x] === " "))
      .length

  for (const name of ["ripple", "warp", "embers", "aurora"] as const) {
    await mood(setup, name)
    expect(setup.config().background).toBe(name)
    await settled(setup, (frame) => painted(frame) > 50 && !frame.includes(`Mood: ${name}`))
  }
})

async function mood(setup: Awaited<ReturnType<typeof createAppFixture>>, name: string) {
  setup.mockInput.typeText(`/mood:${name}`)
  await setup.waitForFrame((frame) => frame.includes(`Switch mood to ${name}`))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().background === name)
}

async function settled(setup: Awaited<ReturnType<typeof createAppFixture>>, matches: (frame: string) => boolean) {
  const started = Date.now()
  while (!matches(setup.captureCharFrame())) {
    if (Date.now() - started > 5_000)
      throw new Error(`Timed out waiting for the background frame:\n${setup.captureCharFrame()}`)
    await Bun.sleep(25)
  }
  return setup.captureCharFrame()
}

test("/mood previews moods live, saves on select and restores on cancel", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "vortex" },
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await settled(setup, (frame) => vortexCells(frame) > 50)

  // Moving to a mood previews it behind the dialog without saving it; escape brings the saved mood back.
  await openPicker(setup)
  setup.mockInput.typeText("matrix")
  await settled(setup, (frame) => matrixCells(frame) > 50)
  expect(setup.config().background).toBe("vortex")
  setup.mockInput.pressEscape()
  await settled(setup, (frame) => vortexCells(frame) > 50 && matrixCells(frame) === 0 && !pickerOpen(frame))
  expect(setup.config().background).toBe("vortex")

  await openPicker(setup)
  setup.mockInput.typeText("matrix")
  await settled(setup, (frame) => matrixCells(frame) > 50)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().background === "matrix")
  await settled(setup, (frame) => matrixCells(frame) > 50 && !pickerOpen(frame))
})

// The dialog title and a row, which stay put while the dialog animates in and its placeholder is still truncated.
const pickerOpen = (frame: string) => frame.includes("Moods") && frame.includes("Watermark")

async function openPicker(setup: Awaited<ReturnType<typeof createAppFixture>>) {
  setup.mockInput.typeText("/mood")
  await setup.waitForFrame((frame) => frame.includes("Switch mood "))
  setup.mockInput.pressEnter()
  await setup.waitFor(
    () => pickerOpen(setup.captureCharFrame()) && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
}
