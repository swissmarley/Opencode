import { expect, test } from "bun:test"
import { InputRenderable, RGBA, TextareaRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

type Setup = Awaited<ReturnType<typeof createAppFixture>>

// The opencode theme in dark mode, which the fixture's terminal reports: the highlighted row of a dialog is drawn in the
// primary hue, orange by default.
const ORANGE = RGBA.fromHex("#fab283")
const GREEN = RGBA.fromHex("#7fd88f")

test("/appearance previews a primary color across the interface and saves it on select", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 110,
    height: 40,
    config: { animations: false, background: "off" },
  })
  await openAppearance(setup)
  expect(setup.captureCharFrame()).toContain("Colors")
  expect(setup.captureCharFrame()).toContain("Interface")

  await openRow(setup, "Primary color", "Theme default")
  await highlighted(setup, "Theme default", ORANGE)
  await focused(setup)

  // Moving to a color previews it without saving; escape goes back to the menu with the saved color.
  setup.mockInput.typeText("green")
  await highlighted(setup, "Green", GREEN)
  expect(setup.config().theme?.primary).toBeUndefined()
  setup.mockInput.pressEscape()
  await highlighted(setup, "Primary color", ORANGE)
  expect(menuOpen(setup)).toBe(true)
  await focused(setup)

  await openRow(setup, "Primary color", "Theme default")
  await focused(setup)
  setup.mockInput.typeText("green")
  await highlighted(setup, "Green", GREEN)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().theme?.primary === "green")
  await highlighted(setup, "Primary color", GREEN)
  expect(menuOpen(setup)).toBe(true)
})

test("/appearance cycles a border with the arrow keys and explains font and size", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 110,
    height: 40,
    config: { animations: false, background: "off" },
  })
  await openAppearance(setup)
  setup.mockInput.typeText("border")
  await setup.waitForFrame(() => highlight(setup, "Border") !== undefined)
  // Each press waits for the last save: the menu ignores changes while one is being written.
  for (const border of ["heavy", "light"]) {
    setup.mockInput.pressArrow("right")
    await setup.waitFor(() => setup.config().border === border)
  }
  for (const border of ["heavy", undefined]) {
    setup.mockInput.pressArrow("left")
    await setup.waitFor(() => setup.config().border === border)
  }

  setup.mockInput.pressEscape()
  await until(setup, () => !menuOpen(setup))
  await openAppearance(setup)
  await openRow(setup, "Font and size", "Font and text size")
  expect(setup.captureCharFrame()).toContain("OpenCode can't change them")
  setup.mockInput.pressEscape()
  await setup.waitForFrame(() => menuOpen(setup) && highlight(setup, "Font and size") !== undefined)
})

const menuOpen = (setup: Setup) => setup.captureCharFrame().includes("Appearance")

/**
 * Background of the dialog row whose text starts with `title`, while it is the highlighted one. Read spans only inside
 * a frame wait: between renders, while the buffer is not being drawn.
 */
function highlight(setup: Setup, title: string) {
  const span = setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.trim().startsWith(title) || span.text.trim().startsWith(`■ ${title}`))
  return span && span.bg.a > 0 ? span.bg : undefined
}

function highlighted(setup: Setup, title: string, color: RGBA) {
  return setup.waitForFrame(() => highlight(setup, title)?.equals(color) === true)
}

async function openAppearance(setup: Setup) {
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  setup.mockInput.typeText("/appearance")
  await setup.waitForFrame((frame) => frame.includes("Customize appearance"))
  setup.mockInput.pressEnter()
  await until(setup, () => menuOpen(setup))
  await focused(setup)
}

/** Searches the menu for `row`, opens it with enter and waits for `opened` to show. */
async function openRow(setup: Setup, row: string, opened: string) {
  setup.mockInput.typeText(row.toLowerCase())
  await setup.waitForFrame(() => highlight(setup, row) !== undefined)
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes(opened))
}

// The search input takes focus on a timer, and keys typed before it are lost.
function focused(setup: Setup) {
  return until(setup, () => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
}

// Polls against a wall-clock deadline rather than a frame budget, for waits that also depend on focus timers.
async function until(setup: Setup, matches: () => boolean) {
  const started = Date.now()
  while (!matches()) {
    if (Date.now() - started > 5_000) throw new Error(`Timed out waiting for the frame:\n${setup.captureCharFrame()}`)
    await Bun.sleep(10)
  }
}
