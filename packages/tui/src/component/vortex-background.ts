import type { KeyEvent, MouseEvent, OptimizedBuffer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useThemes } from "../context/theme"
import { AURORA_STOPS, createAurora } from "../ui/aurora"
import { createEmbers, EMBERS_STOPS } from "../ui/embers"
import { createMatrix, MATRIX_STOPS } from "../ui/matrix"
import { createRipple, RIPPLE_STOPS } from "../ui/ripple"
import {
  backgroundPalette,
  compositeVortex,
  createVortex,
  VORTEX_FPS,
  VORTEX_MODES,
  vortexPalette,
  type VortexMode,
} from "../ui/vortex"
import { createWarp, WARP_STOPS } from "../ui/warp"

const SHOCK_INTERVAL = 90 // ms between keystroke shockwaves while typing quickly

/** The configured background, defaulting to the vortex unless interface animations are turned off. */
export function vortexMode(config: { background?: VortexMode; animations?: boolean }): VortexMode {
  return config.background ?? (config.animations === false ? "off" : "vortex")
}

// A mood shown without being saved, while the `/mood` picker previews the highlighted entry.
const [previewMood, setPreviewMood] = createSignal<VortexMode>()

/** Shows `mood` in place of the configured one until cleared with `undefined`; nothing is persisted. */
export function setMoodPreview(mood: VortexMode | undefined) {
  setPreviewMood(mood)
}

export function nextVortexMode(mode: VortexMode): VortexMode {
  return VORTEX_MODES[(VORTEX_MODES.indexOf(mode) + 1) % VORTEX_MODES.length]!
}

// A mood that draws its own glyphs (and, for some, colour tones) instead of the vortex density ramp.
type GlyphMood = {
  field(width: number, height: number): Float32Array
  readonly glyphs: Uint32Array
  readonly tones?: Uint8Array
  step(delta: number, streaming: boolean): boolean
  poke(): void
  move(x: number, y: number): void
  shock(x: number, y: number): void
}

/**
 * Animated background ("mood") painted behind the whole TUI: the ASCII vortex, its watermark variant, the matrix
 * rain, the ripple pond, the warp starfield, the embers fire or the aurora. Each mood owns its own simulation;
 * whichever is active receives the pointer, keys and ticks.
 *
 * It runs as a renderer post-process pass, after every renderable has drawn into the frame, and only fills cells that
 * are still empty base background (see `compositeVortex`), so no pane, border, diff or styled text is ever overwritten
 * and layout is untouched. A 24 FPS ticker drives the animation while there is input, a streaming session, a live
 * wake or shockwave; after 30 s without any of those the motion eases to a standstill and the ticker stops, leaving
 * the last frame composited for free on ordinary redraws until the next poke.
 *
 * With interface animations off the background defaults to off; explicitly choosing one then shows a still frame.
 *
 * Returns the mouse handler for the app's root box so pointer movement anywhere bends the flow.
 */
export function useVortexBackground() {
  const renderer = useRenderer()
  const config = useConfig()
  const themes = useThemes()
  const data = useData()
  const route = useRoute()
  const vortex = createVortex()
  const moods: Record<Exclude<VortexMode, "vortex" | "watermark" | "off">, GlyphMood> = {
    matrix: createMatrix(),
    ripple: createRipple(),
    warp: createWarp(),
    embers: createEmbers(),
    aurora: createAurora(),
  }
  const stops = {
    matrix: [MATRIX_STOPS],
    ripple: [RIPPLE_STOPS],
    warp: WARP_STOPS,
    embers: [EMBERS_STOPS],
    aurora: AURORA_STOPS,
  }
  const mode = createMemo(() => previewMood() ?? vortexMode(config.data))
  const engine = () => {
    const current = mode()
    return current === "vortex" || current === "watermark" || current === "off" ? vortex : moods[current]
  }
  const animated = createMemo(() => mode() !== "off" && (config.data.animations ?? true))
  const streaming = createMemo(
    () => route.data.type === "session" && data.session.status(route.data.sessionID) === "running",
  )
  const base = createMemo(() => themes.currentTokens().background.base)
  const palette = createMemo(() => {
    const [r, g, b, a] = base().toInts()
    // A transparent base (the system theme) shows the terminal's own background, so assume its mode's extreme.
    const background: [number, number, number] =
      a === 0 ? (themes.mode() === "light" ? [255, 255, 255] : [0, 0, 0]) : [r, g, b]
    const current = mode()
    if (current === "vortex" || current === "watermark" || current === "off") return vortexPalette(background)
    return backgroundPalette(background, ...stops[current])
  })

  const paint = (buffer: OptimizedBuffer) => {
    const current = mode()
    if (current === "off") return
    buffer.withBuffers((cells) => {
      if (current === "vortex" || current === "watermark")
        return compositeVortex(cells, vortex.field(cells.width, cells.height, current), palette(), base().buffer)
      const mood = moods[current]
      const field = mood.field(cells.width, cells.height)
      compositeVortex(cells, field, palette(), base().buffer, mood.glyphs, mood.tones)
    })
  }

  let stopTicker: (() => void) | undefined
  const tick = (delta: number) => {
    if (engine().step(delta, streaming())) return
    stopTicker?.()
    stopTicker = undefined
  }
  const wake = () => {
    engine().poke()
    if (stopTicker || !animated()) return
    stopTicker = renderer.onAnimationTick(VORTEX_FPS, tick)
  }

  createEffect(() => {
    if (mode() === "off") return
    renderer.addPostProcessFn(paint)
    renderer.requestRender()
    onCleanup(() => {
      renderer.removePostProcessFn(paint)
      renderer.requestRender()
    })
  })

  // Switching moods restarts the ticker, so a newly chosen mood starts moving even if the last one was at rest.
  createEffect(() => {
    mode()
    if (!animated()) return
    wake()
    onCleanup(() => {
      stopTicker?.()
      stopTicker = undefined
    })
  })

  createEffect(() => {
    if (streaming()) wake()
  })

  // Theme changes repaint the frame with the new palette even while the animation is at rest.
  createEffect(() => {
    palette()
    renderer.requestRender()
  })

  let lastShock = 0
  const onKey = (event: KeyEvent) => {
    if (mode() === "off" || event.eventType === "release") return
    wake()
    const now = performance.now()
    if (now - lastShock < SHOCK_INTERVAL) return
    lastShock = now
    // Keystrokes ripple out from the caret, which sits in the prompt while typing; fall back to the input bar's usual
    // place at the bottom centre when the cursor is hidden.
    const cursor = renderer.getCursorState()
    if (cursor.visible) engine().shock(cursor.x, cursor.y)
    else engine().shock(renderer.width / 2, renderer.height - 3)
  }
  renderer.keyInput.on("keypress", onKey)
  onCleanup(() => {
    renderer.keyInput.off("keypress", onKey)
  })

  return {
    onMouse(event: MouseEvent) {
      if (mode() === "off") return
      if (event.type === "move" || event.type === "drag" || event.type === "over") engine().move(event.x, event.y)
      wake()
    },
  }
}
