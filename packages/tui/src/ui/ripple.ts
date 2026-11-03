/**
 * Rain on a pond, the "ripple" mood.
 *
 * Every raindrop sends out a ring wave: a short train of crests that expands from where it landed, a leading crest
 * followed by smaller ones, losing height as it spreads and fades. Rings are summed, so where they cross they
 * interfere into moiré patterns, and once a ring reaches an edge of the screen its reflection (a mirror image of the
 * drop beyond that edge) rolls back across the water. Pointer movement drops a trail of small ripples that merge into
 * a wake, keystrokes drop a stone at the caret, and a streaming reply turns the rain into a downpour.
 *
 * The surface is lit from the upper left: the side of each crest facing the light glints, the far side falls into
 * shadow, and faint caustics shimmer across still water.
 *
 * This module holds only state and math, like `ui/vortex.ts`; `component/vortex-background.ts` wires it up.
 */

import { mulberry32 } from "./matrix"
import { ASPECT, createPace, glyphRamp } from "./mood"
import { simplex, smoothstep } from "./vortex"

export const RIPPLE_GLYPHS = " .·-~=+*#"

const glyph = glyphRamp(RIPPLE_GLYPHS)
const RAIN = 0.0007 // drops per cell per second at rest
const DOWNPOUR = 0.003 // extra drops per cell per second at full streaming boost
const MAX_RINGS = 48
const REFLECT = 0.55 // share of a ring's height that comes back off an edge
const LIGHT_X = -0.55 // direction toward the light: up and to the left, in screen space
const LIGHT_Y = -0.83
const WAKE_DECAY = 900 // ms e-folding time for pointer wake energy
const WAKE_SPACING = 2.5 // cells the pointer travels between wake ripples

// Raindrops, stones and wake ripples differ only in size: wavelength and speed in cells, life in seconds.
const DROP = { height: 1.5, wavelength: 3.2, speed: 9, life: 3.2, train: 5 }
const STONE = { height: 2.1, wavelength: 4.6, speed: 13, life: 5, train: 9 }
const WAKE = { height: 0.8, wavelength: 2.6, speed: 8, life: 1.8, train: 4 }

type Kind = typeof DROP
type Ring = { x: number; y: number; age: number; kind: Kind; height: number }

export type Ripple = ReturnType<typeof createRipple>

export function createRipple(seed = 0x0c0de) {
  const random = mulberry32(seed)
  const noise = simplex(seed ^ 0x51ed)
  const pace = createPace()
  const pointer = { x: 0, y: 0, energy: 0, travel: 0, seen: false }
  let rings: Ring[] = []
  let field = new Float32Array(0)
  let glyphs = new Uint32Array(0)
  let width = 0
  let height = 0
  let time = 0
  let nextDrop = 0
  let drops = 0
  let version = 0
  let fieldKey = ""

  // Ring centres are kept in screen space, with rows scaled by the aspect, so rings stay round.
  const ring = (x: number, y: number, kind: Kind, scale = 1) => {
    if (rings.length >= MAX_RINGS) rings.shift()
    rings.push({ x, y: y * ASPECT, age: 0, kind, height: kind.height * scale })
  }
  const drop = () => {
    ring(random() * width, random() * height, DROP, 0.6 + random() * 0.6)
    drops++
  }
  const interval = () => -Math.log(1 - random()) / (width * height * (RAIN + DOWNPOUR * pace.boost))
  const age = (seconds: number) => {
    for (const item of rings) item.age += seconds
    rings = rings.filter((item) => item.age < item.kind.life)
  }

  function resize(nextWidth: number, nextHeight: number) {
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    field = new Float32Array(width * height)
    glyphs = new Uint32Array(width * height)
    // A few rings of different ages are already spreading on the very first frame.
    rings = []
    for (let i = 0; i < 6; i++) {
      drop()
      age(0.45)
    }
    nextDrop = interval()
  }

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
    /** Raindrops that have landed so far. */
    get drops() {
      return drops
    },
    /** Rings currently spreading. */
    get rings() {
      return rings.length
    },
    /** Glyph code for every cell, row-major, valid after `field`. */
    get glyphs() {
      return glyphs
    },
    poke() {
      pace.poke()
    },
    /** Pointer position in cells. Moving it drops a trail of small ripples that merge into a wake. */
    move(x: number, y: number) {
      pace.poke()
      const px = x + 0.5
      const py = y + 0.5
      if (pointer.seen) {
        const distance = Math.hypot(px - pointer.x, (py - pointer.y) * ASPECT)
        pointer.energy = Math.min(1, pointer.energy + distance * 0.06)
        pointer.travel += distance
        if (pointer.travel >= WAKE_SPACING) {
          pointer.travel = 0
          ring(px, py, WAKE, Math.min(1, 0.4 + distance * 0.12))
        }
      }
      pointer.x = px
      pointer.y = py
      pointer.seen = true
    },
    /** Keystrokes drop a stone at the caret. */
    shock(x: number, y: number) {
      pace.poke()
      ring(x + 0.5, y + 0.5, STONE)
    },
    /** Advances the water by `delta` milliseconds. Returns false once it has come to rest. */
    step(delta: number, streaming: boolean) {
      const seconds = pace.advance(delta, streaming)
      pointer.energy *= Math.exp(-Math.min(delta, 250) / WAKE_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0
      if (width > 0 && seconds > 0) {
        time += seconds
        age(seconds)
        nextDrop -= seconds
        while (nextDrop <= 0) {
          drop()
          nextDrop += interval()
        }
      }
      version++
      return pace.activity > 0 || pace.boost > 0 || pointer.energy > 0
    },
    /** Lit water surface in [0, 1] for every cell, row-major. Cached until the next step or a size change. */
    field(nextWidth: number, nextHeight: number) {
      resize(nextWidth, nextHeight)
      const key = `${width}x${height}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      const right = width
      const bottom = height * ASPECT
      // Each ring plus the mirror images that carry its reflections, once its front has reached that edge.
      const sources = rings.flatMap((item) => {
        const front = item.age * item.kind.speed
        const fade = item.height * (1 - item.age / item.kind.life) ** 1.2
        const own = { x: item.x, y: item.y, front, fade, kind: item.kind }
        const mirrors = [
          { x: -item.x, y: item.y, edge: item.x },
          { x: 2 * right - item.x, y: item.y, edge: right - item.x },
          { x: item.x, y: -item.y, edge: item.y },
          { x: item.x, y: 2 * bottom - item.y, edge: bottom - item.y },
        ]
          .filter((mirror) => front > mirror.edge)
          .map((mirror) => ({ x: mirror.x, y: mirror.y, front, fade: fade * REFLECT, kind: item.kind }))
        return [own, ...mirrors]
      })
      const drift = time * 0.05
      for (let y = 0; y < height; y++) {
        const sy = (y + 0.5) * ASPECT
        for (let x = 0; x < width; x++) {
          const sx = x + 0.5
          let surface = 0
          let gx = 0
          let gy = 0
          for (const source of sources) {
            const dx = sx - source.x
            const dy = sy - source.y
            const r = Math.sqrt(dx * dx + dy * dy)
            // Distance behind the leading crest; the train of smaller crests follows it inward.
            const behind = source.front - r
            const train = source.kind.wavelength * source.kind.train
            if (behind < -1 || behind > train) continue
            const k = (2 * Math.PI) / source.kind.wavelength
            const envelope = smoothstep(-1, 0.6, behind) * (1 - behind / train) ** 2
            const amplitude = (source.fade * envelope) / Math.sqrt(1 + r * 0.06)
            surface += amplitude * Math.cos(k * behind)
            // Radial slope of the crest, split into screen directions for the lighting.
            const slope = (amplitude * k * Math.sin(k * behind)) / Math.max(r, 0.5)
            gx += slope * dx
            gy += slope * dy
          }
          // Positive where the surface faces the light.
          const lit = -(gx * LIGHT_X + gy * LIGHT_Y) * 0.9
          // Caustics: thin bright filaments where two noise layers ridge together.
          const a = 1 - Math.abs(noise(sx * 0.07 + drift, sy * 0.07 - drift * 0.6))
          const b = 1 - Math.abs(noise(sx * 0.11 - drift * 0.8, sy * 0.11 + drift * 0.4))
          const caustic = 0.22 * (a * b) ** 4
          let level = caustic * (1 + Math.min(0, lit))
          level += 0.45 * Math.max(0, lit) ** 0.8 + 0.5 * Math.min(1, Math.abs(surface)) ** 0.75
          level += 0.3 * smoothstep(0.55, 1.1, lit)
          level = level < 0 ? 0 : level > 1 ? 1 : level
          const i = y * width + x
          field[i] = level
          glyphs[i] = glyph(level)
        }
      }
      return field
    },
  }
}

/** Ripple colours: deep water through teal to white glints; light backgrounds keep the hues in reverse luminance. */
export const RIPPLE_STOPS = {
  dark: [
    [10, 32, 58],
    [26, 88, 132],
    [70, 172, 210],
    [214, 246, 255],
  ],
  light: [
    [196, 218, 234],
    [122, 166, 198],
    [36, 106, 150],
    [8, 46, 80],
  ],
} as const
