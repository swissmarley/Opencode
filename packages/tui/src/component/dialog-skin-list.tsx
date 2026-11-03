import { onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useThemes } from "../context/theme"
import { allSkins, DEFAULT_SKIN, selectedSkin, setActiveSkin } from "../skin"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"

/**
 * Previews each skin as the selection moves, the way a skin browser repaints the whole player,
 * and restores the original skin and theme when the dialog closes without a choice.
 * `onClose` returns to the caller, e.g. Settings, instead of closing every dialog.
 */
export function DialogSkinList(props: { onClose?: () => void }) {
  const themes = useThemes()
  const config = useConfig()
  const dialog = useDialog()
  const skins = allSkins()
  const options = Object.values(skins)
    .sort((a, b) => {
      if (a.id === DEFAULT_SKIN) return -1
      if (b.id === DEFAULT_SKIN) return 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
    .map((skin) => ({
      title: skin.name,
      value: skin.id,
      description: skin.description,
      category: skin.builtin ? "Built-in" : "Installed",
      footer: skin.builtin ? undefined : (skin.author ?? skin.id),
    }))
  const initial = { skin: selectedSkin(), theme: themes.selected }
  let confirmed = false
  let ref: DialogSelectRef<string>

  // Skins without a theme keep whichever theme was active when the dialog opened.
  const preview = (id: string) => {
    setActiveSkin(id)
    themes.set(skins[id]?.theme ?? initial.theme)
  }
  const restore = () => {
    setActiveSkin(initial.skin)
    themes.set(initial.theme)
  }

  onCleanup(() => {
    if (!confirmed) restore()
  })

  return (
    <DialogSelect
      title="Skins"
      searchInTitle
      titlePlaceholder="Search skins"
      options={options}
      current={initial.skin}
      onCancel={props.onClose}
      onMove={(option) => preview(option.value)}
      onSelect={(option) => {
        preview(option.value)
        confirmed = true
        void config
          .update((draft) => {
            draft.skin = option.value
          })
          .catch(() => {})
        if (props.onClose) return props.onClose()
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) return restore()
        const first = ref.filtered[0]
        if (first) preview(first.value)
      }}
    />
  )
}
