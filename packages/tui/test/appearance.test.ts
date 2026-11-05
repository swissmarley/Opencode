import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { resolveThemeDocument, themeModes, type HueScale } from "@opencode/theme/tui"
import { ThemeColorName } from "../src/config"
import { detectTerminal } from "../src/component/dialog-terminal-font"
import { allThemes, getOpenCodeTheme, parseTheme } from "../src/theme"
import { customizeTheme, setThemeColorPreview, swatch, themeColors } from "../src/theme/customize"

afterEach(() => setThemeColorPreview(undefined))

const opencode = () => getOpenCodeTheme()
const hex = (color: RGBA) =>
  `#${color
    .toInts()
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`
// The resolved hue map holds every named hue at runtime; only its type is narrowed to the semantic ones.
const hues = (theme: ReturnType<typeof resolveThemeDocument>): Partial<Record<string, HueScale>> => theme.hue

test("leaves the theme untouched without overrides", () => {
  const document = opencode()
  expect(customizeTheme(document, "dark", {})).toBe(document)
})

test("a named primary color reuses the theme's own hue of that name", () => {
  const theme = resolveThemeDocument(customizeTheme(opencode(), "dark", { primary: "blue" }), "dark")
  expect(hex(theme.hue.interactive[200])).toBe(hex(hues(theme).blue![200]))
  // Tokens the theme derives from the primary hue follow it.
  expect(hex(theme.text.formfield.selected)).toBe(hex(hues(theme).blue![200]))
  expect(hex(theme.markdown.link)).toBe(hex(hues(theme).blue![200]))
})

test("a name the theme has no hue for falls back to a readable swatch for the mode", () => {
  for (const mode of ["dark", "light"] as const) {
    const theme = resolveThemeDocument(customizeTheme(opencode(), mode, { accent: "pink" }), mode)
    expect(hex(theme.hue.accent[200])).toBe(swatch("pink", mode))
  }
})

test("a custom hex accent drives accent tokens", () => {
  const theme = resolveThemeDocument(customizeTheme(opencode(), "dark", { accent: "#ff8800" }), "dark")
  expect(hex(theme.hue.accent[200])).toBe("#ff8800")
  expect(hex(theme.markdown.heading)).toBe("#ff8800")
  // Only the chosen role changes.
  const stock = resolveThemeDocument(opencode(), "dark")
  expect(hex(theme.hue.interactive[200])).toBe(hex(stock.hue.interactive[200]))
})

test("a transparent background shows the terminal's while dialogs stay opaque", () => {
  for (const mode of ["dark", "light"] as const) {
    const theme = resolveThemeDocument(customizeTheme(opencode(), mode, { transparent: true }), mode)
    expect(theme.background.base.a).toBe(0)
    expect(theme.surface("dialog").background.base.a).toBe(1)
  }
})

test("a theme without its own dialog background gets an opaque one when transparent", () => {
  const document = opencode()
  const { "@dialog": _, ...base } = document.base
  const bare = { ...document, base, dark: { hue: document.dark.hue } }
  const theme = resolveThemeDocument(customizeTheme(bare, "dark", { transparent: true }), "dark")
  expect(theme.background.base.a).toBe(0)
  expect(theme.surface("dialog").background.base.a).toBe(1)
})

test("every built-in theme resolves with every named color in each of its modes", () => {
  for (const [name, source] of Object.entries(allThemes())) {
    const document = parseTheme(source, name)
    for (const mode of themeModes(document))
      for (const color of ThemeColorName.literals) {
        const theme = resolveThemeDocument(
          customizeTheme(document, mode, { primary: color, accent: color, transparent: true }),
          mode,
        )
        expect(theme.hue.interactive[200].a).toBe(1)
      }
  }
})

test("a picker preview replaces only its own role until cleared", () => {
  const config = { primary: "blue", accent: "#123456", transparent: true } as const
  setThemeColorPreview({ role: "primary", color: "red" })
  expect(themeColors(config)).toEqual({ primary: "red", accent: "#123456", transparent: true })
  // Previewing the theme default drops the override for that role.
  setThemeColorPreview({ role: "accent", color: undefined })
  expect(themeColors(config)).toEqual({ primary: "blue", accent: undefined, transparent: true })
  setThemeColorPreview(undefined)
  expect(themeColors(config)).toEqual(config)
})

test("detects the terminal from its own variables before TERM_PROGRAM", () => {
  expect(detectTerminal({ TERM_PROGRAM: "ghostty" })?.name).toBe("Ghostty")
  expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" })?.name).toBe("iTerm2")
  expect(detectTerminal({ WT_SESSION: "1" })?.name).toBe("Windows Terminal")
  // Inside tmux, TERM_PROGRAM names tmux, but kitty's own variable still identifies it.
  expect(detectTerminal({ TERM_PROGRAM: "tmux", KITTY_WINDOW_ID: "1" })?.name).toBe("kitty")
  expect(detectTerminal({ TERM_PROGRAM: "tmux" })).toBeUndefined()
  expect(detectTerminal({})).toBeUndefined()
})
