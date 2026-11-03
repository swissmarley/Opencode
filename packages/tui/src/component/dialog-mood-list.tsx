import { onCleanup, onMount } from "solid-js"
import { useConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { VORTEX_MODES, type VortexMode } from "../ui/vortex"
import { setMoodPreview, vortexMode } from "./vortex-background"

export const MOODS: Record<VortexMode, { title: string; description: string }> = {
  vortex: { title: "Vortex", description: "Swirling ASCII flow around the mouse" },
  watermark: { title: "Watermark", description: "The vortex with OPENCODE carved out" },
  matrix: { title: "Matrix", description: "Green rain that parts around the mouse" },
  off: { title: "Off", description: "No animated background" },
}

/**
 * Previews each mood behind the dialog as the selection moves, like `/skins`, and only saves the `background`
 * setting on select. Closing without a choice drops the preview and shows the configured mood again.
 * `onClose` returns to the caller, e.g. Settings, instead of closing every dialog.
 */
export function DialogMoodList(props: { onClose?: () => void }) {
  const config = useConfig()
  const dialog = useDialog()
  const toast = useToast()
  const options = VORTEX_MODES.map((mood) => ({
    title: MOODS[mood].title,
    value: mood,
    description: MOODS[mood].description,
  }))
  let confirmed = false
  let ref: DialogSelectRef<VortexMode>

  // The dimmed backdrop would cover the very background being previewed.
  onMount(() => dialog.setBackdrop(false))
  onCleanup(() => {
    if (!confirmed) setMoodPreview(undefined)
  })

  return (
    <DialogSelect
      title="Moods"
      searchInTitle
      titlePlaceholder="Search moods"
      options={options}
      current={vortexMode(config.data)}
      onCancel={props.onClose}
      onMove={(option) => setMoodPreview(option.value)}
      onSelect={(option) => {
        confirmed = true
        setMoodPreview(option.value)
        // Keep the preview until the saved setting lands, so the background never flashes back to the old mood.
        void config
          .update((draft) => {
            draft.background = option.value
          })
          .catch(toast.error)
          .finally(() => setMoodPreview(undefined))
        if (props.onClose) return props.onClose()
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) return setMoodPreview(undefined)
        const first = ref.filtered[0]
        if (first) setMoodPreview(first.value)
      }}
    />
  )
}
