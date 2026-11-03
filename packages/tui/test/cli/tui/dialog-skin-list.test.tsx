/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { afterEach, expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogSkinList } from "../../../src/component/dialog-skin-list"
import { ConfigProvider, type Interface } from "../../../src/config"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider, useThemes } from "../../../src/context/theme"
import { DEFAULT_SKIN, selectedSkin, setActiveSkin } from "../../../src/skin"
import { SplitBorder } from "../../../src/ui/border"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

afterEach(() => setActiveSkin(DEFAULT_SKIN))

test("previews a skin while filtering and persists it on select", async () => {
  const fixture = await renderSkins()

  try {
    await fixture.open()
    fixture.app.mockInput.typeText("neon")
    await fixture.app.waitForFrame((frame) => frame.includes("▌rail"))
    expect(fixture.themes.selected).toBe("neon-arcade")

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => !frame.includes("Search skins"))
    expect(fixture.saved()).toMatchObject({ skin: "neon-arcade", theme: { name: "neon-arcade" } })
    expect(selectedSkin()).toBe("neon-arcade")
    expect(fixture.app.captureCharFrame()).toContain("▌rail")
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("restores the original skin and theme when cancelled", async () => {
  const fixture = await renderSkins()

  try {
    await fixture.open()
    fixture.app.mockInput.typeText("lcd")
    await fixture.app.waitForFrame((frame) => frame.includes("║rail"))
    expect(fixture.themes.selected).toBe("lcd-classic")

    fixture.app.mockInput.pressEscape()
    await fixture.app.waitForFrame((frame) => frame.includes("┃rail") && !frame.includes("Search skins"))
    expect(selectedSkin()).toBe(DEFAULT_SKIN)
    expect(fixture.themes.selected).toBe("opencode")
    expect(fixture.saved().skin).toBeUndefined()
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderSkins() {
  let current: Record<string, any> = {}
  const service: Interface = {
    get: async () => current,
    update: async (update) => {
      const draft = structuredClone(current)
      update(draft)
      current = draft
      return draft
    },
  }
  let dialog!: ReturnType<typeof useDialog>
  let themes!: ReturnType<typeof useThemes>

  function Probe() {
    dialog = useDialog()
    themes = useThemes()
    onMount(() => dialog.replace(() => <DialogSkinList />))
    return (
      <box border={["left"]} customBorderChars={SplitBorder.customBorderChars}>
        <text>rail</text>
      </box>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()} service={service}>
          <Keymap.Provider>
            <ToastProvider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
                <DialogProvider>
                  <Probe />
                </DialogProvider>
              </ThemeProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()

  return {
    app,
    get themes() {
      return themes
    },
    saved: () => current,
    // DialogSelect focuses its filter on a timer, so keys typed before that are dropped.
    open: () =>
      app.waitForFrame(
        (frame) => frame.includes("LCD Classic") && app.renderer.currentFocusedRenderable instanceof InputRenderable,
      ),
  }
}
