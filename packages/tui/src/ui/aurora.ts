/**
 * Northern lights, the "aurora" mood.
 *
 * A few curtains of light hang across the sky. Each has a bright lower hem that waves slowly across the screen, with
 * rays rising from it that fade toward the top, and fine vertical striations that drift along the curtain and gather
 * where it folds. Like a real aurora, the colour changes with height: green at the hem, teal above it and violet at
 * the top. A sparse field of faint stars twinkles in the dark sky between the curtains.
 *
 * The pointer pushes the curtains aside like wind on fabric, keystrokes send a bright surge along the curtains from
 * the caret, and a streaming reply makes the lights glow brighter and dance faster.
 *
 * This module holds only state and math, like `ui/vortex.ts`; `component/vortex-background.ts` wires it up.
 */

import { ASPECT, createPace, glyphRamp } from "./mood"
import { simplex, smoothstep } from "./vortex"

export const AURORA_GLYPHS = " .·:;!|I"

const glyph = glyphRamp(AURORA_GLYPHS)
// Hem height (share of the screen from the top), wave amplitude, ray reach (share of the screen), brightness, drift.
const CURTAINS = [
  { hem: 0.46, wave: 0.1, reach: 0.38, bright: 1, drift: 1.1, seed: 11 },
  { hem: 0.3, wave: 0.08, reach: 0.26, bright: 0.72, drift: -0.8, seed: 29 },
  { hem: 0.6, wave: 0.07, reach: 0.3, bright: 0.55, drift: 0.6, seed: 47 },
] as const
const SURGE_SPEED = 32 // cells per second a keystroke surge runs along the curtains
const SURGE_LIFE = 1.8
const SURGE_LIMIT = 6
const PUSH_RADIUS = 11 // cells (horizontal) the pointer pushes the curtains aside
const PUSH = 7 // cells a full-strength push moves a curtain
const WAKE_DECAY = 1_200
const STARS = 0.012 // share of sky cells holding a faint star
// Colour tones: green hem, teal middle, violet top, and the pale sky the stars use.
const GREEN = 0
const TEAL = 1
const VIOLET = 2
const SKY = 3

type Surge = { x: number; age: number }

export type Aurora = ReturnType<typeof createAurora>

export function createAurora(seed = 0x0c0de) {
  const noise = simplex(seed ^ 0xa0a0)
  const pace = createPace()
  const pointer = { x: 0, y: 0, energy: 0, seen: false }
  const surges: Surge[] = []
  let field = new Float32Array(0)
  let glyphs = new Uint32Array(0)
  let tones = new Uint8Array(0)
  let width = 0
  let height = 0
  let time = 0
  let version = 0
  let fieldKey = ""

  return {
    get activity() {
      return pace.activity
    },
    get boost() {
      return pace.boost
    },
    get energy() {
      return pointer.energy
    },
    get surges() {
      return surges.length
    },
    /** Glyph code for every cell, row-major, valid after `field`. */
    get glyphs() {
      return glyphs
    },
    /** Colour tone for every cell (green, teal, violet, sky), valid after `field`. */
    get tones() {
      return tones
    },
    poke() {
      pace.poke()
    },
    /** Pointer position in cells. Moving it pushes the curtains aside around the pointer. */
    move(x: number, y: number) {
      pace.poke()
      if (pointer.seen)
        pointer.energy = Math.min(1, pointer.energy + Math.hypot(x - pointer.x, (y - pointer.y) * ASPECT) * 0.05)
      pointer.x = x + 0.5
      pointer.y = y + 0.5
      pointer.seen = true
    },
    /** Keystrokes send a bright surge along the curtains, outward from the caret's column. */
    shock(x: number, _y: number) {
      pace.poke()
      if (surges.length >= SURGE_LIMIT) surges.shift()
      surges.push({ x: x + 0.5, age: 0 })
    },
    /** Advances the lights by `delta` milliseconds. Returns false once they have come to rest. */
    step(delta: number, streaming: boolean) {
      const seconds = pace.advance(delta, streaming)
      pointer.energy *= Math.exp(-Math.min(delta, 250) / WAKE_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0
      if (seconds > 0) {
        time += seconds * (1 + 1.4 * pace.boost)
        for (const item of surges) item.age += seconds
        while (surges.length && surges[0]!.age >= SURGE_LIFE) surges.shift()
      }
      version++
      return pace.activity > 0 || pace.boost > 0 || pointer.energy > 0 || surges.length > 0
    },
    /** Light intensity in [0, 1] for every cell, row-major. Cached until the next step or a size change. */
    field(nextWidth: number, nextHeight: number) {
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth
        height = nextHeight
        field = new Float32Array(width * height)
        glyphs = new Uint32Array(width * height)
        tones = new Uint8Array(width * height)
      }
      const key = `${width}x${height}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      field.fill(0)
      const glow = 1 + 0.35 * pace.boost
      for (let x = 0; x < width; x++) {
        const cx = x + 0.5
        // A surge brightens every curtain as its two fronts run out from the caret.
        let surge = 0
        for (const item of surges) {
          const fade = 1 - item.age / SURGE_LIFE
          const reach = item.age * SURGE_SPEED
          surge +=
            fade *
            fade *
            (Math.exp(-(((cx - item.x - reach) / 3) ** 2)) + Math.exp(-(((cx - item.x + reach) / 3) ** 2)))
        }
        for (const curtain of CURTAINS) {
          const s = curtain.seed
          // The curtain folds: a slow horizontal warp bunches the rays together in places.
          const fold = 9 * noise(cx * 0.018 + time * 0.03, s)
          const hem =
            height * (curtain.hem + curtain.wave * noise(cx * 0.014 + time * 0.045, s + 1)) +
            1.6 * noise(cx * 0.07 - time * 0.11, s + 2)
          const reach = height * curtain.reach
          // Each curtain lights up in long segments that slowly come and go across the sky.
          const gather = smoothstep(-0.35, 0.45, noise(cx * 0.011 + time * 0.018, s + 3))
          if (gather === 0) continue
          const top = Math.max(0, Math.floor(hem - reach * 3))
          const bottom = Math.min(height, Math.ceil(hem + 3))
          for (let y = top; y < bottom; y++) {
            const cy = y + 0.5
            const push = pointer.energy === 0 ? 0 : wind(cx, cy)
            const lifted = hem - Math.abs(push) * 0.35
            const above = lifted - cy
            // Bright just above the hem, fading up the rays and dropping off sharply below.
            const profile =
              above >= 0
                ? Math.exp(-above / reach) * (0.55 + 0.45 * Math.exp(-above / 1.6))
                : Math.exp(-((above / 0.9) ** 2))
            if (profile < 0.02) continue
            const sx = cx + fold + push + time * curtain.drift
            const rays = 0.5 + 0.5 * noise(sx * 0.45, cy * 0.035 + time * 0.25 + s)
            const fine = 0.5 + 0.5 * noise(sx * 1.3, cy * 0.02 - time * 0.4 + s * 2)
            const striation = 0.12 + 0.88 * smoothstep(0.3, 0.85, rays * 0.8 + fine * 0.2)
            // A bright, continuous hem with rays rising from it.
            const band = Math.exp(-(((above - 0.4) / 1.3) ** 2)) * (0.65 + 0.35 * rays)
            const level =
              (gather * curtain.bright * (1.05 * band + 1.5 * profile * striation) + profile * surge * 0.6) * glow
            const i = y * width + x
            // Overlapping curtains add up like light, saturating instead of clipping.
            const before = field[i]!
            const total = 1 - (1 - before) * (1 - Math.min(1, level))
            field[i] = total
            if (level < before) continue
            const rise = above / reach + 0.12 * noise(cx * 0.2, cy * 0.3 + s)
            tones[i] = rise < 0.28 ? GREEN : rise < 0.75 ? TEAL : VIOLET
          }
        }
      }
      for (let i = 0; i < field.length; i++) {
        const level = field[i]!
        if (level >= 0.06) {
          // Lift the middle tones a little so the rays read clearly against the sky.
          const shaped = Math.min(1, level * (1.25 - 0.25 * level))
          field[i] = shaped
          glyphs[i] = glyph(shaped)
          continue
        }
        // A faint, twinkling star in the dark sky. The hash keeps each star in place from frame to frame.
        const star = hash(i, width)
        if (star >= STARS) {
          field[i] = 0
          continue
        }
        const twinkle = 0.5 + 0.5 * Math.sin(time * (1.2 + star * 90) + star * 4000)
        field[i] = 0.06 + 0.07 * smoothstep(0.2, 1, twinkle)
        glyphs[i] = star < STARS * 0.25 ? STAR : SPECK
        tones[i] = SKY
      }
      return field
    },
  }

  // The pointer's wind: a horizontal push away from it, strongest beside the pointer and fading with distance.
  function wind(x: number, y: number) {
    const du = (x - pointer.x) / PUSH_RADIUS
    const dv = ((y - pointer.y) * ASPECT) / (PUSH_RADIUS * 2)
    return Math.sign(du) * PUSH * pointer.energy * Math.exp(-(du * du + dv * dv))
  }
}

const SPECK = ".".codePointAt(0)!
const STAR = "·".codePointAt(0)!

/** A stable pseudo-random value in [0, 1) for a cell. */
function hash(index: number, width: number) {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(width, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Aurora colours: green, teal and violet curtains, plus a pale sky for the stars, each blended toward the theme. */
export const AURORA_STOPS = [
  {
    dark: [
      [8, 40, 28],
      [22, 124, 78],
      [70, 230, 150],
      [214, 255, 232],
    ],
    light: [
      [202, 232, 214],
      [114, 188, 146],
      [24, 126, 76],
      [6, 66, 36],
    ],
  },
  {
    dark: [
      [8, 32, 44],
      [22, 108, 130],
      [66, 206, 218],
      [214, 250, 255],
    ],
    light: [
      [202, 226, 234],
      [114, 176, 190],
      [24, 116, 138],
      [6, 56, 72],
    ],
  },
  {
    dark: [
      [28, 12, 48],
      [92, 44, 156],
      [180, 110, 246],
      [244, 224, 255],
    ],
    light: [
      [226, 214, 242],
      [168, 136, 212],
      [96, 54, 170],
      [46, 16, 98],
    ],
  },
  {
    dark: [
      [24, 28, 44],
      [70, 78, 110],
      [150, 160, 196],
      [232, 236, 255],
    ],
    light: [
      [214, 216, 228],
      [156, 160, 180],
      [88, 92, 118],
      [32, 34, 52],
    ],
  },
] as const
