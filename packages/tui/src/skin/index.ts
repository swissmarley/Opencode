import { Schema } from "effect"
import { createSignal } from "solid-js"
import { stringWidth } from "#string-width"
import { SPINNER_FRAMES } from "../component/spinner-frames"
import { setSkinThemes, type ThemeDocumentSource } from "../theme"
import amberCrt from "./assets/amber-crt.json" with { type: "json" }
import bubblegum from "./assets/bubblegum.json" with { type: "json" }
import chromeY2k from "./assets/chrome-y2k.json" with { type: "json" }
import lcdClassic from "./assets/lcd-classic.json" with { type: "json" }
import neonArcade from "./assets/neon-arcade.json" with { type: "json" }
import plainAscii from "./assets/plain-ascii.json" with { type: "json" }

/**
 * A skin restyles the TUI chrome as a whole, the way 2000s media players swapped their
 * entire face: a color theme, the rail glyph drawn beside messages and inputs, the spinner,
 * and the home screen logo (its own art, or a tagline under the stock wordmark). Colors still
 * come from the theme system; a skin either names a theme or embeds one, which is registered
 * under the skin ID.
 *
 * The animated background (the "mood", `background` in config: vortex, watermark, matrix, off) is deliberately not part
 * of a skin. It stays its own setting so a skin never replaces it; it only takes on the skin's colors.
 */
export type Skin = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly author?: string
  readonly theme?: string
  readonly border: SkinBorder
  readonly spinner: SkinSpinner
  readonly logo?: readonly string[]
  readonly tagline?: string
  readonly builtin: boolean
}
export type SkinBorder = { readonly vertical: string; readonly cap: string }
export type SkinSpinner = { readonly frames: readonly string[]; readonly interval: number }

export const DEFAULT_SKIN = "opencode"

/** `cap` closes the rail under the prompt, where the heavy default ends in a half-height stroke. */
export const SKIN_BORDERS = {
  heavy: { vertical: "┃", cap: "╹" },
  light: { vertical: "│", cap: "╵" },
  double: { vertical: "║", cap: "║" },
  block: { vertical: "▌", cap: "▘" },
  dashed: { vertical: "╏", cap: "╹" },
  ascii: { vertical: "|", cap: "'" },
} satisfies Record<string, SkinBorder>

export const SKIN_SPINNERS = {
  dots: { frames: SPINNER_FRAMES, interval: 80 },
  line: { frames: ["|", "/", "-", "\\"], interval: 120 },
  arcs: { frames: ["◜", "◝", "◞", "◟"], interval: 120 },
  equalizer: { frames: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"], interval: 70 },
  blocks: { frames: ["▖", "▘", "▝", "▗"], interval: 100 },
  pulse: { frames: ["·", "•", "●", "•"], interval: 140 },
  stars: { frames: ["+", "x", "*", "x"], interval: 120 },
  cursor: { frames: ["█", " "], interval: 500 },
} satisfies Record<string, SkinSpinner>

const Glyph = Schema.String.check(
  Schema.makeFilter((value) => stringWidth(value) === 1, { expected: "a single-cell glyph" }),
)

const SkinFile = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)])),
  border: Schema.optional(
    Schema.Union([
      Schema.Literals(Object.keys(SKIN_BORDERS) as (keyof typeof SKIN_BORDERS)[]),
      Schema.Struct({ vertical: Glyph, cap: Schema.optional(Glyph) }),
    ]),
  ),
  spinner: Schema.optional(
    Schema.Union([
      Schema.Literals(Object.keys(SKIN_SPINNERS) as (keyof typeof SKIN_SPINNERS)[]),
      Schema.Struct({
        frames: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
        interval: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(16))),
      }),
    ]),
  ),
  logo: Schema.optional(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  tagline: Schema.optional(Schema.String),
})
const decodeSkinFile = Schema.decodeUnknownExit(SkinFile)

const BUILTIN_SOURCES: Record<string, unknown> = {
  "lcd-classic": lcdClassic,
  "chrome-y2k": chromeY2k,
  "neon-arcade": neonArcade,
  "amber-crt": amberCrt,
  bubblegum,
  "plain-ascii": plainAscii,
}

const BUILTIN_SKINS: Record<string, Skin> = {
  [DEFAULT_SKIN]: {
    id: DEFAULT_SKIN,
    name: "OpenCode",
    description: "The stock look",
    theme: "opencode",
    border: SKIN_BORDERS.heavy,
    spinner: SKIN_SPINNERS.dots,
    builtin: true,
  },
  ...Object.fromEntries(
    Object.entries(BUILTIN_SOURCES).map(([id, source]) => [id, { ...requireSkin(id, source), builtin: true }]),
  ),
}

const BUILTIN_THEMES = embeddedThemes(BUILTIN_SOURCES)
setSkinThemes(BUILTIN_THEMES)

const [customSkins, setCustomSkinRecords] = createSignal<Record<string, Skin>>({})
const [activeID, setActiveID] = createSignal(DEFAULT_SKIN)

export function allSkins(): Record<string, Skin> {
  return { ...BUILTIN_SKINS, ...customSkins() }
}

export function currentSkin(): Skin {
  return customSkins()[activeID()] ?? BUILTIN_SKINS[activeID()] ?? BUILTIN_SKINS[DEFAULT_SKIN]
}

export function selectedSkin() {
  return activeID()
}

/** Applies a skin's chrome. Colors are applied separately through the theme context. */
export function setActiveSkin(id: string) {
  setActiveID(id)
}

/** Replaces the discovered skins and returns why each rejected one failed. */
export function setCustomSkins(sources: Record<string, unknown>) {
  const results = Object.entries(sources).map(([id, source]) => ({ id, result: parseSkin(id, source) }))
  const valid = Object.fromEntries(
    results.flatMap((entry) => (entry.result instanceof Error ? [] : [[entry.id, entry.result] as const])),
  )
  setCustomSkinRecords(valid)
  setSkinThemes({
    ...BUILTIN_THEMES,
    ...embeddedThemes(Object.fromEntries(Object.entries(sources).filter(([id]) => valid[id]))),
  })
  return results.flatMap((entry) => (entry.result instanceof Error ? [{ id: entry.id, error: entry.result }] : []))
}

export function parseSkin(id: string, source: unknown): Skin | Error {
  const exit = decodeSkinFile(source)
  if (exit._tag === "Failure") return new Error(`Invalid skin "${id}": ${String(exit.cause)}`)
  const file = exit.value
  const border = typeof file.border === "string" ? SKIN_BORDERS[file.border] : file.border
  const spinner = typeof file.spinner === "string" ? SKIN_SPINNERS[file.spinner] : file.spinner
  return {
    id,
    name: file.name,
    description: file.description,
    author: file.author,
    // An embedded theme is registered under the skin ID so `/themes` can offer it on its own as well.
    theme: typeof file.theme === "object" ? id : file.theme,
    border: border ? { vertical: border.vertical, cap: border.cap ?? border.vertical } : SKIN_BORDERS.heavy,
    spinner: spinner ? { frames: spinner.frames, interval: spinner.interval ?? 80 } : SKIN_SPINNERS.dots,
    logo: file.logo,
    tagline: file.tagline,
    builtin: false,
  }
}

function requireSkin(id: string, source: unknown) {
  const skin = parseSkin(id, source)
  if (skin instanceof Error) throw skin
  return skin
}

function embeddedThemes(sources: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(sources).flatMap(([id, source]) => (isEmbeddedTheme(source) ? [[id, source.theme] as const] : [])),
  )
}

function isEmbeddedTheme(source: unknown): source is { theme: ThemeDocumentSource } {
  if (typeof source !== "object" || source === null || !("theme" in source)) return false
  return typeof source.theme === "object" && source.theme !== null && !Array.isArray(source.theme)
}
