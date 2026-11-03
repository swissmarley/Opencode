import type { OpenCodeEvent, PermissionRequest } from "@opencode/client"
import { canonicalToolName } from "../util/tool-display"
import { parseTodos } from "../util/todo"
import type { MascotState } from "./motion"

/**
 * What the mascot knows and says. `trackEvent` folds the live event stream into a small per-session record of what
 * each running session is doing right now (the current tool and its input, whether the model is reasoning or
 * replying, steps, tools, edited files, todos) and into short reactions to outcomes. It reads only event payloads, so
 * it follows background sessions whose transcripts are not loaded. `mascotView` then picks what to show: requests
 * that need the user first, then a fresh reaction, then the work in progress, then the last outcome.
 */

// How long each reaction stays up, in milliseconds.
export const REACTION = {
  saved: 1_400,
  oops: 2_200,
  done: 6_000,
  failed: 9_000,
  stopped: 3_000,
} as const
/** After this long with nothing happening the mascot dozes off. */
export const SLEEP_AFTER = 120_000

type LiveTool = { id: string; name: string; input?: Record<string, unknown> }

export type LiveSession = {
  started: number
  updated: number
  steps: number
  tools: number
  files: string[]
  todos?: { done: number; total: number }
  phase?: "reasoning" | "text"
  tool?: LiveTool
  /** The tail of the assistant's latest reply, for live messages and the summary when it finishes. */
  reply: string
  retry?: { attempt: number; at: number; message: string }
}

export type Reaction = {
  state: Extract<MascotState, "success" | "error" | "completed" | "idle">
  /** Flashes play over work in progress; outcomes show once a session has stopped. */
  kind: "flash" | "outcome"
  sessionID: string
  message: string
  detail?: string
  until: number
}

export type MascotTracker = {
  sessions: Map<string, LiveSession>
  reaction?: Reaction
}

export type SessionLookup = {
  /** Whether the session is a subagent's child session. */
  child(sessionID: string): boolean
  /** Whether a direct child of the session is still running, so the parent is not really done. */
  busyChildren(sessionID: string): boolean
}

export function createTracker(): MascotTracker {
  return { sessions: new Map() }
}

/** Folds one event into `tracker`. Returns whether anything the mascot shows may have changed. */
export function trackEvent(tracker: MascotTracker, event: OpenCodeEvent, now: number, lookup: SessionLookup) {
  if (!event.type.startsWith("session.")) return false
  const data = event.data as { sessionID?: string }
  const sessionID = data.sessionID
  if (!sessionID) return false
  const live = () => {
    const existing = tracker.sessions.get(sessionID)
    if (existing) {
      existing.updated = now
      return existing
    }
    const created: LiveSession = { started: now, updated: now, steps: 0, tools: 0, files: [], reply: "" }
    tracker.sessions.set(sessionID, created)
    return created
  }
  const react = (reaction: Omit<Reaction, "sessionID" | "until">, duration: number) => {
    tracker.reaction = { ...reaction, sessionID, until: now + duration }
  }

  switch (event.type) {
    case "session.execution.started": {
      tracker.sessions.set(sessionID, { started: now, updated: now, steps: 0, tools: 0, files: [], reply: "" })
      if (tracker.reaction?.sessionID === sessionID) tracker.reaction = undefined
      return true
    }
    case "session.step.started": {
      const session = live()
      session.steps++
      session.phase = undefined
      session.tool = undefined
      session.retry = undefined
      return true
    }
    case "session.reasoning.started":
      live().phase = "reasoning"
      return true
    case "session.reasoning.ended":
      live().phase = undefined
      return true
    case "session.text.started": {
      const session = live()
      session.phase = "text"
      session.reply = ""
      return true
    }
    case "session.text.delta": {
      const session = live()
      session.phase = "text"
      session.reply = (session.reply + event.data.delta).slice(-600)
      return true
    }
    case "session.text.ended": {
      const session = live()
      session.phase = undefined
      session.reply = event.data.text.slice(-600)
      return true
    }
    case "session.tool.input.started": {
      const session = live()
      session.phase = undefined
      session.tool = { id: event.data.id, name: event.data.name }
      return true
    }
    case "session.tool.called": {
      const session = live()
      const name = session.tool?.id === event.data.id ? session.tool.name : "tool"
      session.phase = undefined
      session.tool = { id: event.data.id, name, input: event.data.input }
      session.tools++
      const tool = canonicalToolName(name)
      const path = inputPath(event.data.input)
      if ((tool === "edit" || tool === "write") && path && !session.files.includes(path)) session.files.push(path)
      if (tool === "todowrite") {
        const todos = parseTodos(event.data.input.todos)
        session.todos = {
          done: todos.filter((todo) => todo.status === "completed").length,
          total: todos.filter((todo) => todo.status !== "cancelled").length,
        }
      }
      return true
    }
    case "session.tool.success": {
      const session = live()
      const tool = session.tool?.id === event.data.id ? session.tool : undefined
      if (tool) session.tool = undefined
      const name = canonicalToolName(tool?.name ?? "")
      if (name === "edit" || name === "write" || name === "patch") {
        const path = inputPath(tool?.input)
        react({ state: "success", kind: "flash", message: path ? `Saved ${basename(path)}` : "Saved" }, REACTION.saved)
      }
      return true
    }
    case "session.tool.failed": {
      const session = live()
      const tool = session.tool?.id === event.data.id ? session.tool : undefined
      if (tool) session.tool = undefined
      react(
        {
          state: "error",
          kind: "flash",
          message: `Oops, ${toolLabel(tool?.name ?? "a tool")} failed`,
          detail: event.data.error.message,
        },
        REACTION.oops,
      )
      return true
    }
    case "session.retry.scheduled":
      live().retry = { attempt: event.data.attempt, at: event.data.at, message: event.data.error.message }
      return true
    case "session.step.failed":
      react(
        { state: "error", kind: "flash", message: "That step failed", detail: event.data.error.message },
        REACTION.oops,
      )
      return true
    case "session.execution.succeeded": {
      const session = tracker.sessions.get(sessionID)
      tracker.sessions.delete(sessionID)
      if (lookup.child(sessionID)) {
        react({ state: "success", kind: "flash", message: "A subagent finished" }, REACTION.saved)
        return true
      }
      // A running subagent's report wakes the session again, so it is not done yet.
      if (lookup.busyChildren(sessionID)) return true
      react(
        {
          state: "completed",
          kind: "outcome",
          message: "All done!",
          detail: session ? summary(session, now) : undefined,
        },
        REACTION.done,
      )
      return true
    }
    case "session.execution.failed":
      tracker.sessions.delete(sessionID)
      react(
        { state: "error", kind: "outcome", message: "Something went wrong", detail: event.data.error.message },
        REACTION.failed,
      )
      return true
    case "session.execution.interrupted":
      tracker.sessions.delete(sessionID)
      if (event.data.reason === "user")
        react({ state: "idle", kind: "outcome", message: "Okay, stopped." }, REACTION.stopped)
      return true
  }
  return false
}

export type MascotView = {
  state: MascotState
  /** Status feedback for the speech bubble's rail; undefined is neutral. */
  tone?: "info" | "success" | "warning" | "error"
  message?: string
  detail?: string
  /** A file the detail line names, for the caller to show relative to the project. */
  path?: string
  progress?: string
  sessionID?: string
  /** A permission request the mascot can approve or deny, and how many are waiting in all. */
  approval?: PermissionRequest
  pending?: number
  /** A question form waiting for an answer in its session. */
  question?: { sessionID: string; title: string }
}

export type ViewInput = {
  tracker: MascotTracker
  now: number
  /** The root of the session on screen, if any. */
  focus?: string
  root(sessionID: string): string
  running(sessionID: string): boolean
  permissions: readonly PermissionRequest[]
  questions: ReadonlyArray<{ sessionID: string; title: string }>
  /** Milliseconds since anything happened, including the user's own input. */
  quiet: number
}

export function mascotView(input: ViewInput): MascotView {
  // Anything waiting on the user comes first, preferring the session on screen.
  const approval =
    input.permissions.find((request) => input.root(request.sessionID) === input.focus) ?? input.permissions[0]
  if (approval)
    return {
      state: "waiting",
      tone: "warning",
      approval,
      pending: input.permissions.length,
      sessionID: approval.sessionID,
    }
  const question = input.questions.find((form) => input.root(form.sessionID) === input.focus) ?? input.questions[0]
  if (question)
    return {
      state: "waiting",
      tone: "warning",
      question,
      message: "I have a question for you",
      detail: question.title,
      sessionID: question.sessionID,
    }

  const reaction =
    input.tracker.reaction && input.tracker.reaction.until > input.now ? input.tracker.reaction : undefined
  if (reaction?.kind === "flash") return fromReaction(reaction)

  const working = activeSession(input)
  if (working) return activity(working.sessionID, working.session, input.now)
  if (reaction) return fromReaction(reaction)

  // A session can be running before this client saw it start, such as one resumed before launch.
  const busy = input.focus && input.running(input.focus) ? input.focus : undefined
  if (busy) return { state: "thinking", tone: "info", message: "Working on it…", sessionID: busy }
  return { state: input.quiet > SLEEP_AFTER ? "sleeping" : "idle" }
}

function fromReaction(reaction: Reaction): MascotView {
  return {
    state: reaction.state,
    tone: reaction.state === "error" ? "error" : reaction.state === "idle" ? undefined : "success",
    message: reaction.message,
    detail: reaction.detail,
    sessionID: reaction.sessionID,
  }
}

/** The running session to follow: the most recently active one in the focused session's family, else any. */
function activeSession(input: ViewInput) {
  const sessions = Array.from(input.tracker.sessions.entries())
    .filter(([sessionID]) => input.running(sessionID))
    .sort((a, b) => b[1].updated - a[1].updated)
  const focused = sessions.find(([sessionID]) => input.focus !== undefined && input.root(sessionID) === input.focus)
  const [sessionID, session] = focused ?? sessions[0] ?? []
  if (!sessionID || !session) return
  return { sessionID, session }
}

function activity(sessionID: string, session: LiveSession, now: number): MascotView {
  const progress = progressLine(session, now)
  if (session.retry) {
    const wait = Math.max(0, Math.ceil((session.retry.at - now) / 1000))
    return {
      state: "waiting",
      tone: "warning",
      message: wait > 0 ? `Retrying in ${wait}s (attempt ${session.retry.attempt})` : "Retrying…",
      detail: session.retry.message,
      progress,
      sessionID,
    }
  }
  if (session.tool) return { ...toolActivity(session.tool), tone: "info", progress, sessionID }
  if (session.phase === "text") {
    const line = lastLine(session.reply)
    return { state: "talking", tone: "info", message: line || "Writing a reply…", progress, sessionID }
  }
  if (session.phase === "reasoning")
    return { state: "thinking", tone: "info", message: "Thinking…", progress, sessionID }
  return {
    state: "thinking",
    tone: "info",
    message: session.steps > 1 ? "Mulling it over…" : "On it!",
    progress,
    sessionID,
  }
}

/** The pose and words for a tool call, from its name and as much of its input as has arrived. */
export function toolActivity(tool: LiveTool): { state: MascotState; message: string; detail?: string; path?: string } {
  const input = tool.input ?? {}
  const name = canonicalToolName(tool.name)
  const path = inputPath(input)
  const file = path ? basename(path) : "a file"
  const pattern = text(input.pattern) || text(input.query)
  switch (name) {
    case "read":
      return { state: "reading", message: `Reading ${file}`, path }
    case "list":
      return { state: "reading", message: `Looking around ${path ? basename(path) : "the project"}`, path }
    case "webfetch":
      return { state: "reading", message: `Fetching ${host(text(input.url)) || "a page"}`, detail: text(input.url) }
    case "skill":
      return { state: "reading", message: "Loading a skill", detail: text(input.name) }
    case "grep":
      return { state: "searching", message: pattern ? `Searching for “${pattern}”` : "Searching the code", path }
    case "glob":
      return { state: "searching", message: pattern ? `Finding ${pattern}` : "Finding files", path }
    case "websearch":
    case "codesearch":
      return { state: "searching", message: "Searching the web", detail: pattern }
    case "edit":
      return { state: "coding", message: `Editing ${file}`, path }
    case "write":
      return { state: "coding", message: `Writing ${file}`, path }
    case "patch":
      return { state: "coding", message: "Applying a patch", detail: patchFiles(text(input.patchText)) }
    case "shell": {
      const command = lastLine(text(input.command), false)
      return {
        state: "coding",
        message: text(input.description) || "Running a command",
        detail: command ? `$ ${command}` : undefined,
      }
    }
    case "execute":
      return { state: "coding", message: "Running code" }
    case "subagent":
      return {
        state: "thinking",
        message: `Asking the ${text(input.agent) || text(input.subagent_type) || "general"} agent`,
        detail: text(input.description),
      }
    case "todowrite":
      return { state: "thinking", message: "Planning the next steps" }
    case "question":
      return { state: "waiting", message: "Asking you something" }
  }
  return { state: "coding", message: `Using ${toolLabel(tool.name)}` }
}

function progressLine(session: LiveSession, now: number) {
  return [
    session.steps > 1 ? `step ${session.steps}` : undefined,
    session.tools > 0 ? `${session.tools} ${session.tools === 1 ? "tool" : "tools"}` : undefined,
    session.files.length > 0 ? `${session.files.length} ${session.files.length === 1 ? "file" : "files"}` : undefined,
    session.todos && session.todos.total > 0 ? `todos ${session.todos.done}/${session.todos.total}` : undefined,
    elapsed(now - session.started),
  ]
    .filter((part) => part !== undefined)
    .join(" · ")
}

function summary(session: LiveSession, now: number) {
  const reply = firstSentence(session.reply)
  if (reply) return reply
  return progressLine(session, now)
}

export function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function inputPath(input: Record<string, unknown> | undefined) {
  if (!input) return ""
  return text(input.path) || text(input.filePath) || text(input.filepath)
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function host(url: string) {
  return URL.canParse(url) ? new URL(url).host : ""
}

function toolLabel(name: string) {
  return canonicalToolName(name).replace(/[_-]+/g, " ")
}

function patchFiles(patch: string) {
  const files = Array.from(patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm), (match) =>
    basename(match[1]!),
  )
  if (files.length === 0) return
  return files.length > 3 ? `${files.slice(0, 3).join(", ")} +${files.length - 3}` : files.join(", ")
}

/** The last non-empty line of `value` as plain text, so a streaming reply reads like speech. */
function lastLine(value: string, plain = true) {
  const line = value
    .split("\n")
    .map((part) => part.trim())
    .findLast((part) => part.length > 0 && !part.startsWith("```"))
  if (!line) return ""
  return plain ? stripMarkdown(line) : line
}

/** The reply's opening sentence, skipping headings, for the summary when a session finishes. */
function firstSentence(value: string) {
  const line = value
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith("#") && !part.startsWith("```"))
    .map(stripMarkdown)
    .find((part) => part.length > 0)
  if (!line) return ""
  return line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line
}

function stripMarkdown(line: string) {
  return line
    .replace(/^(?:#+|[-*+]|\d+\.)\s+/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
}
