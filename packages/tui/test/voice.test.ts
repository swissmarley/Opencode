import { describe, expect, test } from "bun:test"
import { encodeWav, level, meter, TRANSCRIPTION_SAMPLE_RATE } from "../src/voice/wav"

describe("encodeWav", () => {
  test("writes a 16 kHz mono 16-bit PCM header sized to the samples", () => {
    const wav = encodeWav([new Float32Array(1600)], 16_000)
    const view = new DataView(wav.buffer)
    const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4))

    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"])
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(TRANSCRIPTION_SAMPLE_RATE)
    expect(view.getUint32(28, true)).toBe(TRANSCRIPTION_SAMPLE_RATE * 2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(1600 * 2)
  })

  test("downsamples a device rate by averaging across chunk boundaries", () => {
    // 48 kHz to 16 kHz averages each run of three samples, here split across two capture chunks.
    const wav = encodeWav([new Float32Array([0.3, 0.6, 0.9, -1]), new Float32Array([-1, -1])], 48_000)
    const view = new DataView(wav.buffer)

    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBe(Math.round(0.6 * 0x7fff))
    expect(view.getInt16(46, true)).toBe(-0x7fff)
  })

  test("clips out-of-range samples instead of wrapping them", () => {
    const view = new DataView(encodeWav([new Float32Array([2, -3])], 16_000).buffer)
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([0x7fff, -0x7fff])
  })
})

describe("level", () => {
  test("maps loudness from -60 dBFS to full scale onto 0 to 1", () => {
    expect(level(new Float32Array(64))).toBe(0)
    expect(level(new Float32Array(64).fill(0.0001))).toBe(0)
    expect(level(new Float32Array(64).fill(1))).toBe(1)
    expect(level(new Float32Array(64).fill(0.01))).toBeCloseTo(1 / 3)
  })
})

test("meter draws one bar per level", () => {
  expect(meter([0, 0.5, 1])).toBe("▁▅█")
})
