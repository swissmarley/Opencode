import type { AudioCaptureStream, KeyEvent, MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createSignal, Match, onCleanup, Switch } from "solid-js"
import { openCapture } from "../audio"
import { Spinner } from "../component/spinner"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { encodeWav, level, meter } from "./wav"

/** A pointer press held at least this long is push-to-talk: releasing it stops. A quicker click toggles recording on. */
export const HOLD_MS = 400
/** Terminals repeat a held key only after a delay, 660 ms on X11 by default. A press with no repeat by then was a tap. */
export const TAP_MS = 800
/** Repeats arrive every 30-50 ms while a key is held, so a longer silence means it was released. */
export const RELEASE_GAP_MS = 250
/** OpenAI accepts uploads up to 25 MB; five minutes of 16 kHz WAV is under 10 MB. */
export const MAX_SECONDS = 300
const MIN_SECONDS = 0.3
/** -60 dBFS, where the level meter starts. A whole recording below it heard nothing, not even room noise. */
const SILENCE_PEAK = 0.001
const METER_BARS = 5

export type VoiceState = "idle" | "starting" | "recording" | "transcribing"

type Recording = {
  readonly stream: AudioCaptureStream
  readonly chunks: Float32Array[]
  /** Settles with the capture error, if any, once the stream has delivered its last frames. */
  done: Promise<unknown>
  frames: number
  peak: number
}

/**
 * Records the microphone and transcribes it through the server into the prompt. The pointer and the `prompt.voice`
 * shortcut both support push-to-talk (hold, then release to transcribe) and toggling (tap to start, tap to stop).
 */
export function useVoiceInput(props: { insert: (text: string) => void; enabled: () => boolean }) {
  const client = useClient()
  const config = useConfig().data
  const renderer = useRenderer()
  const toast = useToast()
  const [state, setState] = createSignal<VoiceState>("idle")
  const [levels, setLevels] = createSignal<number[]>([])
  const [elapsed, setElapsed] = createSignal(0)
  let recording: Recording | undefined
  let clock: ReturnType<typeof setInterval> | undefined
  let attempt = 0
  let stopWhenStarted = false
  let pointerAt: number | undefined
  let held: { name: string; at: number; last?: number } | undefined
  let heldTimer: ReturnType<typeof setInterval> | undefined
  let disposed = false

  const active = () => state() === "starting" || state() === "recording"

  async function start() {
    if (state() !== "idle") return
    const current = ++attempt
    stopWhenStarted = false
    setState("starting")
    setLevels([])
    setElapsed(0)
    const stream = await openCapture(config.voice?.device).catch((error: unknown) => {
      if (current === attempt) fail("Couldn't open the microphone", `${errorMessage(error)} ${microphoneHint()}`)
      return undefined
    })
    if (!stream) return
    if (current !== attempt || disposed) return stream.dispose()
    const startedAt = performance.now()
    const next: Recording = { stream, chunks: [], frames: 0, peak: 0, done: Promise.resolve() }
    next.done = drain(next).then(
      () => undefined,
      (error: unknown) => {
        // A microphone lost mid-recording ends it here; once stopping, stop() reports the error itself.
        if (recording === next) {
          stream.dispose()
          fail("Recording failed", error)
        }
        return error
      },
    )
    recording = next
    clock = setInterval(() => setElapsed(Math.floor((performance.now() - startedAt) / 1000)), 250)
    setState("recording")
    if (stopWhenStarted) void stop()
  }

  async function drain(next: Recording) {
    let shown = 0
    for await (const chunk of next.stream.readable) {
      next.chunks.push(chunk)
      next.frames += chunk.length
      next.peak = chunk.reduce((peak, value) => Math.max(peak, Math.abs(value)), next.peak)
      // The meter needs a few updates a second, not one per capture chunk.
      const now = performance.now()
      if (now - shown >= 80) {
        shown = now
        setLevels((value) => [...value, level(chunk)].slice(-METER_BARS))
      }
      if (next.frames >= next.stream.sampleRate * MAX_SECONDS && recording === next) void stop()
    }
  }

  async function stop() {
    if (state() === "starting") {
      stopWhenStarted = true
      return
    }
    const current = recording
    if (!current || state() !== "recording") return
    const stopping = attempt
    release()
    current.stream.stop()
    const failed = await current.done
    current.stream.dispose()
    // Escape may cancel while the last captured frames drain.
    if (stopping !== attempt) return
    if (failed) return fail("Recording failed", failed)
    if (current.frames < current.stream.sampleRate * MIN_SECONDS) return finish()
    // macOS records digital silence when the terminal has no microphone permission.
    if (current.peak < SILENCE_PEAK) {
      finish()
      toast.show({
        variant: "warning",
        title: "Only silence was recorded",
        message: `Check that the microphone is unmuted. ${microphoneHint()}`,
        duration: 6000,
      })
      return
    }
    setState("transcribing")
    const result = await client.api.experimental.voice
      .transcribe({
        audio: Buffer.from(encodeWav(current.chunks, current.stream.sampleRate)).toString("base64"),
        mime: "audio/wav",
      })
      .catch((error: unknown) => {
        if (!disposed) toast.show({ variant: "error", title: "Transcription failed", message: errorMessage(error) })
        return undefined
      })
    finish()
    if (!result || disposed) return
    if (!result.text) {
      toast.show({ variant: "info", message: "No speech was recognized", duration: 3000 })
      return
    }
    props.insert(result.text)
  }

  function cancel() {
    attempt++
    const current = recording
    release()
    current?.stream.dispose()
    finish()
  }

  function release() {
    recording = undefined
    pointerAt = undefined
    endHold()
  }

  function finish() {
    if (clock) clearInterval(clock)
    clock = undefined
    recording = undefined
    setState("idle")
    setLevels([])
  }

  function fail(title: string, error: unknown) {
    release()
    finish()
    if (!disposed) toast.show({ variant: "error", title, message: errorMessage(error) })
  }

  // Pointer: holding the button records until release; a click starts recording and the next click stops it.
  function pointerDown() {
    if (!props.enabled()) return
    if (active()) {
      if (pointerAt === undefined) void stop()
      return
    }
    if (state() !== "idle") return
    pointerAt = performance.now()
    void start()
  }

  function pointerUp() {
    if (pointerAt === undefined) return
    const pressed = performance.now() - pointerAt
    pointerAt = undefined
    if (pressed >= HOLD_MS) void stop()
  }

  // Keyboard: terminals report presses only, but a held key repeats, so repeats mean push-to-talk and recording stops
  // once they do. A press that never repeats was a tap, which leaves recording on until the next press.
  function keyPress(event?: KeyEvent) {
    if (held && event?.name === held.name) {
      held.last = performance.now()
      return
    }
    if (active()) return void stop()
    if (state() !== "idle") return
    if (event) beginHold(event.name)
    void start()
  }

  // Repeats of a key bound after the leader no longer match a binding, so they would type into the prompt.
  const swallowRepeat = (event: KeyEvent) => {
    if (!held || event.name !== held.name || event.eventType === "release") return
    event.preventDefault()
    event.stopPropagation()
    held.last = performance.now()
  }

  function beginHold(name: string) {
    const at = performance.now()
    held = { name, at }
    renderer.keyInput.on("keypress", swallowRepeat)
    heldTimer = setInterval(() => {
      if (!held) return endHold()
      const now = performance.now()
      if (held.last === undefined && now - held.at > TAP_MS) return endHold()
      if (held.last !== undefined && now - held.last > RELEASE_GAP_MS) {
        endHold()
        void stop()
      }
    }, 50)
  }

  function endHold() {
    if (heldTimer) clearInterval(heldTimer)
    heldTimer = undefined
    if (held) renderer.keyInput.off("keypress", swallowRepeat)
    held = undefined
  }

  Keymap.createLayer(() => ({
    mode: "global",
    priority: 2,
    enabled: active(),
    commands: [{ bind: "escape", title: "Cancel voice input", group: "Prompt", run: () => cancel() }],
  }))

  onCleanup(() => {
    disposed = true
    cancel()
  })

  return { state, levels, elapsed, keyPress, pointerDown, pointerUp, cancel }
}

export type VoiceInput = ReturnType<typeof useVoiceInput>

/** Where to look when no input starts, for the machine the TUI runs on, which is the one that records. */
function microphoneHint() {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY)
    return "Over SSH, OpenCode records from the remote machine, not the one you're typing on."
  if (process.platform === "darwin")
    return "Allow your terminal app under System Settings > Privacy & Security > Microphone, then restart it."
  if (process.platform === "win32")
    return "Turn on microphone access for desktop apps under Settings > Privacy & security > Microphone."
  if (process.env.WSL_DISTRO_NAME)
    return "Under WSL, recording goes through WSLg's audio server (Windows 11), which needs the PulseAudio client library (libpulse0) installed."
  return "Check that PulseAudio or PipeWire is running and its client library (libpulse) is installed, or pick an input with voice.device in cli.json."
}

/** Cells the button takes in a state, so the metadata beside it can leave room: `mic`, or the timer and meter. */
export function voiceButtonWidth(state: VoiceState) {
  return state === "idle" ? 3 : 14
}

/** The microphone control beside the prompt input: `mic` at rest, a timer and level meter while recording. */
export function VoiceButton(props: { voice: VoiceInput; muted: boolean }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const recording = () => props.voice.state() === "recording" || props.voice.state() === "starting"
  const color = () =>
    props.muted
      ? theme.text.muted
      : recording()
        ? theme.text.action.primary.state({ pressed: true })
        : hovered()
          ? theme.text.action.primary.state({ hovered: true })
          : theme.text.muted
  const clock = () => {
    const seconds = props.voice.elapsed()
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  return (
    <box
      id="prompt.voice"
      flexDirection="row"
      flexShrink={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event: MouseEvent) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        props.voice.pointerDown()
      }}
      onMouseUp={(event: MouseEvent) => {
        if (event.button !== 0) return
        event.stopPropagation()
        props.voice.pointerUp()
      }}
    >
      <Switch>
        <Match when={props.voice.state() === "transcribing"}>
          <Spinner>transcribing</Spinner>
        </Match>
        <Match when={recording()}>
          <text fg={color()} wrapMode="none">
            ● {clock()} {meter(props.voice.levels()).padEnd(METER_BARS, " ")}
          </text>
        </Match>
        <Match when={true}>
          <text fg={color()} wrapMode="none">
            mic
          </text>
        </Match>
      </Switch>
    </box>
  )
}
