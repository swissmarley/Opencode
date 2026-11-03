import { type BufferAccess } from "@opentui/core"
import { expect, test } from "bun:test"
import { createMatrix, MATRIX_GLYPHS, MATRIX_STOPS } from "../src/ui/matrix"
import { backgroundPalette, compositeVortex, VORTEX_IDLE_AFTER } from "../src/ui/vortex"

const FRAME = 1000 / 24
const GLYPHS = new Set(Array.from(MATRIX_GLYPHS, (char) => char.codePointAt(0)!))

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

test("the first frame is already full of rain, in range and deterministic", () => {
  const a = createMatrix(7)
  const b = createMatrix(7)
  const field = a.field(80, 24)
  expect(Array.from(field)).toEqual(Array.from(b.field(80, 24)))
  expect(Array.from(a.glyphs)).toEqual(Array.from(b.glyphs))
  expect(field.every((value) => value >= 0 && value <= 1)).toBe(true)
  // Bright heads and dim tails both appear.
  expect(field.some((value) => value > 0.6)).toBe(true)
  expect(field.some((value) => value > 0 && value < 0.3)).toBe(true)
  expect(Array.from(a.glyphs).every((code) => GLYPHS.has(code))).toBe(true)
})

test("the rain falls and its glyphs change as it goes", () => {
  const matrix = createMatrix()
  const before = matrix.field(60, 20).slice()
  const glyphs = matrix.glyphs.slice()
  for (let i = 0; i < 12; i++) matrix.step(FRAME, false)
  expect(Array.from(matrix.field(60, 20))).not.toEqual(Array.from(before))
  expect(Array.from(matrix.glyphs)).not.toEqual(Array.from(glyphs))
})

test("the rain eases to rest after the idle timeout and wakes on input", () => {
  const matrix = createMatrix()
  matrix.field(60, 20)
  let elapsed = 0
  while (elapsed < VORTEX_IDLE_AFTER) {
    expect(matrix.step(FRAME, false)).toBe(true)
    elapsed += FRAME
  }
  let frames = 0
  while (matrix.step(FRAME, false)) frames++
  expect(matrix.activity).toBe(0)
  expect(frames).toBeGreaterThan(24)

  // At rest the frame holds still.
  const still = matrix.field(60, 20).slice()
  matrix.step(FRAME, false)
  expect(Array.from(matrix.field(60, 20))).toEqual(Array.from(still))

  matrix.poke()
  expect(matrix.step(FRAME, false)).toBe(true)
  expect(matrix.activity).toBeGreaterThan(0)
})

test("the pointer parts the rain around it", () => {
  const matrix = createMatrix(3)
  matrix.field(80, 24)
  // Rain in every column, so the parting is measurable wherever the pointer lands.
  for (let x = 0; x < 80; x++) matrix.shock(x, 0)
  for (let i = 0; i < 30; i++) matrix.step(FRAME, false)
  for (let x = 30; x <= 52; x += 2) matrix.move(x, 12)
  expect(matrix.energy).toBeGreaterThan(0.5)
  const field = matrix.field(80, 24)
  const near = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => field[(12 + dy) * 80 + 52 + dx]!))
  expect(Math.max(...near)).toBeLessThan(0.05)
  expect(field.some((value) => value > 0.5)).toBe(true)
})

test("the pointer seeds drops in the columns it crosses", () => {
  const matrix = createMatrix(3)
  matrix.field(80, 24)
  const resting = matrix.drops
  for (let x = 10; x <= 70; x++) matrix.move(x, 8)
  expect(matrix.drops).toBeGreaterThan(resting)
})

test("keystrokes drop fast bright streams, and a streaming reply thickens the rain", () => {
  const matrix = createMatrix()
  matrix.field(80, 24)
  const resting = matrix.drops
  matrix.shock(40, 20)
  expect(matrix.drops).toBe(resting + 2)

  const stream = createMatrix()
  stream.field(80, 24)
  for (let i = 0; i < 48; i++) stream.step(FRAME, true)
  expect(stream.boost).toBe(1)
  expect(stream.drops).toBeGreaterThan(resting)
})

test("the compositor draws matrix glyphs only into empty background", () => {
  const base = new Uint16Array([0, 0, 0, 255])
  const target = cells(40, 10, base)
  const text = "hello"
  Array.from(text).forEach((char, i) => (target.char[5 * 40 + 2 + i] = char.codePointAt(0)!))
  const field = new Float32Array(40 * 10).fill(1)
  const glyphs = new Uint32Array(40 * 10).fill("ｱ".codePointAt(0)!)
  compositeVortex(target, field, backgroundPalette([0, 0, 0], MATRIX_STOPS), base, glyphs)

  expect(String.fromCodePoint(...target.char.subarray(5 * 40 + 2, 5 * 40 + 7))).toBe(text)
  expect(String.fromCodePoint(target.char[0]!)).toBe("ｱ")
  // The halo next to text stays blank.
  expect(target.char[5 * 40 + 8]).toBe(32)
})
