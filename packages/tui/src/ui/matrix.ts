/**
 * Interactive digital-rain background field, the "matrix" mood.
 *
 * Columns of glyphs fall at their own speeds, each a bright head trailing a fading tail, while the glyphs underneath
 * flicker in place. The rain answers the same inputs as the vortex: pointer movement parts the rain around the cursor
 * and seeds new drops in the columns it crosses, keystrokes drop fast bright streams near the caret, and a streaming
 * reply thickens and speeds up the rain. After `VORTEX_IDLE_AFTER` with no input the rain slows to a standstill.
 *
 * This module holds only state and math, like `ui/vortex.ts`; `component/vortex-background.ts` wires it to the
 * renderer and composites it with the same rules, so it only ever fills empty background.
 */

import { VORTEX_IDLE_AFTER } from "./vortex"

// Half-width katakana and digits, all one cell wide.
export const MATRIX_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789"

const GLYPH_CODES = Uint32Array.from(MATRIX_GLYPHS, (char) => char.codePointAt(0)!)
// Terminal cells are roughly twice as tall as they are wide.
const ASPECT = 2
const DENSITY = 0.45 // drops per column at rest
const STREAM_DENSITY = 0.25 // extra drops per column while a reply streams
const MAX_DENSITY = 1.1
const SPEED = [7, 20] as const // rows per second
const LENGTH = [5, 18] as const // trail cells
const FLICKER = 0.03 // share of cells that change glyph per second
const PART_RADIUS = 7 // cells (horizontal) the rain parts around the pointer
const WAKE_DECAY = 1_400 // ms e-folding time for pointer wake energy
const SHOCK_DROPS = 2
const BOOST_RISE = 1_200
const BOOST_FALL = 2_500
const IDLE_FADE = 4_000
const WAKE_FADE = 350

type Drop = { x: number; y: number; speed: number; length: number; bright: number }

export type Matrix = ReturnType<typeof createMatrix>

export function createMatrix(seed = 0x0c0de) {
  const random = mulberry32(seed)
  const pointer = { x: 0, y: 0, column: -1, energy: 0, seen: false }
  let drops: Drop[] = []
  let glyphs = new Uint32Array(0)
  let field = new Float32Array(0)
  let width = 0
  let height = 0
  let boost = 0
  let activity = 1
  let idle = 0
  let version = 0
  let fieldKey = ""
  let flicker = 0

  const pick = () => GLYPH_CODES[Math.floor(random() * GLYPH_CODES.length)]!
  const between = (range: readonly [number, number]) => range[0] + random() * (range[1] - range[0])
  const drop = (x: number, y: number, fast = false): Drop => ({
    x,
    y,
    speed: between(SPEED) * (fast ? 1.6 : 1),
    length: Math.round(between(LENGTH)),
    bright: fast ? 1 : 0.65 + random() * 0.35,
  })
  const spawn = (x: number, y: number, fast = false) => {
    if (x < 0 || x >= width || drops.length >= Math.ceil(width * MAX_DENSITY)) return
    drops.push(drop(x, y, fast))
  }

  // Lays out a fresh screen of rain, so the very first (and, with animations off, only) frame is already full.
  function resize(nextWidth: number, nextHeight: number) {
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    glyphs = Uint32Array.from({ length: width * height }, pick)
    field = new Float32Array(width * height)
    drops = drops.filter((item) => item.x < width)
    while (drops.length < Math.round(width * DENSITY)) {
      drops.push(drop(Math.floor(random() * width), random() * height * 1.5 - height * 0.5))
    }
  }

  return {
    get boost() {
      return boost
    },
    get activity() {
      return activity
    },
    get energy() {
      return pointer.energy
    },
    get drops() {
      return drops.length
    },
    /** Glyph code for every cell, row-major, valid after `field`. */
    get glyphs() {
      return glyphs
    },
    poke() {
      idle = 0
    },
    /** Pointer position in cells. Moving parts the rain around the pointer and seeds drops in new columns. */
    move(x: number, y: number) {
      idle = 0
      const column = Math.floor(x)
      if (pointer.seen) {
        const distance = Math.hypot(x - pointer.x, (y - pointer.y) * ASPECT)
        pointer.energy = Math.min(1, pointer.energy + distance * 0.08)
        if (column !== pointer.column && random() < 0.5) spawn(column, y - 1)
      }
      pointer.x = x
      pointer.y = y
      pointer.column = column
      pointer.seen = true
    },
    /** Keystrokes drop fast, bright streams near the caret column. */
    shock(x: number, _y: number) {
      idle = 0
      for (let i = 0; i < SHOCK_DROPS; i++) spawn(Math.floor(x + (random() - 0.5) * 8), -random() * 4, true)
    },
    /** Advances the rain by `delta` milliseconds. Returns false once it has come to rest. */
    step(delta: number, streaming: boolean) {
      const dt = Math.min(delta, 250)
      idle = streaming ? 0 : idle + dt
      boost = streaming ? Math.min(1, boost + dt / BOOST_RISE) : Math.max(0, boost - dt / BOOST_FALL)
      activity =
        idle > VORTEX_IDLE_AFTER ? Math.max(0, activity - dt / IDLE_FADE) : Math.min(1, activity + dt / WAKE_FADE)
      const eased = activity * activity * (3 - 2 * activity)
      const seconds = (dt / 1000) * eased
      pointer.energy *= Math.exp(-dt / WAKE_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0

      if (width > 0 && seconds > 0) {
        const speed = 1 + 1.2 * boost
        for (const item of drops) {
          const head = Math.floor(item.y)
          item.y += item.speed * seconds * speed
          // Each new head cell shows a fresh glyph, so falling streams visibly change as they go.
          const next = Math.floor(item.y)
          if (next !== head && next >= 0 && next < height) glyphs[next * width + item.x] = pick()
        }
        drops = drops.filter((item) => item.y - item.length < height)
        const target = Math.round(width * (DENSITY + STREAM_DENSITY * boost))
        while (drops.length < target) spawn(Math.floor(random() * width), -random() * height * 0.5)
        flicker += glyphs.length * FLICKER * seconds
        for (; flicker >= 1; flicker--) glyphs[Math.floor(random() * glyphs.length)] = pick()
      }
      version++
      return activity > 0 || boost > 0 || pointer.energy > 0
    },
    /** Rain intensity in [0, 1] for every cell, row-major. Cached until the next step or a size change. */
    field(nextWidth: number, nextHeight: number) {
      resize(nextWidth, nextHeight)
      const key = `${width}x${height}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      field.fill(0)
      for (const item of drops) {
        const head = Math.floor(item.y)
        for (let k = 0; k < item.length; k++) {
          const y = head - k
          if (y < 0) break
          if (y >= height) continue
          const tail = 1 - k / item.length
          const level = (k === 0 ? 1 : 0.08 + 0.72 * tail ** 1.6) * item.bright
          const i = y * width + item.x
          if (level > field[i]!) field[i] = level
        }
      }
      if (pointer.energy > 0) {
        // The rain parts around the pointer, as if it held an umbrella.
        const strength = Math.min(1, pointer.energy * 1.5)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const du = (x + 0.5 - pointer.x) / PART_RADIUS
            const dv = ((y + 0.5 - pointer.y) * ASPECT) / PART_RADIUS
            field[y * width + x]! *= 1 - strength * Math.exp(-(du * du + dv * dv))
          }
        }
      }
      return field
    },
  }
}

/**
 * Colour lookup from rain level to an RGB triple, blended toward the theme background like the vortex palette:
 * dark backgrounds run deep green → phosphor green → mint heads; light backgrounds keep the hues, reversed in
 * luminance, so heads still read as the brightest part of each stream.
 */
export const MATRIX_STOPS = {
  dark: [
    [6, 40, 18],
    [16, 110, 52],
    [46, 210, 110],
    [200, 255, 220],
  ],
  light: [
    [196, 226, 204],
    [120, 184, 140],
    [36, 130, 70],
    [8, 64, 30],
  ],
} as const

export function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
