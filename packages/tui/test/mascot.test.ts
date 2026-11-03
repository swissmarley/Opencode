import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, PermissionRequest } from "@opencode/client"
import {
  createTracker,
  mascotView,
  REACTION,
  SLEEP_AFTER,
  toolActivity,
  trackEvent,
  type MascotTracker,
  type SessionLookup,
  type ViewInput,
} from "../src/mascot/brain"
import { MASCOT_STATES, motion } from "../src/mascot/motion"
import { ACCENTS, drawPose, Px, SPRITE_HEIGHT, SPRITE_WIDTH, spritePalette } from "../src/mascot/sprite"

const lookup: SessionLookup = { child: (id) => id.startsWith("ses_child"), busyChildren: () => false }

function feed(tracker: MascotTracker, at: number, type: string, data: Record<string, unknown>, sessions = lookup) {
  return trackEvent(tracker, { id: `evt_${type}_${at}`, created: at, type, data } as OpenCodeEvent, at, sessions)
}

function view(tracker: MascotTracker, input: Partial<ViewInput> = {}) {
  return mascotView({
    tracker,
    now: 1_000,
    root: (id) => (id.startsWith("ses_child") ? "ses_a" : id),
    running: (id) => tracker.sessions.has(id),
    permissions: [],
    questions: [],
    quiet: 0,
    ...input,
  })
}

function tool(tracker: MascotTracker, at: number, sessionID: string, id: string, name: string, input: object) {
  feed(tracker, at, "session.tool.input.started", { sessionID, assistantMessageID: "msg_1", id, name })
  feed(tracker, at, "session.tool.called", { sessionID, assistantMessageID: "msg_1", id, input, executed: false })
}

function permission(id: string, sessionID: string): PermissionRequest {
  return { id, sessionID, action: "bash", resources: ["bun test"] } as PermissionRequest
}

describe("mascot brain", () => {
  test.each([
    ["read", { path: "/repo/src/app.tsx" }, "reading", "Reading app.tsx"],
    ["list", { path: "/repo/src" }, "reading", "Looking around src"],
    ["webfetch", { url: "https://opencode.ai/docs" }, "reading", "Fetching opencode.ai"],
    ["grep", { pattern: "createMascot" }, "searching", "Searching for “createMascot”"],
    ["glob", { pattern: "**/*.ts" }, "searching", "Finding **/*.ts"],
    ["websearch", { query: "pixel art" }, "searching", "Searching the web"],
    ["edit", { filePath: "/repo/src/mascot.tsx" }, "coding", "Editing mascot.tsx"],
    ["write", { path: "/repo/README.md" }, "coding", "Writing README.md"],
    ["bash", { command: "bun test" }, "coding", "Running a command"],
    ["task", { description: "Find the config", subagent_type: "explore" }, "thinking", "Asking the explore agent"],
    ["todowrite", { todos: [] }, "thinking", "Planning the next steps"],
    ["github_create_issue", {}, "coding", "Using github create issue"],
  ] as const)("%s acts out the tool", (name, input, state, message) => {
    expect(toolActivity({ id: "call_1", name, input })).toMatchObject({ state, message })
  })

  test("names the command a shell call runs", () => {
    expect(toolActivity({ id: "call_1", name: "bash", input: { command: "cd app\nbun test" } })).toMatchObject({
      detail: "$ bun test",
    })
  })

  test("follows a session through thinking, tools and a streaming reply, with progress", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.step.started", { sessionID: "ses_a" })
    expect(view(tracker)).toMatchObject({ state: "thinking", message: "On it!", progress: "0:01" })

    feed(tracker, 100, "session.reasoning.started", { sessionID: "ses_a" })
    expect(view(tracker)).toMatchObject({ state: "thinking", message: "Thinking…" })

    feed(tracker, 200, "session.reasoning.ended", { sessionID: "ses_a" })
    tool(tracker, 300, "ses_a", "call_1", "edit", { path: "/repo/a.ts" })
    feed(tracker, 300, "session.tool.called", {
      sessionID: "ses_a",
      assistantMessageID: "msg_1",
      id: "call_2",
      input: {
        todos: [
          { content: "one", status: "completed" },
          { content: "two", status: "pending" },
        ],
      },
      executed: false,
    })
    feed(tracker, 400, "session.step.started", { sessionID: "ses_a" })
    feed(tracker, 500, "session.text.started", { sessionID: "ses_a" })
    feed(tracker, 500, "session.text.delta", {
      sessionID: "ses_a",
      delta: "Done with the edit.\n\n**Next** I'll run the `tests`",
    })
    expect(view(tracker, { now: 75_000 })).toMatchObject({
      state: "talking",
      message: "Next I'll run the tests",
      progress: "step 2 · 2 tools · 1 file · 1:15",
    })
  })

  test("a request for permission comes first, preferring the session on screen", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    tool(tracker, 0, "ses_a", "call_1", "read", { path: "/repo/a.ts" })
    const permissions = [permission("per_other", "ses_b"), permission("per_here", "ses_child_1")]
    expect(view(tracker, { permissions, focus: "ses_a" })).toMatchObject({
      state: "waiting",
      tone: "warning",
      approval: { id: "per_here" },
      pending: 2,
    })
    expect(view(tracker, { permissions })).toMatchObject({ approval: { id: "per_other" } })
    expect(view(tracker, { questions: [{ sessionID: "ses_b", title: "Which file?" }] })).toMatchObject({
      state: "waiting",
      question: { sessionID: "ses_b" },
      detail: "Which file?",
    })
  })

  test("a saved file flashes success over the work, then the work shows again", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    tool(tracker, 0, "ses_a", "call_1", "write", { path: "/repo/notes.md" })
    feed(tracker, 1_000, "session.tool.success", { sessionID: "ses_a", id: "call_1", content: [] })
    expect(view(tracker, { now: 1_000 })).toMatchObject({ state: "success", message: "Saved notes.md" })
    expect(view(tracker, { now: 1_000 + REACTION.saved })).toMatchObject({ state: "thinking" })
  })

  test("a failed tool flinches with the error", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    tool(tracker, 0, "ses_a", "call_1", "bash", { command: "exit 1" })
    feed(tracker, 1_000, "session.tool.failed", { sessionID: "ses_a", id: "call_1", error: { message: "exit code 1" } })
    expect(view(tracker, { now: 1_000 })).toMatchObject({
      state: "error",
      message: "Oops, shell failed",
      detail: "exit code 1",
    })
  })

  test("celebrates a finished session with the reply's first sentence", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.text.ended", { sessionID: "ses_a", text: "## Summary\nAdded the mascot. Tests pass." })
    feed(tracker, 1_000, "session.execution.succeeded", { sessionID: "ses_a" })
    expect(view(tracker, { now: 1_000 })).toMatchObject({
      state: "completed",
      tone: "success",
      message: "All done!",
      detail: "Added the mascot.",
    })
    expect(view(tracker, { now: 1_000 + REACTION.done })).toMatchObject({ state: "idle" })
  })

  test("waits for running subagents before celebrating, and cheers when one finishes", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.execution.succeeded", { sessionID: "ses_a" }, { ...lookup, busyChildren: () => true })
    expect(view(tracker)).toMatchObject({ state: "idle" })

    feed(tracker, 0, "session.execution.started", { sessionID: "ses_child_1" })
    feed(tracker, 500, "session.execution.succeeded", { sessionID: "ses_child_1" })
    expect(view(tracker, { now: 500 })).toMatchObject({ state: "success", message: "A subagent finished" })
  })

  test("reports failures and user interruptions, and ignores shutdowns", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.execution.failed", { sessionID: "ses_a", error: { message: "Provider overloaded" } })
    expect(view(tracker, { now: 0 })).toMatchObject({
      state: "error",
      tone: "error",
      message: "Something went wrong",
      detail: "Provider overloaded",
    })

    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.execution.interrupted", { sessionID: "ses_a", reason: "user" })
    expect(view(tracker, { now: 0 })).toMatchObject({ state: "idle", message: "Okay, stopped." })

    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.execution.interrupted", { sessionID: "ses_a", reason: "shutdown" })
    expect(view(tracker, { now: 0 })).toEqual({ state: "idle" })
  })

  test("follows the session on screen, including its subagents, over other running sessions", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    tool(tracker, 0, "ses_a", "call_1", "task", { subagent_type: "explore" })
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_child_1" })
    tool(tracker, 10, "ses_child_1", "call_2", "grep", { pattern: "needle" })
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_b" })
    tool(tracker, 20, "ses_b", "call_3", "read", { path: "/repo/b.ts" })

    expect(view(tracker, { focus: "ses_a" })).toMatchObject({ state: "searching", sessionID: "ses_child_1" })
    expect(view(tracker, { focus: "ses_b" })).toMatchObject({ state: "reading", sessionID: "ses_b" })
    // Without a session on screen, the most recently active one leads.
    expect(view(tracker)).toMatchObject({ state: "reading", sessionID: "ses_b" })
  })

  test("counts down a scheduled retry", () => {
    const tracker = createTracker()
    feed(tracker, 0, "session.execution.started", { sessionID: "ses_a" })
    feed(tracker, 0, "session.retry.scheduled", {
      sessionID: "ses_a",
      attempt: 2,
      at: 6_000,
      error: { message: "Rate limited" },
    })
    expect(view(tracker, { now: 1_000 })).toMatchObject({
      state: "waiting",
      message: "Retrying in 5s (attempt 2)",
      detail: "Rate limited",
    })
  })

  test("dozes off after a long quiet spell, and a session already running keeps it busy", () => {
    const tracker = createTracker()
    expect(view(tracker, { quiet: SLEEP_AFTER - 1 })).toEqual({ state: "idle" })
    expect(view(tracker, { quiet: SLEEP_AFTER + 1 })).toEqual({ state: "sleeping" })
    expect(view(tracker, { focus: "ses_a", running: () => true })).toMatchObject({ state: "thinking" })
  })

  test("ignores events that are not about a session", () => {
    expect(feed(createTracker(), 0, "project.updated", { id: "proj_1" })).toBe(false)
  })
})

describe("mascot sprite", () => {
  test("every state animates within the canvas, standing on its body", () => {
    MASCOT_STATES.forEach((state) => {
      for (let tick = 0; tick < 48; tick++) {
        const frame = motion({ state, age: tick, clock: tick })
        const grid = drawPose(frame.pose)
        expect(grid.length).toBe(SPRITE_WIDTH * SPRITE_HEIGHT)
        expect(grid.filter((px) => px === Px.Screen).length).toBeGreaterThan(20)
        expect(grid.every((px) => px <= Px.Shadow)).toBe(true)
      }
    })
  })

  test("is deterministic, so a pose always draws the same pixels", () => {
    const input = { state: "completed", age: 5, clock: 41 } as const
    expect(drawPose(motion(input).pose)).toEqual(drawPose(motion(input).pose))
  })

  test("each activity has its own look and status colour", () => {
    const at = (state: (typeof MASCOT_STATES)[number]) => drawPose(motion({ state, age: 1, clock: 1 }).pose).join("")
    const looks = new Set(MASCOT_STATES.map(at))
    expect(looks.size).toBe(MASCOT_STATES.length)
    expect(MASCOT_STATES.every((state) => ACCENTS[state] !== undefined)).toBe(true)
    expect(spritePalette("error", "on")[Px.Accent]).not.toEqual(spritePalette("coding", "on")[Px.Accent])
  })

  test("the eyes follow what caught them", () => {
    const left = drawPose(motion({ state: "idle", age: 1, clock: 1, look: { x: -1, y: 0 } }).pose)
    const right = drawPose(motion({ state: "idle", age: 1, clock: 1, look: { x: 1, y: 0 } }).pose)
    const eyes = (grid: Uint8Array) =>
      Array.from(grid).flatMap((px, index) => (px === Px.Eye ? [index % SPRITE_WIDTH] : []))
    expect(Math.min(...eyes(right))).toBe(Math.min(...eyes(left)) + 2)
  })

  test("a poke makes it hop with a heart", () => {
    const resting = drawPose(motion({ state: "idle", age: 1, clock: 1 }).pose)
    const poked = motion({ state: "idle", age: 1, clock: 1, poked: 2 })
    expect(poked.pose.y).toBeLessThan(0)
    expect(poked.pose.decor).toContainEqual(expect.objectContaining({ kind: "heart" }))
    expect(drawPose(poked.pose)).not.toEqual(resting)
  })
})
