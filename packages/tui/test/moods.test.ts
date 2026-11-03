import { type BufferAccess } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { AURORA_STOPS, createAurora } from "../src/ui/aurora"
import { createEmbers, EMBERS_STOPS } from "../src/ui/embers"
import { createRipple, RIPPLE_STOPS } from "../src/ui/ripple"
import { backgroundPalette, compositeVortex, VORTEX_IDLE_AFTER } from "../src/ui/vortex"
import { createWarp, WARP_STOPS } from "../src/ui/warp"

const FRAME = 1000 / 24
const W = 80
const H = 24

function cells(width: number, height: number, base: Uint16Array): BufferAccess {
  const bg = new Uint16Array(width * height * 4)
  for (let i = 0; i < width * height; i++) bg.set(base, i * 4)
  return {
    width,
    height,
    generation: 0n,
    char: new Uint32Array(width * height).fill(32),
    fg: new Uint16Array(width * height * 4),
    bg,
    attributes: new Uint32Array(width * height),
  }
}

const visible = (field: Float32Array) => field.filter((value) => value >= 1 / 24).length
const changed = (a: Float32Array, b: Float32Array, by = 0.05) =>
  a.filter((value, i) => Math.abs(value - b[i]!) > by).length
const run = (mood: { step(delta: number, streaming: boolean): boolean }, frames: number, streaming = false) => {
  for (let i = 0; i < frames; i++) mood.step(FRAME, streaming)
}

// Every mood shares the same contract, so the same checks run against each.
const moods = [
  ["ripple", createRipple],
  ["warp", createWarp],
  ["embers", createEmbers],
  ["aurora", createAurora],
] as const

describe.each(moods)("%s", (_name, create) => {
  test("the first frame is already full, in range and deterministic", () => {
    const a = create(7)
    const b = create(7)
    const field = a.field(W, H)
    expect(Array.from(field)).toEqual(Array.from(b.field(W, H)))
    expect(Array.from(a.glyphs)).toEqual(Array.from(b.glyphs))
    expect(field.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(visible(field)).toBeGreaterThan(40)
  })

  test("it moves while awake", () => {
    const mood = create()
    const before = mood.field(W, H).slice()
    run(mood, 24)
    expect(changed(mood.field(W, H), before)).toBeGreaterThan(20)
  })

  test("it eases to rest after the idle timeout, holds still, and wakes on input", () => {
    const mood = create()
    mood.field(W, H)
    for (let elapsed = 0; elapsed < VORTEX_IDLE_AFTER; elapsed += FRAME) expect(mood.step(FRAME, false)).toBe(true)
    let frames = 0
    while (mood.step(FRAME, false)) frames++
    expect(mood.activity).toBe(0)
    // The slowdown is gradual: a few seconds of slowing frames rather than an abrupt stop.
    expect(frames).toBeGreaterThan(24)
    const still = mood.field(W, H).slice()
    mood.step(FRAME, false)
    expect(Array.from(mood.field(W, H))).toEqual(Array.from(still))

    mood.poke()
    expect(mood.step(FRAME, false)).toBe(true)
    expect(mood.activity).toBeGreaterThan(0)
  })

  test("pointer movement adds energy that decays", () => {
    const mood = create()
    mood.field(W, H)
    for (let x = 20; x <= 50; x += 2) mood.move(x, 10)
    expect(mood.energy).toBeGreaterThan(0.3)
    run(mood, 200)
    expect(mood.energy).toBe(0)
  })

  test("a streaming reply keeps it awake and eases in the boost", () => {
    const mood = create()
    mood.field(W, H)
    for (let elapsed = 0; elapsed < VORTEX_IDLE_AFTER + 10_000; elapsed += FRAME)
      expect(mood.step(FRAME, true)).toBe(true)
    expect(mood.boost).toBe(1)
    expect(mood.activity).toBe(1)
  })
})

test("ripple: raindrops keep landing, a stone sends out a ring, and streaming brings a downpour", () => {
  const calm = createRipple()
  calm.field(W, H)
  const landed = calm.drops
  run(calm, 96)
  expect(calm.drops).toBeGreaterThan(landed)

  const busy = createRipple()
  busy.field(W, H)
  run(busy, 96, true)
  expect(busy.drops - landed).toBeGreaterThan(calm.drops - landed)

  const stone = createRipple()
  const before = stone.field(W, H).slice()
  stone.shock(40, 12)
  run(stone, 12)
  const after = stone.field(W, H)
  // The ring has spread away from where the stone landed.
  const ring = [-1, 0, 1].map((dy) => after[(12 + dy) * W + 40 + 12]! - before[(12 + dy) * W + 40 + 12]!)
  expect(changed(after, before, 0.1)).toBeGreaterThan(30)
  expect(Math.max(...ring.map(Math.abs))).toBeGreaterThan(0.05)
})

test("ripple: the pointer leaves a wake of ripples behind it", () => {
  const ripple = createRipple()
  ripple.field(W, H)
  const rings = ripple.rings
  for (let x = 10; x <= 60; x++) ripple.move(x, 12)
  expect(ripple.rings).toBeGreaterThan(rings + 10)
})

test("warp: the pointer steers the vanishing point, keystrokes speed up, streaming reaches warp speed", () => {
  const warp = createWarp()
  warp.field(W, H)
  expect(warp.focus).toEqual({ x: W / 2, y: H / 2 })
  for (let i = 0; i < 24; i++) {
    warp.move(70 + (i % 2), 4)
    warp.step(FRAME, false)
  }
  expect(warp.focus.x).toBeGreaterThan(W / 2 + 10)
  expect(warp.focus.y).toBeLessThan(H / 2 - 2)

  const cruise = warp.speed
  warp.shock(40, 20)
  warp.step(FRAME, false)
  expect(warp.speed).toBeGreaterThan(cruise + 1)

  const hyper = createWarp()
  hyper.field(W, H)
  run(hyper, 48, true)
  expect(hyper.speed).toBeGreaterThan(cruise * 5)
  // At warp speed the stars stretch into streaks.
  const streaks = Array.from(hyper.field(W, H)).filter(
    (value, i) => value >= 1 / 24 && "-|/\\".includes(String.fromCodePoint(hyper.glyphs[i]!)),
  )
  expect(streaks.length).toBeGreaterThan(60)
  expect(new Set(hyper.tones).size).toBeGreaterThan(1)
})

test("embers: the fire burns along the bottom, keystrokes throw sparks, streaming stokes it taller", () => {
  const embers = createEmbers()
  const field = embers.field(W, H)
  const row = (y: number) => field.subarray(y * W, (y + 1) * W).reduce((sum, value) => sum + value, 0)
  expect(row(H - 1)).toBeGreaterThan(row(H - 8))
  expect(row(H - 8)).toBeGreaterThan(row(2))

  const sparks = embers.sparks
  embers.shock(40, 20)
  expect(embers.sparks).toBeGreaterThan(sparks + 10)

  const heat = (mood: ReturnType<typeof createEmbers>) => mood.field(W, H).reduce((sum, value) => sum + value, 0)
  const calm = createEmbers()
  calm.field(W, H)
  run(calm, 48)
  const stoked = createEmbers()
  stoked.field(W, H)
  run(stoked, 48, true)
  expect(heat(stoked)).toBeGreaterThan(heat(calm) * 1.15)
})

test("embers: the breeze bends the flames away from the pointer", () => {
  const embers = createEmbers()
  const before = embers.field(W, H).slice()
  for (let x = 30; x <= 44; x++) embers.move(x, H - 4)
  embers.step(0, false)
  expect(changed(embers.field(W, H), before, 0.1)).toBeGreaterThan(20)
})

test("aurora: the curtains hang in the upper sky in several colours, and keystrokes send a surge", () => {
  const aurora = createAurora()
  const field = aurora.field(W, H)
  const band = (from: number, to: number) => field.subarray(from * W, to * W).reduce((sum, value) => sum + value, 0)
  expect(band(0, H / 2)).toBeGreaterThan(band(H - 4, H) * 3)
  expect(new Set(Array.from(aurora.tones).filter((_, i) => field[i]! >= 0.1)).size).toBeGreaterThan(1)

  const calm = createAurora()
  calm.field(W, H)
  aurora.shock(40, 20)
  expect(aurora.surges).toBe(1)
  run(aurora, 6)
  run(calm, 6)
  const surged = aurora.field(W, H)
  const quiet = calm.field(W, H)
  expect(surged.filter((value, i) => value > quiet[i]! + 0.05).length).toBeGreaterThan(10)
  run(aurora, 60)
  expect(aurora.surges).toBe(0)
})

test("the compositor paints each cell from the palette its tone selects", () => {
  const base = new Uint16Array([0, 0, 0, 255])
  const target = cells(4, 1, base)
  const palette = backgroundPalette([0, 0, 0], ...AURORA_STOPS)
  const glyphs = new Uint32Array(4).fill("|".codePointAt(0)!)
  compositeVortex(target, new Float32Array(4).fill(1), palette, base, glyphs, Uint8Array.from([0, 1, 2, 3]))
  const colors = [0, 1, 2, 3].map((i) => Array.from(target.fg.subarray(i * 4, i * 4 + 3)).join())
  expect(new Set(colors).size).toBe(4)
  expect(String.fromCodePoint(target.char[0]!)).toBe("|")
  // Without tones every cell uses the first lookup, as the single-palette moods expect.
  for (const stops of [RIPPLE_STOPS, EMBERS_STOPS, WARP_STOPS[0]]) {
    expect(backgroundPalette([0, 0, 0], stops).length).toBe(palette.length / 4)
  }
})
