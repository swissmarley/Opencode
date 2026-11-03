/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { afterEach, expect, test } from "bun:test"
import { Logo } from "../../src/component/logo"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { DEFAULT_SKIN, setActiveSkin } from "../../src/skin"
import { emptyThemeSource } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

afterEach(() => setActiveSkin(DEFAULT_SKIN))

async function renderLogo(skin: string, width: number) {
  setActiveSkin(skin)
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Logo />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width, height: 16 },
  )
  await app.renderOnce()
  const frame = app.captureCharFrame()
  app.renderer.destroy()
  return frame
}

test("a skin tagline sits under the stock wordmark", async () => {
  const frame = await renderLogo("neon-arcade", 80)
  expect(frame).toContain("█▀▀█ █▀▀█ █▀▀█ █▀▀▄")
  expect(frame).toContain("- INSERT COIN TO CODE -")
  expect(frame.indexOf("INSERT COIN")).toBeGreaterThan(frame.indexOf("█▀▀█"))
})

test("the tagline drops out when the terminal is narrower than it", async () => {
  const frame = await renderLogo("lcd-classic", 36)
  expect(frame).toContain("█▀▀█")
  expect(frame).not.toContain("|<")
})

test("the 7-bit skin draws its ASCII wordmark instead of block glyphs", async () => {
  const frame = await renderLogo("plain-ascii", 80)
  expect(frame).toContain("| (_) |  _/| _|| .` | (__| (_) | |) | _|")
  expect(frame).toContain("--- 7-bit clean ---")
  expect(frame).not.toContain("█")
})
