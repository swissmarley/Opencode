/**
 * A low fire along the bottom edge, the "embers" mood.
 *
 * The flames are turbulent noise scrolling upward through a flame-shaped envelope: solid and bright at the base,
 * torn into licking tongues of different heights toward the top, with the tips swaying in a slow draft. Sparks leave
 * the flame tips and drift up the screen, wandering on the turbulence and cooling from `*` through `+` to `'` as
 * they go. The pointer is a breeze that bends nearby flames and sparks away from it, keystrokes throw a spray of
 * sparks from the caret and make the flames below it flare, and a streaming reply stokes the fire taller and hotter.
 *
 * This module holds only state and math, like `ui/vortex.ts`; `component/vortex-background.ts` wires it up.
 */

import { mulberry32 } from "./matrix"
import { ASPECT, createPace, glyphRamp } from "./mood"
import { simplex, smoothstep } from "./vortex"

export const EMBERS_GLYPHS = " .':;=+*#%@"

const glyph = glyphRamp(EMBERS_GLYPHS)
const HEIGHT = 0.42 // flame height as a share of the screen at rest
const STOKED = 0.22 // extra height at full streaming boost
const RISE = 1.3 // noise units per second the turbulence scrolls up
const SPARKS = 0.05 // sparks per column per second at rest
const STREAM_SPARKS = 0.12 // extra sparks per column per second at full streaming boost
const MAX_SPARKS = 400
const SHOCK_SPARKS = 18
const FLARE_LIFE = 1.4 // seconds a keystroke flare lasts
const FLARE_LIMIT = 6
const BREEZE_RADIUS = 9 // cells (horizontal) the breeze reaches
const BREEZE_PUSH = 6 // cells a full-strength breeze bends a flame
const WAKE_DECAY = 1_100
const SPARK_PREROLL = 3 // seconds of sparks laid out on a fresh screen

type Spark = { x: number; y: number; vx: number; vy: number; heat: number; cooling: number }
type Flare = { x: number; age: number }

export type Embers = ReturnType<typeof createEmbers>

export function createEmbers(seed = 0x0c0de) {
  const random = mulberry32(seed)
  const noise = simplex(seed ^ 0xf12e)
  const pace = createPace()
  const pointer = { x: 0, y: 0, energy: 0, seen: false }
  let sparks: Spark[] = []
  const flares: Flare[] = []
  let field = new Float32Array(0)
  let glyphs = new Uint32Array(0)
  let width = 0
  let height = 0
  let time = 0
  let pending = 0
  let version = 0
  let fieldKey = ""

  // Horizontal displacement of the breeze at a cell: away from the pointer, strongest right next to it.
  const breeze = (x: number, y: number) => {
    if (pointer.energy === 0) return 0
    const du = (x - pointer.x) / BREEZE_RADIUS
    const dv = ((y - pointer.y) * ASPECT) / (BREEZE_RADIUS * 1.6)
    return Math.sign(du) * BREEZE_PUSH * pointer.energy * Math.exp(-(du * du + dv * dv))
  }
  // Each column's flame height in rows: tongues of different heights that slowly grow and shrink, raised by flares.
  const tongue = (x: number) => {
    let flare = 0
    for (const item of flares) {
      const fade = 1 - item.age / FLARE_LIFE
      flare += 0.7 * fade * fade * Math.exp(-(((x - item.x) / 6) ** 2))
    }
    const body = 0.7 + 0.3 * noise(x * 0.045, time * 0.22) + 0.18 * noise(x * 0.13 + 40, time * 0.5)
    return height * (HEIGHT + STOKED * pace.boost) * (body + flare)
  }
  const spark = (x: number, y: number, vx: number, vy: number, heat: number) => {
    if (sparks.length >= MAX_SPARKS) sparks.shift()
    sparks.push({ x, y, vx, vy, heat, cooling: 0.35 + random() * 0.4 })
  }
  const ember = () => {
    const x = random() * width
    spark(
      x,
      height - tongue(x) * (0.4 + random() * 0.6),
      (random() - 0.5) * 2,
      -(3 + random() * 5),
      0.8 + random() * 0.2,
    )
  }
  const drift = (seconds: number) => {
    for (const item of sparks) {
      // Sparks wander on the same turbulence that shapes the flames, and the breeze blows them aside.
      const sway = noise(item.x * 0.08, item.y * 0.16 - time * 0.6)
      item.vx += (sway * 9 + breeze(item.x, item.y) * 2 - item.vx * 0.8) * seconds
      item.vy += (-1.5 - item.vy * 0.25) * seconds
      item.x += item.vx * seconds
      item.y += item.vy * seconds
      item.heat -= item.cooling * seconds
    }
    sparks = sparks.filter((item) => item.heat > 0 && item.y > -1 && item.x > -1 && item.x < width + 1)
  }

  function resize(nextWidth: number, nextHeight: number) {
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    field = new Float32Array(width * height)
    glyphs = new Uint32Array(width * height)
    sparks = []
    // Sparks are already in the air on the very first frame.
    const tick = 1 / 24
    for (let t = 0; t < SPARK_PREROLL; t += tick) {
      for (let n = width * SPARKS * tick; n > 0; n--) if (random() < n) ember()
      drift(tick)
    }
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
    get sparks() {
      return sparks.length
    },
    /** Glyph code for every cell, row-major, valid after `field`. */
    get glyphs() {
      return glyphs
    },
    poke() {
      pace.poke()
    },
    /** Pointer position in cells. Moving it blows a breeze that bends the flames away from the pointer. */
    move(x: number, y: number) {
      pace.poke()
      if (pointer.seen)
        pointer.energy = Math.min(1, pointer.energy + Math.hypot(x - pointer.x, (y - pointer.y) * ASPECT) * 0.07)
      pointer.x = x + 0.5
      pointer.y = y + 0.5
      pointer.seen = true
    },
    /** Keystrokes throw a spray of sparks from the caret and make the flames below it flare. */
    shock(x: number, y: number) {
      pace.poke()
      for (let i = 0; i < SHOCK_SPARKS; i++) {
        const angle = -Math.PI / 2 + (random() - 0.5) * 1.6
        const power = 6 + random() * 10
        spark(x + 0.5, y + 0.5, Math.cos(angle) * power * 1.6, Math.sin(angle) * power, 1)
      }
      if (flares.length >= FLARE_LIMIT) flares.shift()
      flares.push({ x: x + 0.5, age: 0 })
    },
    /** Advances the fire by `delta` milliseconds. Returns false once it has come to rest. */
    step(delta: number, streaming: boolean) {
      const seconds = pace.advance(delta, streaming)
      pointer.energy *= Math.exp(-Math.min(delta, 250) / WAKE_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0
      if (width > 0 && seconds > 0) {
        time += seconds * (1 + 0.6 * pace.boost)
        for (const item of flares) item.age += seconds
        while (flares.length && flares[0]!.age >= FLARE_LIFE) flares.shift()
        pending += width * (SPARKS + STREAM_SPARKS * pace.boost) * seconds
        for (; pending >= 1; pending--) ember()
        drift(seconds)
      }
      version++
      return pace.activity > 0 || pace.boost > 0 || pointer.energy > 0 || flares.length > 0
    },
    /** Fire heat in [0, 1] for every cell, row-major. Cached until the next step or a size change. */
    field(nextWidth: number, nextHeight: number) {
      resize(nextWidth, nextHeight)
      const key = `${width}x${height}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      field.fill(0)
      glyphs.fill(32)
      const rise = time * RISE
      const heat = 1 + 0.25 * pace.boost
      for (let x = 0; x < width; x++) {
        const flame = tongue(x + 0.5)
        const top = Math.max(0, Math.floor(height - flame * 1.6))
        for (let y = top; y < height; y++) {
          // 0 at the base of the fire, 1 at the tip of this column's tongue.
          const up = (height - y - 0.5) / flame
          // The draft sways the tips, and the breeze bends the whole flame away from the pointer.
          const sx = x + 0.5 - breeze(x + 0.5, y + 0.5) - 2.2 * up * up * noise(time * 0.35, x * 0.01 + 7)
          const sy = (y + 0.5) * ASPECT
          const turbulence =
            // Stretched upright, so the turbulence tears the fire into tall licking tongues.
            noise(sx * 0.1, sy * 0.042 + rise) * 0.6 +
            noise(sx * 0.21, sy * 0.09 + rise * 2.1) * 0.28 +
            noise(sx * 0.42, sy * 0.2 + rise * 4) * 0.12
          // Solid at the base and torn into tongues near the tip.
          const body = 1 - 1.05 * up + turbulence * (0.6 + 0.6 * up)
          const level = smoothstep(0.05, 1.05, body) * heat * 0.92
          if (level <= 0) continue
          const i = y * width + x
          field[i] = level > 1 ? 1 : level
          glyphs[i] = glyph(field[i]!)
        }
      }
      for (const item of sparks) {
        const cx = Math.floor(item.x)
        const cy = Math.floor(item.y)
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue
        const i = cy * width + cx
        const level = 0.3 + 0.62 * item.heat
        if (level <= field[i]!) continue
        field[i] = level
        glyphs[i] = item.heat > 0.65 ? SPARK : item.heat > 0.35 ? GLOW : ASH
      }
      return field
    },
  }
}

const SPARK = "*".codePointAt(0)!
const GLOW = "+".codePointAt(0)!
const ASH = "'".codePointAt(0)!

/** Fire colours: ember red through orange to a pale yellow core; light backgrounds run them in reverse luminance. */
export const EMBERS_STOPS = {
  dark: [
    [64, 12, 6],
    [172, 42, 10],
    [246, 134, 28],
    [255, 238, 176],
  ],
  light: [
    [244, 208, 190],
    [224, 122, 66],
    [188, 60, 16],
    [110, 24, 4],
  ],
} as const
