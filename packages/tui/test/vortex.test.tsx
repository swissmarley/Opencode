/** @jsxImportSource @opentui/solid */
import { RGBA, type BufferAccess } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { nextVortexMode, vortexMode } from "../src/component/vortex-background"
import { compositeVortex, createVortex, VORTEX_IDLE_AFTER, VORTEX_RAMP, vortexPalette } from "../src/ui/vortex"

const FRAME = 1000 / 24

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

function write(target: BufferAccess, x: number, y: number, text: string) {
  Array.from(text).forEach((char, i) => (target.char[y * target.width + x + i] = char.codePointAt(0)!))
}

test("field stays in range, is deterministic, and keeps a void at the centre", () => {
  const a = createVortex(7).field(80, 24, "vortex")
  const b = createVortex(7).field(80, 24, "vortex")
  expect(Array.from(a)).toEqual(Array.from(b))
  expect(a.every((value) => value >= 0 && value <= 1)).toBe(true)
  expect(a[12 * 80 + 40]).toBeLessThan(0.02)
  expect(a.some((value) => value > 0.3)).toBe(true)
})

test("watermark mode carves the wordmark out of the centre", () => {
  const vortex = createVortex()
  const plain = vortex.field(100, 30, "vortex").slice()
  const marked = vortex.field(100, 30, "watermark")
  const changed = plain.filter((value, i) => value !== marked[i]).length
  expect(changed).toBeGreaterThan(100)
  // Rows above and below the wordmark plate are untouched.
  expect(Array.from(marked.subarray(0, 100 * 5))).toEqual(Array.from(plain.subarray(0, 100 * 5)))
})

test("animation eases to rest after the idle timeout and wakes on input", () => {
  const vortex = createVortex()
  let elapsed = 0
  while (elapsed < VORTEX_IDLE_AFTER) {
    expect(vortex.step(FRAME, false)).toBe(true)
    elapsed += FRAME
  }
  const time = vortex.time
  let frames = 0
  while (vortex.step(FRAME, false)) frames++
  expect(vortex.activity).toBe(0)
  // The throttle is gradual: a few seconds of slowing frames rather than an abrupt stop.
  expect(frames).toBeGreaterThan(24)
  expect(vortex.time).toBeGreaterThan(time)
  const rested = vortex.time
  vortex.step(FRAME, false)
  expect(vortex.time).toBe(rested)

  vortex.poke()
  expect(vortex.step(FRAME, false)).toBe(true)
  vortex.step(FRAME, false)
  expect(vortex.time).toBeGreaterThan(rested)
})

test("streaming keeps the field awake and boosts the swirl", () => {
  const calm = createVortex()
  const busy = createVortex()
  for (let elapsed = 0; elapsed < VORTEX_IDLE_AFTER + 10_000; elapsed += FRAME) {
    calm.step(FRAME, false)
    expect(busy.step(FRAME, true)).toBe(true)
  }
  expect(busy.boost).toBe(1)
  expect(busy.activity).toBe(1)
  expect(calm.activity).toBe(0)
  expect(busy.time).toBeGreaterThan(calm.time)
})

test("pointer wake injects energy that decays smoothly", () => {
  const vortex = createVortex()
  const before = vortex.field(60, 20, "vortex").slice()
  vortex.move(10, 10)
  vortex.move(20, 10)
  vortex.move(30, 12)
  expect(vortex.energy).toBeGreaterThan(0)
  const energy = vortex.energy
  vortex.step(0, false)
  const bent = vortex.field(60, 20, "vortex")
  expect(bent.some((value, i) => Math.abs(value - before[i]!) > 0.05)).toBe(true)
  vortex.step(FRAME, false)
  expect(vortex.energy).toBeLessThan(energy)
  for (let i = 0; i < 200; i++) vortex.step(FRAME, false)
  expect(vortex.energy).toBe(0)
})

test("keystroke shockwaves ripple outward and expire", () => {
  const vortex = createVortex()
  vortex.step(0, false)
  const before = vortex.field(80, 24, "vortex").slice()
  vortex.shock(40, 21)
  for (let i = 0; i < 6; i++) vortex.step(FRAME, false)
  const rippled = vortex.field(80, 24, "vortex")
  const brighter = rippled.filter((value, i) => value > before[i]! + 0.1).length
  expect(brighter).toBeGreaterThan(10)
  for (let i = 0; i < 40; i++) vortex.step(FRAME, false)
  expect(vortex.shocks).toBe(0)
})

test("compositor only fills empty base background away from text", () => {
  const base = RGBA.fromInts(12, 14, 20).buffer
  const panel = RGBA.fromInts(40, 40, 48).buffer
  const target = cells(30, 4, base)
  write(target, 2, 1, "hello world")
  for (let x = 18; x < 26; x++) target.bg.set(panel, (2 * 30 + x) * 4)
  target.attributes[3 * 30 + 5] = 1
  write(target, 0, 3, "a   b")
  const before = { char: target.char.slice(), fg: target.fg.slice(), bg: target.bg.slice() }
  compositeVortex(target, new Float32Array(30 * 4).fill(1), vortexPalette([12, 14, 20]), base)

  const at = (x: number, y: number) => String.fromCodePoint(target.char[y * 30 + x]!)
  // Text, the gap between its words, and its two-cell halo are untouched.
  expect(Array.from({ length: 15 }, (_, i) => at(i, 1)).join("")).toBe("  hello world  ")
  // Panels with their own background and cells with attributes are untouched.
  for (let x = 18; x < 26; x++) expect(at(x, 2)).toBe(" ")
  expect(at(5, 3)).toBe(" ")
  // A short gap between content on one row (aligned columns, indentation) stays blank.
  expect(Array.from({ length: 5 }, (_, i) => at(i, 3)).join("")).toBe("a   b")
  // Backgrounds are never modified anywhere.
  expect(Array.from(target.bg)).toEqual(Array.from(before.bg))
  // Open background takes the densest glyph with a dimmed colour.
  expect(at(0, 0)).toBe(VORTEX_RAMP.at(-1)!)
  expect(at(15, 1)).toBe(VORTEX_RAMP.at(-1)!)
  const fg = Array.from(target.fg.subarray(0, 3))
  expect(Math.max(...fg)).toBeLessThan(200)
  expect(fg).not.toEqual([12, 14, 20])
})

test("compositor leaves cells blank where the field is empty", () => {
  const base = RGBA.fromInts(0, 0, 0).buffer
  const target = cells(10, 2, base)
  compositeVortex(target, new Float32Array(20), vortexPalette([0, 0, 0]), base)
  expect(Array.from(target.char).every((char) => char === 32)).toBe(true)
})

test("composited frames keep the rendered layout intact", async () => {
  const base = RGBA.fromInts(10, 12, 18)
  const setup = await testRender(
    () => (
      <box width={60} height={16} backgroundColor={base} flexDirection="column" padding={1}>
        <text>assistant: here is the diff you asked for</text>
        <box border borderColor={RGBA.fromInts(90, 90, 90)} backgroundColor={RGBA.fromInts(30, 30, 36)} height={5}>
          <text>- const a = 1</text>
          <text>+ const a = 2</text>
        </box>
        <text>{"  indented   spaced   words"}</text>
      </box>
    ),
    { width: 60, height: 16 },
  )
  try {
    await setup.renderOnce()
    const plain = setup.captureCharFrame().split("\n")
    const vortex = createVortex()
    const palette = vortexPalette([10, 12, 18])
    setup.renderer.addPostProcessFn((buffer) =>
      buffer.withBuffers((target) =>
        compositeVortex(target, vortex.field(target.width, target.height, "vortex"), palette, base.buffer),
      ),
    )
    await setup.renderOnce()
    const first = setup.captureCharFrame()
    const composited = first.split("\n")
    expect(composited.length).toBe(plain.length)
    const ramp = new Set(VORTEX_RAMP)
    composited.forEach((line, y) => {
      expect(Array.from(line).length).toBe(Array.from(plain[y]!).length)
      Array.from(line).forEach((char, x) => {
        const original = Array.from(plain[y]!)[x]!
        // Every cell is either exactly what the UI drew, or a ramp glyph laid into what was blank.
        if (char !== original) {
          expect(original).toBe(" ")
          expect(ramp.has(char)).toBe(true)
        }
      })
    })
    expect(first).toContain("assistant: here is the diff you asked for")
    expect(first).toContain("- const a = 1")
    expect(first).toContain("indented   spaced   words")
    expect(first).not.toBe(plain.join("\n"))

    for (let i = 0; i < 24; i++) vortex.step(FRAME, true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toBe(first)
  } finally {
    setup.renderer.destroy()
  }
})

test("the toggle cycles vortex, watermark, matrix, then off", () => {
  expect(nextVortexMode("vortex")).toBe("watermark")
  expect(nextVortexMode("watermark")).toBe("matrix")
  expect(nextVortexMode("matrix")).toBe("off")
  expect(nextVortexMode("off")).toBe("vortex")
})

test("the background defaults to the vortex unless animations are off", () => {
  expect(vortexMode({})).toBe("vortex")
  expect(vortexMode({ animations: true })).toBe("vortex")
  expect(vortexMode({ animations: false })).toBe("off")
  expect(vortexMode({ animations: false, background: "watermark" })).toBe("watermark")
  expect(vortexMode({ background: "off" })).toBe("off")
})
