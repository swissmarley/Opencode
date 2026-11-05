import { RGBA } from "@opentui/core"
import { hueScale, type Mode, type ModeDefinition, type ThemeDocument } from "@opencode/theme/tui"
import { createSignal } from "solid-js"
import type { ThemeColor, ThemeColorName } from "../config"

/** The `theme.primary`, `theme.accent` and `theme.transparent` settings, layered over whichever theme is active. */
export type ThemeColors = {
  readonly primary?: ThemeColor
  readonly accent?: ThemeColor
  readonly transparent?: boolean
}
export type ThemeColorRole = "primary" | "accent"

// Used when the active theme has no hue of that name. Dark modes anchor on a light tone, light modes on a deep one,
// so the color stays readable on the theme's background either way.
const SWATCHES = {
  dark: {
    red: "#f87171",
    orange: "#fb923c",
    yellow: "#facc15",
    green: "#4ade80",
    cyan: "#22d3ee",
    blue: "#60a5fa",
    purple: "#c084fc",
    pink: "#f472b6",
  },
  light: {
    red: "#dc2626",
    orange: "#ea580c",
    yellow: "#ca8a04",
    green: "#16a34a",
    cyan: "#0891b2",
    blue: "#2563eb",
    purple: "#9333ea",
    pink: "#db2777",
  },
} satisfies Record<Mode, Record<ThemeColorName, string>>

const [preview, setPreview] = createSignal<{ role: ThemeColorRole; color: ThemeColor | undefined }>()

/** Shows `color` (undefined for the theme's own) for `role` until cleared, without saving it. */
export function setThemeColorPreview(next: { role: ThemeColorRole; color: ThemeColor | undefined } | undefined) {
  setPreview(next)
}

/** The configured color overrides with any picker preview applied. Reactive. */
export function themeColors(config: ThemeColors | undefined): ThemeColors {
  const current = preview()
  return {
    primary: current?.role === "primary" ? current.color : config?.primary,
    accent: current?.role === "accent" ? current.color : config?.accent,
    transparent: config?.transparent,
  }
}

export function swatch(name: ThemeColorName, mode: Mode) {
  return SWATCHES[mode][name]
}

/**
 * Replaces the `interactive` (primary) and `accent` hues of the mode being shown, so every token the theme derives from
 * them follows. A named color reuses the theme's own hue of that name when it has one, keeping the theme's palette.
 */
export function customizeTheme(document: ThemeDocument, mode: Mode, colors: ThemeColors): ThemeDocument {
  const definition = document[mode]
  if (!definition || (!colors.primary && !colors.accent && !colors.transparent)) return document
  const hues = definition.hue
  const customized = {
    ...definition,
    hue: {
      ...hues,
      ...(colors.primary ? { interactive: hue(colors.primary, hues, mode) } : {}),
      ...(colors.accent ? { accent: hue(colors.accent, hues, mode) } : {}),
    },
    ...(colors.transparent ? transparent(document.base, definition) : {}),
  }
  return mode === "light" ? { ...document, light: customized } : { ...document, dark: customized }
}

function hue(color: ThemeColor, hues: ModeDefinition["hue"], mode: Mode) {
  if (hues[color]) return `$hue.${color}`
  const swatches: Partial<Record<string, string>> = SWATCHES[mode]
  return hueScale(RGBA.fromHex(swatches[color] ?? color), mode)
}

function transparent(base: ThemeDocument["base"], definition: ModeDefinition) {
  const dialog = definition["@dialog"]
  return {
    background: { ...definition.background, base: "transparent" },
    // Dialogs fall back to the base background, and a see-through dialog would show the transcript under its text.
    ...((dialog?.background?.base ?? base["@dialog"]?.background?.base)
      ? {}
      : { "@dialog": { ...dialog, background: { ...dialog?.background, base: "$background.raised.base" } } }),
  }
}
