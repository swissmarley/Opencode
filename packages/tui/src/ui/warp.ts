/**
 * A starfield flying toward the viewer, the "warp" mood.
 *
 * Stars live in a 3D volume in front of the camera and are projected through a vanishing point. Far stars fade in as
 * dim dots and grow through `·`, `+` and `*` as they close in. Each star is drawn with the streak it covered over the
 * last fraction of a second, so near and fast stars stretch into lines that point away from the vanishing point.
 * Moving the pointer steers the flight by pulling the vanishing point toward it, keystrokes give a short burst of
 * speed, and a streaming reply jumps to hyperspace: long streaks and a glow at the centre of the tunnel.
 *
 * Stars come in three colour temperatures (cool, white and warm), painted from separate palettes.
 *
 * This module holds only state and math, like `ui/vortex.ts`; `component/vortex-background.ts` wires it up.
 */

import { mulberry32 } from "./matrix"
import { ASPECT, createPace } from "./mood"
import { smoothstep } from "./vortex"

const FAR = 3 // depth where stars are born
const NEAR = 0.06
const SPREAD = 2.4 // half-width of the volume stars are born in
const CRUISE = 0.32 // depth units per second at rest
const HYPER = 2.8 // at full streaming boost
const BURST = 1.6 // extra speed per keystroke
const BURST_LIMIT = 3.2
const BURST_DECAY = 700 // ms e-folding time
const TRAIL = 0.11 // seconds of travel each streak shows
const DENSITY = 0.05 // stars per cell
const MAX_STARS = 1_200
const STEER = 0.85 // how far the vanishing point follows the pointer
const STEER_EASE = 600 // ms for the vanishing point to catch up
const WAKE_DECAY = 1_400
const GLOW = 0.12 // radius of the hyperspace glow, as a share of the view
const TONES = [0.45, 0.85, 1] as const // cumulative share of cool, white and warm stars

type Star = { x: number; y: number; z: number; tone: number; twinkle: number }

export type Warp = ReturnType<typeof createWarp>

export function createWarp(seed = 0x0c0de) {
  const random = mulberry32(seed)
  const pace = createPace()
  const pointer = { x: 0, y: 0, energy: 0, seen: false }
  const focus = { x: 0, y: 0 }
  let stars: Star[] = []
  let field = new Float32Array(0)
  let glyphs = new Uint32Array(0)
  let tones = new Uint8Array(0)
  let width = 0
  let height = 0
  let speed = CRUISE
  let burst = 0
  let time = 0
  let version = 0
  let fieldKey = ""

  const star = (z: number): Star => {
    const temperature = random()
    return {
      x: (random() * 2 - 1) * SPREAD,
      y: (random() * 2 - 1) * SPREAD,
      z,
      tone: TONES.findIndex((share) => temperature < share),
      twinkle: random() * Math.PI * 2,
    }
  }
  const scale = () => Math.max(8, Math.min(width, height * ASPECT) * 0.5)

  // A fresh sky is filled at every depth, so the first (and, with animations off, only) frame is already full.
  function resize(nextWidth: number, nextHeight: number) {
    if (nextWidth === width && nextHeight === height) return
    const fresh = width === 0
    width = nextWidth
    height = nextHeight
    field = new Float32Array(width * height)
    glyphs = new Uint32Array(width * height)
    tones = new Uint8Array(width * height)
    if (fresh) {
      focus.x = width / 2
      focus.y = height / 2
    }
    const count = Math.min(MAX_STARS, Math.round(width * height * DENSITY))
    stars = stars.slice(0, count)
    while (stars.length < count) stars.push(star(NEAR + random() * (FAR - NEAR)))
  }

  const plot = (x: number, y: number, code: number, level: number, tone: number) => {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return
    const i = cy * width + cx
    if (level <= field[i]!) return
    field[i] = level
    glyphs[i] = code
    tones[i] = tone
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
    get speed() {
      return speed
    },
    /** Where the stars stream out from, in cells. */
    get focus() {
      return { x: focus.x, y: focus.y }
    },
    /** Glyph code for every cell, row-major, valid after `field`. */
    get glyphs() {
      return glyphs
    },
    /** Colour temperature for every cell (0 cool, 1 white, 2 warm), valid after `field`. */
    get tones() {
      return tones
    },
    poke() {
      pace.poke()
    },
    /** Pointer position in cells. Moving the pointer steers the flight toward it. */
    move(x: number, y: number) {
      pace.poke()
      if (pointer.seen)
        pointer.energy = Math.min(1, pointer.energy + Math.hypot(x - pointer.x, (y - pointer.y) * ASPECT) * 0.05)
      pointer.x = x + 0.5
      pointer.y = y + 0.5
      pointer.seen = true
    },
    /** Keystrokes give a short burst of speed. */
    shock(_x: number, _y: number) {
      pace.poke()
      burst = Math.min(BURST_LIMIT, burst + BURST)
    },
    /** Advances the flight by `delta` milliseconds. Returns false once it has come to rest. */
    step(delta: number, streaming: boolean) {
      const seconds = pace.advance(delta, streaming)
      const dt = Math.min(delta, 250)
      burst *= Math.exp(-dt / BURST_DECAY)
      if (burst < 0.005) burst = 0
      pointer.energy *= Math.exp(-dt / WAKE_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0
      const boost = pace.boost
      speed = CRUISE + (HYPER - CRUISE) * boost * boost + burst
      if (width > 0 && seconds > 0) {
        time += seconds
        const pull = Math.min(1, pointer.energy * 2) * STEER
        const targetX = width / 2 + (pointer.x - width / 2) * pull
        const targetY = height / 2 + (pointer.y - height / 2) * pull
        const ease = 1 - Math.exp(-(seconds * 1000) / STEER_EASE)
        focus.x += (targetX - focus.x) * ease
        focus.y += (targetY - focus.y) * ease
        const f = scale()
        for (const item of stars) {
          item.z -= speed * seconds
          const sx = focus.x + (item.x / item.z) * f
          const sy = focus.y + (item.y / item.z) * (f / ASPECT)
          if (item.z > NEAR && sx > -2 && sx < width + 2 && sy > -2 && sy < height + 2) continue
          Object.assign(item, star(FAR))
        }
      }
      version++
      return pace.activity > 0 || pace.boost > 0 || pointer.energy > 0 || burst > 0
    },
    /** Star brightness in [0, 1] for every cell, row-major. Cached until the next step or a size change. */
    field(nextWidth: number, nextHeight: number) {
      resize(nextWidth, nextHeight)
      const key = `${width}x${height}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      field.fill(0)
      const f = scale()
      const rush = Math.min(1, pace.boost + burst * 0.3)
      if (rush > 0) {
        // The tunnel glows faintly around the vanishing point at warp speed.
        const radius = f * GLOW * 3
        for (
          let y = Math.max(0, Math.floor(focus.y - radius / ASPECT));
          y < Math.min(height, focus.y + radius / ASPECT);
          y++
        ) {
          for (let x = Math.max(0, Math.floor(focus.x - radius)); x < Math.min(width, focus.x + radius); x++) {
            const r = Math.hypot(x + 0.5 - focus.x, (y + 0.5 - focus.y) * ASPECT) / (f * GLOW)
            plot(x, y, DOT, rush * 0.3 * Math.exp(-r * r), 1)
          }
        }
      }
      for (const item of stars) {
        const near = 1 - item.z / FAR
        const fade = smoothstep(FAR, FAR * 0.72, item.z)
        const level = fade * (0.3 + 0.7 * near ** 1.5) * (0.88 + 0.12 * Math.sin(time * 2.6 + item.twinkle))
        if (level < 0.03) continue
        const hx = focus.x + (item.x / item.z) * f
        const hy = focus.y + (item.y / item.z) * (f / ASPECT)
        const tail = Math.min(FAR, item.z + speed * TRAIL)
        const tx = focus.x + (item.x / tail) * f
        const ty = focus.y + (item.y / tail) * (f / ASPECT)
        const dx = hx - tx
        const dy = (hy - ty) * ASPECT
        if (Math.hypot(dx, dy) < 1.4) {
          plot(hx, hy, level > 0.72 ? STAR : level > 0.48 ? PLUS : level > 0.26 ? DOT : SPECK, level, item.tone)
          continue
        }
        const code = streak(dx, dy)
        const count = Math.ceil(Math.max(Math.abs(hx - tx), Math.abs(hy - ty)))
        for (let k = 0; k < count; k++) {
          const t = k / count
          plot(tx + (hx - tx) * t, ty + (hy - ty) * t, code, level * (0.12 + 0.88 * t * t), item.tone)
        }
        plot(hx, hy, level > 0.7 && speed < HYPER * 0.5 ? STAR : code, level, item.tone)
      }
      return field
    },
  }
}

const SPECK = ".".codePointAt(0)!
const DOT = "·".codePointAt(0)!
const PLUS = "+".codePointAt(0)!
const STAR = "*".codePointAt(0)!
const DASH = "-".codePointAt(0)!
const PIPE = "|".codePointAt(0)!
const SLASH = "/".codePointAt(0)!
const BACKSLASH = "\\".codePointAt(0)!

/** The line glyph closest to a streak's direction, measured in screen space (`dy` already scaled by the aspect). */
function streak(dx: number, dy: number) {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax > ay * 2.4) return DASH
  if (ay > ax * 2.4) return PIPE
  // Rows grow downward, so a streak heading right and down leans like a backslash.
  return dx * dy > 0 ? BACKSLASH : SLASH
}

/** Star colours by temperature: cool blue, white and warm amber, each blended toward the theme background. */
export const WARP_STOPS = [
  {
    dark: [
      [18, 26, 60],
      [56, 84, 150],
      [120, 170, 240],
      [220, 236, 255],
    ],
    light: [
      [206, 214, 236],
      [140, 158, 206],
      [56, 86, 168],
      [16, 32, 90],
    ],
  },
  {
    dark: [
      [30, 30, 40],
      [92, 94, 112],
      [182, 184, 200],
      [255, 255, 255],
    ],
    light: [
      [218, 218, 224],
      [160, 160, 172],
      [86, 86, 100],
      [24, 24, 34],
    ],
  },
  {
    dark: [
      [48, 28, 14],
      [138, 92, 44],
      [236, 176, 98],
      [255, 238, 206],
    ],
    light: [
      [236, 222, 204],
      [206, 162, 112],
      [156, 96, 34],
      [86, 46, 10],
    ],
  },
] as const
