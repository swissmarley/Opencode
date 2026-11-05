import { RGBA } from "@opentui/core"
import type { HueScale } from "@opencode/theme/tui"
import { Schema } from "effect"
import { onCleanup, onMount } from "solid-js"
import { ThemeColor, ThemeColorName, useConfig } from "../config"
import { useThemes } from "../context/theme"
import { setThemeColorPreview, swatch, type ThemeColorRole } from "../theme/customize"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { Locale } from "../util/locale"

export const THEME_COLOR_ROLES = {
  primary: { title: "Primary color", description: "Color of selections, focus, links and list markers" },
  accent: { title: "Accent color", description: "Color of headings, keywords and attention markers" },
} satisfies Record<ThemeColorRole, { title: string; description: string }>

type Choice = "theme" | "custom" | ThemeColorName
const isThemeColor = Schema.is(ThemeColor)

/**
 * Picks the color for one role of the active theme. Moving through the list previews each color across the whole
 * interface; enter saves it and escape restores the saved one. `onClose` returns to the caller, e.g. the appearance
 * menu, instead of closing every dialog.
 */
export function DialogThemeColor(props: { role: ThemeColorRole; onClose?: () => void }) {
  const config = useConfig()
  const dialog = useDialog()
  const toast = useToast()
  const themes = useThemes()
  const role = THEME_COLOR_ROLES[props.role]
  const initial = config.data.theme?.[props.role]
  const custom = initial?.startsWith("#") ? initial : undefined
  // Read once, so the swatches hold still while each color is previewed. A theme's own hue of a name wins over the
  // fallback swatch, matching what choosing it shows.
  const hues: Partial<Record<string, HueScale>> = themes.currentTokens().hue
  const mode = themes.mode()
  const chip = (color: RGBA, title: string) => (
    <>
      <span style={{ fg: color }}>■</span> {title}
    </>
  )
  const options: DialogSelectOption<Choice>[] = [
    { title: "Theme default", value: "theme", description: "the theme's own" },
    ...ThemeColorName.literals.map((name) => ({
      title: Locale.titlecase(name),
      value: name,
      titleView: chip(hues[name]?.[200] ?? RGBA.fromHex(swatch(name, mode)), Locale.titlecase(name)),
    })),
    {
      title: "Custom",
      value: "custom",
      titleView: custom ? chip(RGBA.fromHex(custom), "Custom") : undefined,
      description: custom ?? "any #hex color",
    },
  ]
  const current: Choice = ThemeColorName.literals.find((name) => name === initial) ?? (initial ? "custom" : "theme")
  let confirmed = false
  let ref: DialogSelectRef<Choice>

  // "custom" previews nothing new, so a saved custom color shows while it is selected.
  const preview = (choice: Choice) =>
    setThemeColorPreview(
      choice === "custom" ? undefined : { role: props.role, color: choice === "theme" ? undefined : choice },
    )
  const back = () => (props.onClose ?? dialog.clear)()
  // Keep the preview until the saved setting lands, so the interface never flashes back to the old color.
  const save = (color: ThemeColor | undefined) =>
    void config
      .update((draft) => {
        draft.theme = { ...draft.theme, [props.role]: color }
      })
      .catch(toast.error)
      .finally(() => setThemeColorPreview(undefined))

  // The dimmed backdrop would mute the very colors being previewed.
  onMount(() => dialog.setBackdrop(false))
  onCleanup(() => {
    if (!confirmed) setThemeColorPreview(undefined)
  })

  return (
    <DialogSelect
      title={role.title}
      searchInTitle
      titlePlaceholder="Search colors"
      options={options}
      current={current}
      onCancel={props.onClose}
      onMove={(option) => preview(option.value)}
      onSelect={(option) => {
        if (option.value === "custom")
          return dialog.replace(() => (
            <DialogPrompt
              title={`Custom ${role.title.toLowerCase()}`}
              placeholder="#ff8800"
              value={custom}
              onConfirm={(value) => {
                const color = value.trim().replace(/^#?/, "#")
                if (!isThemeColor(color))
                  return toast.show({ variant: "error", message: "Enter a hex color such as #ff8800" })
                save(color)
                back()
              }}
              onCancel={() => dialog.replace(() => <DialogThemeColor role={props.role} onClose={props.onClose} />)}
            />
          ))
        confirmed = true
        preview(option.value)
        save(option.value === "theme" ? undefined : option.value)
        back()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) return setThemeColorPreview(undefined)
        const first = ref.filtered[0]
        if (first) preview(first.value)
      }}
    />
  )
}
