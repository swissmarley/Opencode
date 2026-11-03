import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { PermissionReply, PermissionRequest } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { useEvent } from "../context/event"
import { Keymap } from "../context/keymap"
import { usePathFormatter } from "../context/path-format"
import { useRoute } from "../context/route"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { useToast } from "../ui/toast"
import { permissionPresentation } from "../util/permission"
import { stringWidth } from "../util/string-width"
import { createTracker, mascotView, trackEvent, type MascotView } from "./brain"
import type { MascotState } from "./motion"
import "./renderable"
import type { MascotSpriteRenderable } from "./renderable"
import { SPRITE_HEIGHT, SPRITE_WIDTH } from "./sprite"

const WIDTH = SPRITE_WIDTH
const HEIGHT = SPRITE_HEIGHT / 2
// Default distance from the bottom-right corner: above a session's composer, so it never hides what is typed.
const HOME = { right: 1, bottom: 7 }
const BUBBLE_MAX = 46
// The face's place on the sprite, for working out where the eyes should look.
const FACE = { x: 10, y: 6 }
// Pointer and typing hold the mascot's gaze this long.
const LOOK_HOLD = 2_500
const NOTE_HOLD = 3_200
/** What the mascot says when clicked. */
export const POKE_LINES = [
  "Hehe, that tickles!",
  "Beep boop!",
  "I'm keeping an eye on things.",
  "Need anything? Just ask the agent!",
  "~ at your service ~",
  "Careful, I'm a vintage model.",
]

/** Whether the mascot is shown: on by default, off by default when interface animations are off. */
export function mascotEnabled(config: { mascot?: boolean; animations?: boolean }) {
  return config.mascot ?? config.animations !== false
}

const [pointer, setPointer] = createSignal<{ x: number; y: number; at: number }>()

/** Feeds pointer movement from the app's root so the mascot's eyes can follow it anywhere on screen. */
export function mascotPointer(event: MouseEvent) {
  if (event.type === "move" || event.type === "drag" || event.type === "over")
    setPointer({ x: event.x, y: event.y, at: Date.now() })
}

/**
 * Tilde, the OpenCode mascot: a pixel-art companion floating over the interface that mirrors what the agent is doing
 * in real time. It reads, searches, types, ponders and celebrates with the session's events, shows short status and
 * agent messages in a speech bubble, and offers Approve, Always and Deny for permission requests from any session.
 * It can be dragged anywhere, clicked for a reaction, and follows the pointer with its eyes.
 */
export function Mascot() {
  const config = useConfig()
  const dimensions = useTerminalDimensions()
  const visible = createMemo(() => mascotEnabled(config.data) && dimensions().width >= 44 && dimensions().height >= 16)
  return (
    <Show when={visible()}>
      <MascotOverlay />
    </Show>
  )
}

function MascotOverlay() {
  const config = useConfig()
  const data = useData()
  const event = useEvent()
  const route = useRoute()
  const theme = useTheme()
  const toast = useToast()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const paths = usePathFormatter()
  const animate = createMemo(() => config.data.animations ?? true)

  // Live state from the event stream, plus a slow clock for elapsed times, expiring reactions and dozing off.
  const tracker = createTracker()
  const [version, setVersion] = createSignal(0)
  const [now, setNow] = createSignal(Date.now())
  const [lastActive, setLastActive] = createSignal(Date.now())
  // Pointer and key activity keep it awake; once a second is plenty.
  const stir = () => {
    const time = Date.now()
    if (time - untrack(lastActive) > 1_000) setLastActive(time)
  }
  const lookup = {
    child: (sessionID: string) => data.session.get(sessionID)?.parentID !== undefined,
    busyChildren: (sessionID: string) =>
      data.session
        .family(sessionID)
        .some(
          (child) =>
            child !== sessionID &&
            data.session.get(child)?.parentID === sessionID &&
            data.session.status(child) === "running",
        ),
  }
  onCleanup(
    event.subscribe((next) => {
      if (!trackEvent(tracker, next, Date.now(), lookup)) return
      setVersion((value) => value + 1)
      setLastActive(Date.now())
    }),
  )
  const clock = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(clock))

  const focus = createMemo(() =>
    route.data.type === "session" && route.data.sessionID !== "dummy"
      ? data.session.root(route.data.sessionID)
      : undefined,
  )
  const permissions = createMemo(() =>
    data.session.permission.sessions().flatMap((sessionID) => data.session.permission.list(sessionID) ?? []),
  )
  const questions = createMemo(() =>
    data.session.form
      .sessions()
      .flatMap((sessionID) =>
        (data.session.form.list(sessionID) ?? []).map((form) => ({ sessionID: form.sessionID, title: form.title })),
      ),
  )
  const view = createMemo((): MascotView => {
    version()
    return mascotView({
      tracker,
      now: now(),
      focus: focus(),
      root: (sessionID) => data.session.root(sessionID),
      running: (sessionID) => data.session.status(sessionID) === "running",
      permissions: permissions(),
      questions: questions(),
      quiet: now() - lastActive(),
    })
  })

  // Things the mascot says on its own: a greeting, replies to pokes, and how a decision went.
  const [note, setNote] = createSignal<{ message: string; state?: MascotState; until: number } | undefined>({
    message: "Hi, I'm Tilde! I'll keep you posted.",
    until: Date.now() + 5_000,
  })
  const say = (message: string, state?: MascotState) => setNote({ message, state, until: Date.now() + NOTE_HOLD })
  const currentNote = createMemo(() => {
    const value = note()
    return value && value.until > now() ? value : undefined
  })
  // A new request or outcome takes the floor from whatever the mascot was saying.
  const asking = createMemo(() => view().approval?.id)
  const doing = createMemo(() => view().state)
  createEffect(on([asking, doing], () => setNote(undefined), { defer: true }))

  const [hovered, setHovered] = createSignal(false)
  const state = createMemo((): MascotState => {
    const value = view().state
    const spoken = currentNote()
    if (spoken?.state && (value === "idle" || value === "sleeping")) return spoken.state
    if (value === "sleeping" && hovered()) return "idle"
    return value
  })

  // Position: anchored to the bottom-right corner, saved after a drag, plus a short stroll while idle.
  const [layout, updateLayout] = useStorage().store<{ right?: number; bottom?: number }>("mascot", { initial: {} })
  const [dragged, setDragged] = createSignal<{ right: number; bottom: number }>()
  const [stroll, setStroll] = createSignal(0)
  const [walk, setWalk] = createSignal<-1 | 1>()
  const anchor = () => dragged() ?? { right: layout.right ?? HOME.right, bottom: layout.bottom ?? HOME.bottom }
  const left = createMemo(() =>
    Math.max(0, Math.min(dimensions().width - WIDTH, dimensions().width - WIDTH - anchor().right + stroll())),
  )
  const top = createMemo(() =>
    Math.max(0, Math.min(dimensions().height - HEIGHT, dimensions().height - HEIGHT - anchor().bottom)),
  )

  let strollTimer: ReturnType<typeof setTimeout> | undefined
  let stepTimer: ReturnType<typeof setInterval> | undefined
  let destination: number | undefined
  const stopWalking = () => {
    clearInterval(stepTimer)
    stepTimer = undefined
    destination = undefined
    setWalk(undefined)
  }
  const walkTo = (target: number) => {
    if (destination === target) return
    stopWalking()
    if (target === stroll()) return
    destination = target
    setWalk(target < stroll() ? -1 : 1)
    stepTimer = setInterval(() => {
      const next = stroll() + (target < stroll() ? -1 : 1)
      setStroll(next)
      if (next === target) stopWalking()
    }, 220)
  }
  // Idle and awake, it strolls a few columns left of its spot now and then, and back; any work sends it home.
  createEffect(() => {
    clearTimeout(strollTimer)
    if (state() !== "idle" || !animate() || dragged() || hovered()) {
      if (state() !== "idle") untrack(() => walkTo(0))
      return
    }
    const wander = () => {
      strollTimer = setTimeout(
        () => {
          const room = Math.min(14, left() - stroll() - 1)
          const away = stroll() !== 0 && Math.random() < 0.5
          if (away) walkTo(0)
          else if (room > 3) walkTo(-Math.floor(3 + Math.random() * (room - 3)))
          wander()
        },
        10_000 + Math.random() * 15_000,
      )
    }
    wander()
  })
  onCleanup(() => {
    clearTimeout(strollTimer)
    stopWalking()
  })

  // Eyes follow the pointer, and glance at the caret while the user types.
  const [typedAt, setTypedAt] = createSignal(0)
  const onKey = () => {
    setTypedAt(Date.now())
    stir()
  }
  renderer.keyInput.on("keypress", onKey)
  onCleanup(() => renderer.keyInput.off("keypress", onKey))
  const look = createMemo(() => {
    const time = now()
    const face = { x: left() + FACE.x, y: top() + FACE.y / 2 }
    const target = (() => {
      const cursor = renderer.getCursorState()
      if (time - typedAt() < LOOK_HOLD && cursor.visible) return { x: cursor.x - 1, y: cursor.y - 1 }
      const current = pointer()
      if (current && Date.now() - current.at < LOOK_HOLD) return current
    })()
    if (!target) return
    const dx = target.x - face.x
    const dy = target.y - face.y
    return { x: Math.abs(dx) < 4 ? 0 : Math.sign(dx), y: Math.abs(dy) < 2 ? 0 : Math.sign(dy) }
  })
  createEffect(() => {
    if (pointer()) stir()
  })

  // Pressing and dragging moves the mascot; a press without movement pokes it.
  let press: { x: number; y: number; right: number; bottom: number; moved: boolean } | undefined
  let sprite: MascotSpriteRenderable | undefined
  const onMouseDown = (mouse: MouseEvent) => {
    if (mouse.button !== MouseButton.LEFT) return
    press = { x: mouse.x, y: mouse.y, ...anchor(), moved: false }
    mouse.preventDefault()
    mouse.stopPropagation()
  }
  const onMouseDrag = (mouse: MouseEvent) => {
    if (!press) return
    press.moved = true
    stopWalking()
    setStroll(0)
    setDragged({
      right: Math.max(0, Math.min(dimensions().width - WIDTH, press.right - (mouse.x - press.x))),
      bottom: Math.max(0, Math.min(dimensions().height - HEIGHT, press.bottom - (mouse.y - press.y))),
    })
    mouse.stopPropagation()
  }
  const onMouseUp = (mouse: MouseEvent) => {
    const current = press
    press = undefined
    if (!current) return
    mouse.stopPropagation()
    const moved = dragged()
    if (current.moved && moved) {
      void updateLayout((draft) => {
        draft.right = moved.right
        draft.bottom = moved.bottom
      })
        .catch((error) => console.error("Failed to save the mascot's position", error))
        .finally(() => setDragged(undefined))
      return
    }
    sprite?.poke()
    stir()
    if (!view().approval) say(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]!)
  }

  // Answering a permission request straight from the bubble.
  const [busy, setBusy] = createSignal<string>()
  const reply = (request: PermissionRequest, decision: PermissionReply) => {
    if (busy() === request.id) return
    setBusy(request.id)
    void data.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.id, decision })
      .then(() => {
        if (decision === "reject") say("Okay, I told it no.", "idle")
        else say(decision === "always" ? "Approved, and I'll remember that." : "Approved!", "success")
      })
      .catch((error: unknown) => toast.error(error))
      .finally(() => setBusy(undefined))
  }
  Keymap.createLayer(() => ({
    mode: "global",
    commands: (
      [
        ["mascot.approve", "Approve the permission request shown by the mascot", "once"],
        ["mascot.always", "Always allow the permission request shown by the mascot", "always"],
        ["mascot.deny", "Deny the permission request shown by the mascot", "reject"],
      ] as const
    ).map(([id, title, decision]) => ({
      id,
      title,
      group: "Mascot",
      palette: true as const,
      enabled: () => view().approval !== undefined && (decision !== "always" || !!view().approval?.save?.length),
      run: () => {
        const request = view().approval
        if (request) reply(request, decision)
      },
    })),
  }))

  const openSession = (sessionID: string | undefined) => {
    if (!sessionID) return
    const root = data.session.root(sessionID)
    if (focus() !== root) route.navigate({ type: "session", sessionID: root })
  }

  // The tool behind a permission request, from its transcript part when loaded, for a fuller description.
  const presentation = createMemo(() => {
    const request = view().approval
    if (!request) return
    const source = request.source
    const message = source ? data.session.message.get(request.sessionID, source.messageID) : undefined
    const part =
      message?.type === "assistant"
        ? message.content.find((item) => item.type === "tool" && item.id === source?.id)
        : undefined
    const input = part?.type === "tool" && typeof part.state.input === "object" ? part.state.input : undefined
    return permissionPresentation(
      { action: request.action, resources: request.resources, metadata: request.metadata, input },
      paths.format,
    )
  })

  // The bubble sits beside the mascot's head, on whichever side has more room, and below it near the top edge.
  const room = createMemo(() => ({ left: left() + 2, right: dimensions().width - left() - WIDTH + 2 }))
  const bubbleOnLeft = createMemo(() => room().left >= Math.min(BUBBLE_MAX, room().right))
  const bubbleBelow = createMemo(() => top() + 4 < 8)
  const showBubble = createMemo(() => {
    if (view().approval || view().question) return true
    if (Math.max(room().left, room().right) < 24) return false
    if (currentNote()) return true
    if (hovered() && (state() === "idle" || state() === "sleeping")) return true
    return view().message !== undefined
  })
  const lines = createMemo(() => {
    const current = view()
    const spoken = currentNote()
    // Name the session when it is not the one on screen, so background work is recognisable.
    const root = current.sessionID ? data.session.root(current.sessionID) : undefined
    const title = root ? data.session.get(root)?.title : undefined
    const header = root && root !== focus() && (title || focus()) ? `↳ ${title ?? "Another session"}` : undefined
    if (current.approval) {
      const info = presentation()
      return {
        header,
        message:
          current.pending && current.pending > 1 ? `Permission needed (1 of ${current.pending})` : "Permission needed",
        detail: info ? `${info.icon} ${info.title}` : current.approval.action,
        progress: info?.lines[0],
      }
    }
    if (spoken && !current.question && (current.state === "idle" || current.state === "sleeping"))
      return { message: spoken.message }
    if (!current.message && hovered())
      return {
        message: current.state === "sleeping" ? "Zzz… oh, hi!" : "All quiet here.",
        detail: "Drag me around, click to say hi. /mascot hides me.",
      }
    return {
      header,
      message: current.message,
      detail: current.path ? paths.format(current.path) : current.detail,
      progress: current.progress,
    }
  })
  // Hug the content, within the room on that side.
  const bubbleWidth = createMemo(() => {
    const text = lines()
    const natural = Math.max(
      ...[text.header, text.message, text.detail, text.progress].map((line) =>
        line ? stringWidth(line.replace(/\s+/g, " ").trim()) : 0,
      ),
      ...[view().approval].map((request) =>
        request ? choices(request).reduce((sum, choice) => sum + choice.label.length + 3, -1) : 0,
      ),
      view().question ? 8 : 0,
    )
    return Math.max(16, Math.min(BUBBLE_MAX, natural + 4, bubbleOnLeft() ? room().left : room().right))
  })
  const rail = createMemo(() => {
    const tone = currentNote()?.state === "success" ? "success" : view().tone
    return tone ? theme.text.feedback[tone].base : theme.border.base
  })
  const clip = (value: string | undefined, width: number) => {
    if (!value) return
    const text = value.replace(/\s+/g, " ").trim()
    if (stringWidth(text) <= width) return text
    const chars = Array.from(text)
    while (chars.length > 0 && stringWidth(chars.join("")) > width - 1) chars.pop()
    return chars.join("") + "…"
  }
  const inner = () => bubbleWidth() - 4

  return (
    <>
      <Show when={showBubble()}>
        <box
          position="absolute"
          zIndex={1500}
          width={bubbleWidth()}
          left={Math.max(0, bubbleOnLeft() ? left() + 2 - bubbleWidth() : left() + WIDTH - 2)}
          top={bubbleBelow() ? top() + 4 : undefined}
          bottom={bubbleBelow() ? undefined : dimensions().height - top() - 4}
          flexDirection="column"
          border={["left", "right"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={rail()}
          backgroundColor={theme.background.raised.high}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => openSession(view().sessionID)}
        >
          <Show when={lines().header}>
            {(header) => (
              <text fg={theme.text.muted} wrapMode="none">
                {clip(header(), inner())}
              </text>
            )}
          </Show>
          <Show when={lines().message}>
            {(message) => (
              <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                {clip(message(), inner() * 2)}
              </text>
            )}
          </Show>
          <Show when={lines().detail}>
            {(detail) => (
              <text fg={theme.text.muted} wrapMode="none">
                {clip(detail(), inner())}
              </text>
            )}
          </Show>
          <Show when={lines().progress}>
            {(progress) => (
              <text fg={theme.text.faint} wrapMode="none">
                {clip(progress(), inner())}
              </text>
            )}
          </Show>
          <Show when={view().approval}>
            {(request) => (
              <box flexDirection="row" gap={1} marginTop={1}>
                <For each={choices(request())}>
                  {(choice) => (
                    <Choice
                      label={choice.label}
                      variant={choice.variant}
                      focused={choice.decision === "once"}
                      busy={busy() === request().id}
                      onPress={() => reply(request(), choice.decision)}
                    />
                  )}
                </For>
              </box>
            )}
          </Show>
          <Show when={view().question}>
            {(question) => (
              <box flexDirection="row" marginTop={1}>
                <Choice label="Answer" variant="primary" focused onPress={() => openSession(question().sessionID)} />
              </box>
            )}
          </Show>
        </box>
      </Show>
      <mascot_sprite
        ref={(value: MascotSpriteRenderable) => {
          sprite = value
        }}
        position="absolute"
        zIndex={1500}
        left={left()}
        top={top()}
        state={state()}
        animate={animate()}
        look={look()}
        walk={walk()}
        hovered={hovered()}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={onMouseDown}
        onMouseDrag={onMouseDrag}
        onMouseUp={onMouseUp}
      />
    </>
  )
}

function choices(request: PermissionRequest) {
  return [
    { label: "Approve", decision: "once", variant: "primary" },
    ...(request.save?.length ? [{ label: "Always", decision: "always", variant: "secondary" } as const] : []),
    { label: "Deny", decision: "reject", variant: "destructive" },
  ] as const
}

function Choice(props: {
  label: string
  variant: "primary" | "secondary" | "destructive"
  /** The suggested choice, shown filled. */
  focused?: boolean
  busy?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const states = () => ({ hovered: hovered(), focused: props.focused, disabled: props.busy })
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.background.action[props.variant].state(states())}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(mouse: MouseEvent) => {
        mouse.stopPropagation()
        if (!props.busy) props.onPress()
      }}
    >
      <text fg={theme.text.action[props.variant].state(states())} attributes={TextAttributes.BOLD}>
        {props.label}
      </text>
    </box>
  )
}
