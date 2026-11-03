import type { BufferAccess } from "@opentui/core"
import { logo } from "../logo"

/**
 * Polar swirling-noise background field.
 *
 * The field is a slowly rotating logarithmic spiral whose arms are bent by two octaves of simplex noise sampled in the
 * rotating frame, so the flow reads as a fluid vortex rather than a rigid pinwheel. A soft void is carved at the centre
 * (and optionally the OPENCODE wordmark). Pointer movement injects a local vortex wake, keystrokes launch radial
 * shockwaves, and a streaming boost speeds up the spin and raises the wave frequency.
 *
 * This module holds only state and math. `component/vortex-background.ts` wires it to the renderer.
 */

// Each mode is a "mood": the animated background behind the interface. `matrix` lives in `ui/matrix.ts`.
export const VORTEX_MODES = ["vortex", "watermark", "matrix", "off"] as const
export type VortexMode = (typeof VORTEX_MODES)[number]
export const VORTEX_FPS = 24
export const VORTEX_IDLE_AFTER = 30_000
export const VORTEX_RAMP = " ·.:;+=xX$&#@"

const RAMP_CODES = Uint32Array.from(VORTEX_RAMP, (char) => char.codePointAt(0)!)
const SPACE = 32
// Terminal cells are roughly twice as tall as they are wide.
const ASPECT = 2
const SPIN = 0.16 // rad/s rigid rotation at rest
const TWIST = 1.7 // log-spiral winding
const ARMS = 3
const FREQUENCY = 1.55
const VOID = 0.2
const WAKE_RADIUS = 0.32
const WAKE_DECAY = 900 // ms e-folding time for pointer wake energy
const VELOCITY_DECAY = 350
const SHOCK_SPEED = 1.5 // normalized radii per second
const SHOCK_LIFE = 1.3 // seconds
const SHOCK_WIDTH = 0.07
const SHOCK_LIMIT = 6
const BOOST_RISE = 1_200 // ms to ease fully into the streaming boost
const BOOST_FALL = 2_500
const IDLE_FADE = 4_000 // ms to slow from full speed to a standstill once idle
const WAKE_FADE = 350 // ms to come back to full speed on input
const LEVELS = 64
const PLATE = 0.3
// Compositor spacing: inner gaps narrower than GAP stay blank; HALO blank cells always pad content.
const GAP = 8
const HALO = 2

type Shock = { x: number; y: number; age: number }

export type Vortex = ReturnType<typeof createVortex>

export function createVortex(seed = 0x0c0de) {
  const noise = simplex(seed)
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, energy: 0, seen: false }
  const shocks: Shock[] = []
  let time = 0
  let phase = 0
  let boost = 0
  let activity = 1
  let idle = 0
  let version = 0
  let field = new Float32Array(0)
  let fieldKey = ""

  return {
    get time() {
      return time
    },
    get boost() {
      return boost
    },
    get activity() {
      return activity
    },
    get energy() {
      return pointer.energy
    },
    get shocks() {
      return shocks.length
    },
    /** Marks user activity so the field wakes from (or stays out of) idle. */
    poke() {
      idle = 0
    },
    /** Pointer position in cells. Velocity and wake energy come from the distance moved since the last call. */
    move(x: number, y: number) {
      idle = 0
      if (pointer.seen) {
        const dx = x - pointer.x
        const dy = (y - pointer.y) * ASPECT
        pointer.vx = pointer.vx * 0.6 + dx * 0.4
        pointer.vy = pointer.vy * 0.6 + dy * 0.4
        pointer.energy = Math.min(1.4, pointer.energy + Math.hypot(dx, dy) * 0.07)
      }
      pointer.x = x
      pointer.y = y
      pointer.seen = true
    },
    /** Launches a radial shockwave from a cell. */
    shock(x: number, y: number) {
      idle = 0
      if (shocks.length >= SHOCK_LIMIT) shocks.shift()
      shocks.push({ x, y, age: 0 })
    },
    /**
     * Advances the simulation by `delta` milliseconds. Returns false once the field has come to rest (idle, no wake,
     * no shocks, no boost), which is the caller's cue to stop ticking until the next poke.
     */
    step(delta: number, streaming: boolean) {
      const dt = Math.min(delta, 250)
      idle = streaming ? 0 : idle + dt
      boost = streaming ? Math.min(1, boost + dt / BOOST_RISE) : Math.max(0, boost - dt / BOOST_FALL)
      activity =
        idle > VORTEX_IDLE_AFTER ? Math.max(0, activity - dt / IDLE_FADE) : Math.min(1, activity + dt / WAKE_FADE)
      const eased = activity * activity * (3 - 2 * activity)
      const seconds = (dt / 1000) * eased
      time += seconds * (1 + 0.5 * boost)
      phase += seconds * SPIN * (1 + 2.2 * boost)
      pointer.energy *= Math.exp(-dt / WAKE_DECAY)
      pointer.vx *= Math.exp(-dt / VELOCITY_DECAY)
      pointer.vy *= Math.exp(-dt / VELOCITY_DECAY)
      if (pointer.energy < 0.005) pointer.energy = 0
      for (const shock of shocks) shock.age += dt / 1000
      while (shocks.length && shocks[0]!.age >= SHOCK_LIFE) shocks.shift()
      version++
      return activity > 0 || boost > 0 || pointer.energy > 0 || shocks.length > 0
    },
    /** Field intensity in [0, 1] for every cell, row-major. Cached until the next step or a size/mode change. */
    field(width: number, height: number, mode: VortexMode) {
      const key = `${width}x${height}:${mode}:${version}`
      if (key === fieldKey) return field
      fieldKey = key
      if (field.length !== width * height) field = new Float32Array(width * height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.max(8, Math.min(width, height * ASPECT) / 2)
      const frequency = FREQUENCY * (1 + 0.4 * boost)
      const drift = time * 0.05
      // The wordmark takes the centre in watermark mode, so the void shrinks to let the flow fill in around it.
      const breath = (mode === "watermark" ? VOID * 0.35 : VOID) + 0.025 * Math.sin(time * 0.6)
      const pu = (pointer.x + 0.5 - cx) / radius
      const pv = ((pointer.y + 0.5 - cy) * ASPECT) / radius
      const wake = pointer.energy
      const pvx = pointer.vx / radius
      const pvy = pointer.vy / radius
      const mask = mode === "watermark" ? watermark(width, height) : undefined
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let u = (x + 0.5 - cx) / radius
          let v = ((y + 0.5 - cy) * ASPECT) / radius
          if (wake > 0) {
            // A local vortex around the pointer, dragged back along its velocity, bends the flow around the cursor.
            const du = u - pu
            const dv = v - pv
            const w = wake * Math.exp(-(du * du + dv * dv) / (WAKE_RADIUS * WAKE_RADIUS))
            const angle = w * 1.9
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            u = pu + du * cos - dv * sin - pvx * w * 0.6
            v = pv + du * sin + dv * cos - pvy * w * 0.6
          }
          const r = Math.sqrt(u * u + v * v)
          const swirl = Math.atan2(v, u) + phase + TWIST * Math.log(r + 0.06) + 0.35 * Math.sin(time * 0.13 + r * 3)
          const sx = r * Math.cos(swirl) * frequency
          const sy = r * Math.sin(swirl) * frequency
          const n = noise(sx + drift, sy - drift * 0.6) * 0.65 + noise(sx * 2.1 - drift * 1.7, sy * 2.1 + drift) * 0.35
          const crest = 0.5 + 0.5 * Math.sin(ARMS * swirl + 1.3 * n)
          const arms = crest * crest
          let level = (0.68 * arms + 0.32 * (0.5 + 0.5 * n)) * smoothstep(breath, breath + 0.32, r)
          level *= 1 - 0.45 * smoothstep(0.9, 2, r)
          level = level * level * (1.3 - 0.3 * level)
          for (const shock of shocks) {
            const du = (x + 0.5 - shock.x) / radius
            const dv = ((y + 0.5 - shock.y) * ASPECT) / radius
            const delta = (Math.sqrt(du * du + dv * dv) - shock.age * SHOCK_SPEED) / SHOCK_WIDTH
            const fade = 1 - shock.age / SHOCK_LIFE
            level += Math.exp(-delta * delta) * fade * fade * 0.55
          }
          if (mask) {
            // Inside the wordmark's plate the flow never drops below a faint stipple, so the letters read as cut-outs.
            const cell = mask[y * width + x]!
            if (cell < 1) level = cell === 0 ? 0 : Math.max(level, PLATE) * (cell - 1 / 2) * 2
          }
          field[y * width + x] = level > 1 ? 1 : level
        }
      }
      return field
    },
  }
}

/**
 * Colour lookup from field level to an RGB triple, blended toward the theme background so the glyphs stay dim.
 * Dark backgrounds run midnight blue → slate → cyan → soft white; light backgrounds run the same hues in reverse
 * luminance so the peaks still read as the densest part of the flow.
 */
export function vortexPalette(background: readonly [number, number, number]) {
  return backgroundPalette(background, VORTEX_STOPS)
}

const VORTEX_STOPS = {
  dark: [
    [14, 26, 56],
    [44, 66, 99],
    [80, 146, 170],
    [196, 240, 255],
  ],
  light: [
    [201, 214, 232],
    [138, 164, 196],
    [63, 127, 153],
    [18, 56, 79],
  ],
} as const

type PaletteStops = Readonly<Record<"dark" | "light", readonly (readonly [number, number, number])[]>>

/** Blends a mood's colour stops toward the theme background, picking the light or dark set by its luminance. */
export function backgroundPalette(background: readonly [number, number, number], palette: PaletteStops) {
  const light = (0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]) / 255 > 0.5
  const stops = light ? palette.light : palette.dark
  const lut = new Uint8Array(LEVELS * 3)
  for (let i = 0; i < LEVELS; i++) {
    const level = i / (LEVELS - 1)
    const scaled = level * (stops.length - 1)
    const index = Math.min(stops.length - 2, Math.floor(scaled))
    const t = scaled - index
    // Peak strength stays well below full so foreground text keeps clear contrast.
    const strength = 0.22 + 0.33 * level
    for (let c = 0; c < 3; c++) {
      const color = stops[index]![c]! + (stops[index + 1]![c]! - stops[index]![c]!) * t
      lut[i * 3 + c] = Math.round(background[c]! + (color - background[c]!) * strength)
    }
  }
  return lut
}

/**
 * Paints the field into cells that are empty background: a plain space, no attributes, on the theme's base
 * background (or a fully transparent one). Empty cells are taken a row-run at a time: a gap between two pieces of
 * content on the same row is left alone unless it is at least `GAP` cells wide (so word gaps, aligned columns and
 * indentation inside text stay blank), and wider runs keep a `HALO`-cell margin next to any content. Foreground
 * cells, panels with their own background, selections, links and wide-character continuations are left exactly as
 * drawn, and no background is ever modified.
 *
 * `glyphs` supplies the character for each cell instead of the density ramp; the matrix mood uses it, while the
 * field level still decides whether a cell is drawn and its colour.
 */
export function compositeVortex(
  cells: BufferAccess,
  field: Float32Array,
  palette: Uint8Array,
  base: Uint16Array,
  glyphs?: Uint32Array,
) {
  const width = cells.width
  const height = cells.height
  const { char, fg, bg, attributes } = cells
  const b0 = base[0]!
  const b1 = base[1]!
  const b2 = base[2]!
  const b3 = base[3]!
  const empty = (i: number) => {
    if (char[i] !== SPACE || attributes[i] !== 0) return false
    const o = i * 4
    if ((bg[o + 3]! & 0xff) === 0) return true
    return bg[o] === b0 && bg[o + 1] === b1 && bg[o + 2] === b2 && bg[o + 3] === b3
  }
  const steps = RAMP_CODES.length - 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let x = 0
    while (x < width) {
      if (!empty(row + x)) {
        x++
        continue
      }
      const start = x
      while (x < width && empty(row + x)) x++
      const before = start > 0
      const after = x < width
      if (before && after && x - start < GAP) continue
      const from = before ? start + HALO : start
      const to = after ? x - HALO : x
      for (let cx = from; cx < to; cx++) {
        const i = row + cx
        const level = field[i] ?? 0
        const glyph = Math.round(level * steps)
        if (glyph === 0) continue
        const color = Math.round(level * (LEVELS - 1)) * 3
        const o = i * 4
        char[i] = glyphs ? glyphs[i]! : RAMP_CODES[glyph]!
        fg[o] = palette[color]!
        fg[o + 1] = palette[color + 1]!
        fg[o + 2] = palette[color + 2]!
        fg[o + 3] = 255
      }
    }
  }
}

let watermarkCache: { key: string; mask: Float32Array } | undefined

/**
 * Per-cell wordmark mask: 1 leaves the field alone, 0 carves a letter cell, and values in (0.5, 1) mark the plate
 * around the letters (a floor of faint stipple, scaled down for the one-cell halo that hugs each letter).
 */
function watermark(width: number, height: number) {
  const key = `${width}x${height}`
  if (watermarkCache?.key === key) return watermarkCache.mask
  const rows = logo.left.map((left, i) => `${left} ${logo.right[i]}`)
  const glyphWidth = rows[0]!.length
  // Scale the wordmark up when the terminal has room for it, never past the terminal itself.
  const scale = width >= glyphWidth * 2 + 8 && height >= rows.length * 2 + 6 ? 2 : 1
  const markWidth = glyphWidth * scale
  const markHeight = rows.length * scale
  const left = Math.floor((width - markWidth) / 2)
  const top = Math.floor((height - markHeight) / 2)
  // Only the block glyphs are ink; `_`, `^` and `~` are the logo's interior shading. At 2x each half block fills
  // the matching sub-row, so the letters keep their shape.
  const solid = (x: number, y: number) => {
    const lx = Math.floor((x - left) / scale)
    const ly = Math.floor((y - top) / scale)
    if (ly < 0 || ly >= rows.length || lx < 0 || lx >= glyphWidth) return false
    const glyph = rows[ly]![lx]
    const lower = scale > 1 && (y - top) % scale === 1
    return glyph === "█" || (glyph === "▀" && !lower) || (glyph === "▄" && (lower || scale === 1))
  }
  const mask = new Float32Array(width * height).fill(1)
  const padX = 3 * scale
  const padY = scale
  for (let y = Math.max(0, top - padY); y < Math.min(height, top + markHeight + padY); y++) {
    for (let x = Math.max(0, left - padX); x < Math.min(width, left + markWidth + padX); x++) {
      const halo = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)
      mask[y * width + x] = solid(x, y) ? 0 : halo ? 0.65 : 0.999
    }
  }
  watermarkCache = { key, mask }
  return mask
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 2D simplex noise in roughly [-1, 1], with a permutation table shuffled from `seed`. */
function simplex(seed: number) {
  const perm = new Uint8Array(512)
  const source = Uint8Array.from({ length: 256 }, (_, i) => i)
  let state = seed >>> 0 || 1
  for (let i = 255; i > 0; i--) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const j = (state >>> 0) % (i + 1)
    const swap = source[i]!
    source[i] = source[j]!
    source[j] = swap
  }
  for (let i = 0; i < 512; i++) perm[i] = source[i & 255]!
  const gx = [1, -1, 1, -1, 1, -1, 0, 0]
  const gy = [1, 1, -1, -1, 0, 0, 1, -1]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  const corner = (hash: number, x: number, y: number) => {
    const t = 0.5 - x * x - y * y
    if (t < 0) return 0
    const g = hash & 7
    return t * t * t * t * (gx[g]! * x + gy[g]! * y)
  }
  return (x: number, y: number) => {
    const s = (x + y) * F2
    const i = Math.floor(x + s)
    const j = Math.floor(y + s)
    const t = (i + j) * G2
    const x0 = x - (i - t)
    const y0 = y - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const ii = i & 255
    const jj = j & 255
    return (
      70 *
      (corner(perm[ii + perm[jj]!]!, x0, y0) +
        corner(perm[ii + i1 + perm[jj + j1]!]!, x0 - i1 + G2, y0 - j1 + G2) +
        corner(perm[ii + 1 + perm[jj + 1]!]!, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2))
    )
  }
}
