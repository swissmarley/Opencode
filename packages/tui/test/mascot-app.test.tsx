import { beforeEach, expect, test } from "bun:test"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import path from "node:path"
import type { OpenCodeEvent } from "@opencode/client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { POKE_LINES } from "../src/mascot/mascot"
import { MascotSpriteRenderable } from "../src/mascot/renderable"

// Other app tests can leave a home draft in the process-wide stash, which these tests type after.
beforeEach(() => {
  takeDraft(undefined)
})

type Setup = Awaited<ReturnType<typeof createAppFixture>>

let sequence = 0
function emit(setup: Setup, type: string, data: Record<string, unknown>) {
  setup.events.emit({ id: `evt_mascot_${++sequence}`, created: Date.now(), type, data } as OpenCodeEvent)
}

test("the mascot follows a session live and answers its permission request", async () => {
  await using state = await tmpdir()
  const replies: unknown[] = []
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "off", mascot: true },
    fetch: async (url, request) => {
      if (request.method !== "POST" || url.pathname !== "/api/session/ses_bg/permission/per_1/reply") return
      replies.push(await request.json())
      return new Response(null, { status: 204 })
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await frame(setup, (text) => text.includes("Hi, I'm Tilde!"))

  emit(setup, "session.execution.started", { sessionID: "ses_bg" })
  emit(setup, "session.tool.input.started", {
    sessionID: "ses_bg",
    assistantMessageID: "msg_1",
    id: "call_1",
    name: "read",
  })
  emit(setup, "session.tool.called", {
    sessionID: "ses_bg",
    assistantMessageID: "msg_1",
    id: "call_1",
    input: { path: "/tmp/opencode/packages/tui/src/app.tsx" },
    executed: false,
  })
  await frame(setup, (text) => text.includes("Reading app.tsx") && text.includes("1 tool"))

  emit(setup, "permission.asked", {
    id: "per_1",
    sessionID: "ses_bg",
    action: "bash",
    resources: ["bun test"],
    save: ["bun *"],
  })
  const asked = await frame(setup, (text) => text.includes("Permission needed") && text.includes("Approve"))
  expect(asked).toContain("Always")
  expect(asked).toContain("Deny")

  const [x, y] = locate(asked, "Approve")
  await setup.mockMouse.click(x + 1, y)
  await setup.waitFor(() => replies.length === 1)
  expect(replies[0]).toMatchObject({ decision: "once" })
  await frame(setup, (text) => !text.includes("Permission needed"))

  emit(setup, "session.execution.succeeded", { sessionID: "ses_bg" })
  await frame(setup, (text) => text.includes("All done!"))
})

test("/mascot hides and shows the mascot", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "off", mascot: true },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await frame(setup, (text) => text.includes("Hi, I'm Tilde!"))

  setup.mockInput.typeText("/mascot")
  await setup.waitForFrame((text) => text.includes("Hide the mascot"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().mascot === false)
  await frame(setup, (text) => !text.includes("Hi, I'm Tilde!") && !mascotDrawn(text))

  setup.mockInput.typeText("/mascot")
  await setup.waitForFrame((text) => text.includes("Show the mascot"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.config().mascot === true)
  await frame(setup, mascotDrawn)
})

test("dragging the mascot moves it and remembers the spot, and a click pokes it", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    height: 36,
    config: { animations: false, background: "off", mascot: true },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await frame(setup, (text) => text.includes("Hi, I'm Tilde!"))
  const sprite = find(setup.renderer.root)
  if (!sprite) throw new Error("the mascot's sprite was not found")
  const start = { x: sprite.x, y: sprite.y }

  // Grab the body, which sits in the middle of the sprite, and move it up and to the left.
  await setup.mockMouse.drag(start.x + 10, start.y + 6, start.x - 30, start.y + 2)
  await setup.waitFor(() => sprite.x === start.x - 40 && sprite.y === start.y - 4)
  const saved = path.join(state.path, "test", "tui", "mascot.json")
  await setup.waitFor(() => Bun.file(saved).size > 0)
  expect(await Bun.file(saved).json()).toEqual({ right: 41, bottom: 11 })

  await setup.mockMouse.click(sprite.x + 10, sprite.y + 6)
  const poked = await frame(setup, (text) => POKE_LINES.some((line) => text.includes(line)))
  const said = (text: string) => text.split("\n").findIndex((line) => POKE_LINES.some((poke) => line.includes(poke)))
  expect(said(poked)).toBeLessThan(sprite.y + 4)

  // Near the top edge there is no room above the head, so the bubble drops below it.
  const raised = { x: sprite.x, y: sprite.y }
  await setup.mockMouse.drag(raised.x + 10, raised.y + 6, raised.x + 10, 6)
  await setup.waitFor(() => sprite.y === 0)
  await setup.mockMouse.click(sprite.x + 10, sprite.y + 6)
  const below = await frame(setup, (text) => said(text) >= 4)
  expect(said(below)).toBe(4)
})

function find(node: Renderable): MascotSpriteRenderable | undefined {
  if (node instanceof MascotSpriteRenderable) return node
  return node
    .getChildren()
    .map(find)
    .find((found) => found !== undefined)
}

// The sprite's half blocks in the bottom-right corner, where nothing else on the home screen draws them.
function mascotDrawn(text: string) {
  return text
    .split("\n")
    .slice(-12)
    .some((line) => /[▀▄]/.test(Array.from(line).slice(-24).join("")))
}

/** The column and row where `needle` first appears in a captured frame. */
function locate(text: string, needle: string): [number, number] {
  const rows = text.split("\n")
  const row = rows.findIndex((line) => line.includes(needle))
  return [Array.from(rows[row]!.slice(0, rows[row]!.indexOf(needle))).length, row]
}

async function frame(setup: Setup, matches: (text: string) => boolean) {
  const started = Date.now()
  while (!matches(setup.captureCharFrame())) {
    if (Date.now() - started > 5_000) throw new Error(`Timed out waiting for the mascot:\n${setup.captureCharFrame()}`)
    await Bun.sleep(25)
  }
  return setup.captureCharFrame()
}
