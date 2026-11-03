import { VORTEX_IDLE_AFTER } from "./vortex"

/**
 * Shared pieces of the field-based moods (`ui/ripple.ts`, `ui/warp.ts`, `ui/embers.ts`, `ui/aurora.ts`): the idle and
 * streaming pacing every mood follows, and glyph ramps. Each mood is a self-contained simulation that turns its state
 * into a per-cell field level and glyph, which `compositeVortex` paints into empty background only.
 */

// Terminal cells are roughly twice as tall as they are wide.
export const ASPECT = 2

const BOOST_RISE = 1_200 // ms to ease fully into the streaming boost
const BOOST_FALL = 2_500
const IDLE_FADE = 4_000 // ms to slow from full speed to a standstill once idle
const WAKE_FADE = 350 // ms to come back to full speed on input

/**
 * The same pacing as the vortex: full speed while there is input or a streaming reply, a gradual slowdown to a
 * standstill after `VORTEX_IDLE_AFTER` without either, and a boost that eases in while a reply streams.
 */
export function createPace() {
  let idle = 0
  let activity = 1
  let boost = 0
  return {
    get activity() {
      return activity
    },
    get boost() {
      return boost
    },
    poke() {
      idle = 0
    },
    /** Advances the pacing by `delta` milliseconds and returns the seconds of motion to simulate, eased by activity. */
    advance(delta: number, streaming: boolean) {
      const dt = Math.min(delta, 250)
      idle = streaming ? 0 : idle + dt
      boost = streaming ? Math.min(1, boost + dt / BOOST_RISE) : Math.max(0, boost - dt / BOOST_FALL)
      activity =
        idle > VORTEX_IDLE_AFTER ? Math.max(0, activity - dt / IDLE_FADE) : Math.min(1, activity + dt / WAKE_FADE)
      return (dt / 1000) * activity * activity * (3 - 2 * activity)
    },
  }
}

/** Maps a level in [0, 1] to a code point of `ramp`, sparse to dense. */
export function glyphRamp(ramp: string) {
  const codes = Uint32Array.from(ramp, (char) => char.codePointAt(0)!)
  return (level: number) => codes[Math.min(codes.length - 1, Math.max(0, Math.round(level * (codes.length - 1))))]!
}
