import { afterEach, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  allSkins,
  currentSkin,
  DEFAULT_SKIN,
  parseSkin,
  setActiveSkin,
  setCustomSkins,
  setSkinOverrides,
  SKIN_BORDERS,
  SKIN_SPINNERS,
} from "../src/skin"
import { resolveThemeDocument, themeModes } from "@opencode/theme/tui"
import { allThemes, parseTheme } from "../src/theme"
import { discoverSkins } from "../src/theme/discovery"
import { SplitBorder } from "../src/ui/border"
import { tmpdir } from "./fixture/fixture"

afterEach(() => {
  setCustomSkins({})
  setActiveSkin(DEFAULT_SKIN)
  setSkinOverrides({})
})

test("border and spinner settings replace the active skin's own until cleared", () => {
  setActiveSkin("lcd-classic")
  const skin = currentSkin()
  setSkinOverrides({ border: "double", spinner: "pulse" })
  expect(currentSkin().border).toEqual(SKIN_BORDERS.double)
  expect(currentSkin().spinner).toEqual(SKIN_SPINNERS.pulse)
  expect(SplitBorder.customBorderChars.vertical).toBe("║")
  // The rest of the skin stays.
  expect(currentSkin().tagline).toBe(skin.tagline)

  setSkinOverrides({ spinner: "line" })
  expect(currentSkin().border).toEqual(skin.border)
  expect(currentSkin().spinner).toEqual(SKIN_SPINNERS.line)
  setSkinOverrides({})
  expect(currentSkin()).toBe(skin)
})

test("ships built-in skins whose themes resolve", () => {
  const skins = allSkins()
  expect(Object.keys(skins)).toEqual(
    expect.arrayContaining([DEFAULT_SKIN, "lcd-classic", "chrome-y2k", "neon-arcade", "amber-crt", "bubblegum"]),
  )
  for (const skin of Object.values(skins)) {
    expect(skin.builtin).toBeTrue()
    if (!skin.theme) continue
    const source = allThemes()[skin.theme]
    expect(source).toBeDefined()
    const document = parseTheme(source!, skin.theme)
    for (const mode of themeModes(document)) expect(resolveThemeDocument(document, mode).text.base).toBeDefined()
  }
  // A skin without a theme keeps the user's colors.
  expect(skins["plain-ascii"]?.theme).toBeUndefined()
})

test("resolves border and spinner presets and fills defaults", () => {
  const skin = parseSkin("minimal", { name: "Minimal", border: "double", spinner: "equalizer" })
  if (skin instanceof Error) throw skin
  expect(skin.border).toEqual(SKIN_BORDERS.double)
  expect(skin.spinner).toEqual(SKIN_SPINNERS.equalizer)

  const bare = parseSkin("bare", { name: "Bare" })
  if (bare instanceof Error) throw bare
  expect(bare.border).toEqual(SKIN_BORDERS.heavy)
  expect(bare.spinner).toEqual(SKIN_SPINNERS.dots)
  expect(bare.theme).toBeUndefined()
})

test("built-in skins keep the stock wordmark, except the 7-bit one", () => {
  const skins = allSkins()
  for (const id of ["lcd-classic", "chrome-y2k", "neon-arcade", "amber-crt", "bubblegum"]) {
    expect(skins[id]?.logo).toBeUndefined()
    expect(skins[id]?.tagline).toBeTruthy()
  }
  const ascii = skins["plain-ascii"]?.logo ?? []
  expect(ascii.length).toBeGreaterThan(0)
  expect(ascii.every((line) => /^[\x20-\x7e]*$/.test(line))).toBeTrue()
})

test("accepts custom glyphs and spinner frames", () => {
  const skin = parseSkin("custom", {
    name: "Custom",
    theme: "dracula",
    border: { vertical: "▐" },
    spinner: { frames: ["a", "b"], interval: 200 },
    tagline: "made by me",
  })
  if (skin instanceof Error) throw skin
  expect(skin.theme).toBe("dracula")
  expect(skin.border).toEqual({ vertical: "▐", cap: "▐" })
  expect(skin.spinner).toEqual({ frames: ["a", "b"], interval: 200 })
  expect(skin.tagline).toBe("made by me")
})

test.each([
  ["a missing name", {}],
  ["an unknown border preset", { name: "x", border: "wavy" }],
  ["a multi-cell border glyph", { name: "x", border: { vertical: "||" } }],
  ["empty spinner frames", { name: "x", spinner: { frames: [] } }],
  ["a non-object source", "skin"],
])("rejects %s", (_label, source) => {
  expect(parseSkin("broken", source)).toBeInstanceOf(Error)
})

test("registers custom skins with embedded themes and reports invalid ones", () => {
  const theme = structuredClone(allThemes()["lcd-classic"])
  const failures = setCustomSkins({
    "my-skin": { name: "My Skin", author: "me", border: "light", theme },
    broken: { border: "light" },
  })

  expect(failures.map((failure) => failure.id)).toEqual(["broken"])
  expect(allSkins()["my-skin"]).toMatchObject({ name: "My Skin", theme: "my-skin", builtin: false })
  expect(allSkins().broken).toBeUndefined()
  expect(allThemes()["my-skin"]).toBe(theme)
  // Built-in skin themes survive a custom refresh.
  expect(allThemes()["lcd-classic"]).toBeDefined()

  setCustomSkins({})
  expect(allSkins()["my-skin"]).toBeUndefined()
  expect(allThemes()["my-skin"]).toBeUndefined()
})

test("split borders follow the active skin", () => {
  expect(SplitBorder.customBorderChars.vertical).toBe("┃")
  setActiveSkin("lcd-classic")
  expect(currentSkin().id).toBe("lcd-classic")
  expect(SplitBorder.customBorderChars.vertical).toBe("║")
  setActiveSkin("does-not-exist")
  expect(currentSkin().id).toBe(DEFAULT_SKIN)
})

test("discovers skins from config directories", async () => {
  await using global = await tmpdir()
  await using project = await tmpdir()
  await mkdir(path.join(global.path, "skins"))
  await mkdir(path.join(project.path, "skins"))
  await writeFile(path.join(global.path, "skins", "shared.json"), JSON.stringify({ name: "Global" }))
  await writeFile(path.join(project.path, "skins", "shared.json"), JSON.stringify({ name: "Project" }))
  await writeFile(path.join(project.path, "skins", "notes.txt"), "ignored")

  // Later directories win, so project skins override global ones with the same ID.
  expect(await discoverSkins([global.path, project.path])).toEqual({ shared: { name: "Project" } })
})
