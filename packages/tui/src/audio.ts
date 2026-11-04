import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound } from "@opentui/core"
import { readFile } from "node:fs/promises"

let audio: Audio | null | undefined
const sounds = new Map<string, Promise<AudioSound | null>>()

function getAudio() {
  if (audio !== undefined) return audio
  try {
    const next = Audio.create({ autoStart: false })
    next.on("error", (error: Error, context: AudioErrorContext) => {
      console.debug("tui audio error", { error, context })
    })
    audio = next
    return next
  } catch (error) {
    console.debug("failed to create tui audio", { error })
    audio = null
    return null
  }
}

export function loadSoundFile(file: string) {
  const current = getAudio()
  if (!current) return Promise.resolve(null)
  const cached = sounds.get(file)
  if (cached) return cached
  const task = readFile(file)
    .then((bytes) => current.loadSound(bytes))
    .catch((error) => {
      console.debug("failed to load tui sound", { file, error })
      return null
    })
  sounds.set(file, task)
  return task
}

export function play(sound: AudioSound, options?: AudioPlayOptions) {
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted() && !current.start()) return null
  return current.play(sound, options)
}

/**
 * Opens a mono microphone stream on the shared engine. `device` picks the first input whose name contains it, ignoring
 * case. The system default comes next, then every other input, because a default can be a disconnected headset or an
 * input another app holds exclusively. When none starts, the error names the inputs that were found.
 */
export async function openCapture(device?: string) {
  const current = getAudio()
  if (!current) throw new Error("Audio is unavailable in this terminal session.")
  // ALSA lists its null device, which generates zeros, when a Linux machine has no sound card.
  const devices = (current.listCaptureDevices() ?? []).filter((item) => !/generate zero samples/i.test(item.name))
  const needle = device?.trim().toLowerCase()
  const preferred = needle ? devices.find((item) => item.name.toLowerCase().includes(needle)) : undefined
  // `undefined` asks the backend for its default input.
  const candidates = [
    ...(preferred ? [preferred] : []),
    undefined,
    ...devices.filter((item) => item !== preferred && !item.isDefault),
  ]
  for (const candidate of candidates) {
    if (candidate) current.selectCaptureDevice(candidate.index)
    if (!candidate) current.clearCaptureDeviceSelection()
    const stream = await current.openCapture({ channels: 1 }).catch((error: unknown) => {
      console.debug("failed to open tui capture", { device: candidate?.name ?? "default", error })
      return undefined
    })
    if (!stream) continue
    // A capture error with no listener would throw from the emitter; the readable rejects with it too.
    stream.on("error", () => {})
    return stream
  }
  if (devices.length === 0) throw new Error("No microphone was found.")
  if (devices.length === 1) throw new Error(`${devices[0].name} wouldn't start recording.`)
  throw new Error(`None of the inputs would start recording: ${devices.map((item) => item.name).join(", ")}.`)
}

export function dispose() {
  audio?.dispose()
  audio = undefined
  sounds.clear()
}
