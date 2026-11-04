/** Whisper resamples everything to 16 kHz mono, so recording at that rate keeps uploads small without losing accuracy. */
export const TRANSCRIPTION_SAMPLE_RATE = 16_000

/**
 * Encodes mono float samples as a 16-bit PCM WAV file at 16 kHz. Each output sample averages the input samples it
 * covers, which low-pass filters the signal enough for speech when downsampling from a device rate such as 48 kHz.
 */
export function encodeWav(chunks: readonly Float32Array[], sampleRate: number) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const ratio = sampleRate / TRANSCRIPTION_SAMPLE_RATE
  const frames = Math.floor(total / Math.max(1, ratio))
  const bytes = new Uint8Array(44 + frames * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) =>
    text.split("").forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, "RIFF")
  view.setUint32(4, 36 + frames * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TRANSCRIPTION_SAMPLE_RATE, true)
  view.setUint32(28, TRANSCRIPTION_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, frames * 2, true)

  const samples = flatten(chunks, total)
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.floor(frame * ratio)
    const end = Math.max(start + 1, Math.floor((frame + 1) * ratio))
    const value = average(samples, start, Math.min(end, total))
    view.setInt16(44 + frame * 2, Math.round(Math.max(-1, Math.min(1, value)) * 0x7fff), true)
  }
  return bytes
}

/** Loudness of a chunk from 0 (silence or below -60 dBFS) to 1 (full scale), for the recording level meter. */
export function level(samples: Float32Array) {
  if (samples.length === 0) return 0
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
  if (rms === 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
}

const BARS = "▁▂▃▄▅▆▇█"

/** One bar per level, oldest first. */
export function meter(levels: readonly number[]) {
  return levels.map((value) => BARS[Math.min(BARS.length - 1, Math.floor(value * BARS.length))]).join("")
}

function flatten(chunks: readonly Float32Array[], total: number) {
  if (chunks.length === 1) return chunks[0]
  const samples = new Float32Array(total)
  chunks.reduce((offset, chunk) => {
    samples.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  return samples
}

function average(samples: Float32Array, start: number, end: number) {
  let sum = 0
  for (let index = start; index < end; index++) sum += samples[index]
  return end > start ? sum / (end - start) : 0
}
