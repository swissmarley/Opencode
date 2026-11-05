import { createMemo, createSignal } from "solid-js"
import { BorderStyle, SpinnerStyle, ThemeColorName, useConfig, useNewDesigns } from "../config"
import { useThemes } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { DialogSelect, DialogSelectChoice } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { DialogThemeList } from "./dialog-theme-list"
import { DialogSkinList } from "./dialog-skin-list"
import { DialogMoodList, MOODS } from "./dialog-mood-list"
import { VORTEX_MODES } from "../ui/vortex"
import { vortexMode } from "./vortex-background"
import { mascotEnabled } from "../mascot/mascot"
import { allSkins, DEFAULT_SKIN, SKIN_BORDERS, SKIN_SPINNERS, type SkinBorder, type SkinSpinner } from "../skin"
import { DialogThemeColor, THEME_COLOR_ROLES } from "./dialog-theme-color"
import { DialogTerminalFont, detectTerminal } from "./dialog-terminal-font"

const GROUPS = ["Colors", "Interface", "Motion", "Text"] as const

type Setting = {
  title: string
  category: string
  /** Section in the `/appearance` menu; settings without one are only in Settings. */
  group?: (typeof GROUPS)[number]
  path: string[]
  /** Shown below the list while the setting is selected, under the "new-designs" experiment. */
  description: string
  default: unknown
  values?: readonly unknown[]
  labels?: readonly string[]
  step?: number
  min?: number
  max?: number
  format?: (value: unknown) => string
  keywords?: readonly string[]
  /**
   * Enter opens this picker instead of cycling in the appearance menu, under the "new-designs" experiment, and for a
   * setting with nothing to cycle. ←/→ still cycle. `back` reopens the menu it came from.
   */
  open?: (dialog: DialogContext, back: () => void) => void
}

const borders: Partial<Record<string, SkinBorder>> = SKIN_BORDERS
const spinners: Partial<Record<string, SkinSpinner>> = SKIN_SPINNERS

export const settings: Setting[] = [
  {
    title: "Theme",
    category: "Appearance",
    group: "Colors",
    path: ["theme", "name"],
    description: "Color theme used across the interface",
    default: "opencode",
    keywords: ["color scheme", "colors"],
    open: (dialog, back) => dialog.replace(() => <DialogThemeList onClose={back} />),
  },
  {
    title: "Skin",
    category: "Appearance",
    group: "Interface",
    path: ["skin"],
    description: "Bundled look: theme, border rail, spinner and logo",
    default: DEFAULT_SKIN,
    keywords: ["look", "style", "retro", "chrome"],
    format: (value) => allSkins()[String(value)]?.name ?? String(value),
    open: (dialog, back) => dialog.replace(() => <DialogSkinList onClose={back} />),
  },
  {
    title: "Mood",
    category: "Appearance",
    group: "Motion",
    path: ["background"],
    description: "Animated background behind the interface",
    default: "vortex",
    values: VORTEX_MODES,
    keywords: ["background", "vortex", "matrix", "watermark", "ripple", "warp", "embers", "aurora", "animation"],
    format: (value) => Object.entries(MOODS).find(([mood]) => mood === value)?.[1].title ?? String(value),
    open: (dialog, back) => dialog.replace(() => <DialogMoodList onClose={back} />),
  },
  {
    title: "Mascot",
    category: "Appearance",
    group: "Motion",
    path: ["mascot"],
    description: "Tilde, the companion that acts out what the agent is doing and asks for approvals",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["tilde", "pet", "companion", "buddy", "character"],
  },
  {
    title: "Color mode",
    category: "Appearance",
    group: "Colors",
    path: ["theme", "mode"],
    description: "Dark or light variant, or follow the system",
    default: "system",
    values: ["system", "dark", "light"],
    keywords: ["dark mode", "light mode", "system theme"],
  },
  {
    title: "Animations",
    category: "Appearance",
    group: "Motion",
    path: ["animations"],
    description: "Whether spinners and transitions animate",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["motion", "effects"],
  },
  ...(["primary", "accent"] as const).map((role) => ({
    title: THEME_COLOR_ROLES[role].title,
    category: "Appearance",
    group: "Colors" as const,
    path: ["theme", role],
    description: THEME_COLOR_ROLES[role].description,
    default: undefined,
    values: [undefined, ...ThemeColorName.literals],
    format: (value: unknown) => (value === undefined ? "theme" : String(value)),
    keywords: ["color", "colour", "highlight", "tint", "hex", role === "primary" ? "selection" : "headings"],
    open: (dialog: DialogContext, back: () => void) =>
      dialog.replace(() => <DialogThemeColor role={role} onClose={back} />),
  })),
  {
    title: "Background",
    category: "Appearance",
    group: "Colors",
    path: ["theme", "transparent"],
    description: "The theme's background, or your terminal's own, such as a translucent or image background",
    default: false,
    values: [false, true],
    labels: ["theme", "terminal"],
    keywords: ["transparent", "transparency", "opacity", "translucent", "background color"],
  },
  {
    title: "Border",
    category: "Appearance",
    group: "Interface",
    path: ["border"],
    description: "Rail drawn beside messages and the prompt, in place of the skin's",
    default: undefined,
    values: [undefined, ...BorderStyle.literals],
    format: (value) => (value === undefined ? "from skin" : `${value} ${borders[String(value)]?.vertical}`),
    keywords: ["rail", "line", "frame", "ascii"],
  },
  {
    title: "Spinner",
    category: "Appearance",
    group: "Interface",
    path: ["spinner"],
    description: "Animation shown while the agent works, in place of the skin's",
    default: undefined,
    values: [undefined, ...SpinnerStyle.literals],
    format: (value) => (value === undefined ? "from skin" : `${value} ${spinners[String(value)]?.frames[0]}`),
    keywords: ["loading", "progress", "indicator"],
  },
  {
    title: "Cursor",
    category: "Appearance",
    group: "Interface",
    path: ["cursor", "style"],
    description: "Shape of the text cursor in inputs",
    default: "block",
    values: ["block", "underline", "line", "default"],
    labels: ["block", "underline", "line", "terminal default"],
    keywords: ["caret", "beam", "bar"],
  },
  {
    title: "Cursor blink",
    category: "Appearance",
    group: "Interface",
    path: ["cursor", "blinking"],
    description: "Whether the text cursor blinks",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["caret", "blinking"],
  },
  {
    title: "Font and size",
    category: "Appearance",
    group: "Text",
    // Not a setting: the terminal owns both, so this row only explains where to change them.
    path: ["font"],
    description: "Set by your terminal; shows where to change them",
    default: undefined,
    format: () => detectTerminal()?.name ?? "terminal",
    keywords: ["font", "font size", "text size", "zoom", "typeface", "bigger", "smaller", "scale"],
    open: (dialog, back) => dialog.replace(() => <DialogTerminalFont onClose={back} />),
  },
  {
    title: "Sidebar",
    category: "Session",
    path: ["session", "sidebar"],
    description: "Whether the sidebar shows when there is room",
    default: "auto",
    values: ["hide", "auto"],
    keywords: ["side panel"],
  },
  {
    title: "Scrollbar",
    category: "Session",
    path: ["session", "scrollbar"],
    description: "Whether a scrollbar is shown next to the chat",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["scroll bar"],
  },
  {
    title: "Thinking",
    category: "Session",
    path: ["session", "thinking"],
    description: "Whether model thinking is shown in the chat",
    default: "hide",
    values: ["hide", "show"],
    keywords: ["reasoning", "chain of thought"],
  },
  {
    title: "Markdown",
    category: "Session",
    path: ["session", "markdown"],
    description: "Whether chat markdown is rendered or shown as source",
    default: "rendered",
    values: ["source", "rendered"],
    keywords: ["syntax", "concealment", "rendering"],
  },
  {
    title: "Tool grouping",
    category: "Session",
    path: ["session", "grouping"],
    description: "Whether consecutive reads and searches are grouped",
    default: "auto",
    values: ["none", "auto"],
    keywords: ["transcript", "messages", "reads", "searches"],
  },
  {
    title: "Verbosity",
    category: "Session",
    path: ["session", "verbosity"],
    description: "How much tool activity is shown in the chat",
    default: "medium",
    values: ["low", "medium", "high"],
    keywords: ["detail", "activity", "summary", "transcript"],
  },
  {
    title: "Transcript images",
    category: "Session",
    path: ["session", "image_preview"],
    description: "Whether images are shown in the chat",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["attachments", "images", "tool output"],
  },
  {
    title: "TPS",
    category: "Session",
    path: ["session", "tps"],
    description: "Whether tokens per second are shown for responses",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["tokens per second", "throughput"],
  },
  {
    title: "New session location",
    category: "Session",
    path: ["session", "new_location"],
    description: "Directory new sessions start in",
    default: "launch",
    values: ["launch", "inherit"],
    labels: ["launch directory", "active session"],
    keywords: ["directory", "cwd", "inherit"],
  },
  {
    title: "Permissions",
    category: "Session",
    path: ["session", "permissions"],
    description: "Whether permission requests ask you or auto accept",
    default: "prompt",
    values: ["prompt", "autoaccept"],
    labels: ["prompt", "auto accept"],
    keywords: ["approve", "accept", "permission requests"],
  },
  {
    title: "Mode",
    category: "Tabs",
    path: ["tabs", "mode"],
    description: "Whether sessions open in tabs",
    default: "auto",
    values: ["off", "on", "auto"],
  },
  {
    title: "Scope",
    category: "Tabs",
    path: ["tabs", "scope"],
    description: "Whether tabs are per directory or shared everywhere",
    default: "cwd",
    values: ["cwd", "global"],
    labels: ["current directory", "global"],
  },
  {
    title: "Layout",
    category: "Tabs",
    path: ["tabs", "layout"],
    description: "Whether tabs run along the top or down the side",
    default: "horizontal",
    values: ["horizontal", "vertical"],
    keywords: ["sidebar", "orientation", "left"],
  },
  {
    title: "Indicators",
    category: "Tabs",
    path: ["tabs", "indicators"],
    description: "Whether tabs show status icons or always numbers",
    default: "status",
    values: ["status", "numbers"],
    labels: ["status icons", "always show numbers"],
    keywords: ["tab numbers", "number mode", "status icons"],
  },
  {
    title: "Layout",
    category: "Diffs",
    path: ["diffs", "view"],
    description: "Whether diffs are side by side or in one column",
    default: "auto",
    values: ["auto", "split", "unified"],
    keywords: ["diff layout", "split diff", "unified diff"],
  },
  {
    title: "Wrapping",
    category: "Diffs",
    path: ["diffs", "wrap"],
    description: "Whether long lines in diffs wrap",
    default: "word",
    values: ["none", "word"],
    keywords: ["diff wrap", "word wrap", "line wrap"],
  },
  {
    title: "File tree",
    category: "Diffs",
    path: ["diffs", "tree"],
    description: "Whether a file tree is shown next to diffs",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["diff files"],
  },
  {
    title: "Single patch",
    category: "Diffs",
    path: ["diffs", "single"],
    description: "Whether diffs show one file at a time",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["one file", "selected file"],
  },
  {
    title: "Scroll speed",
    category: "Input",
    path: ["scroll", "speed"],
    description: "How far each scroll step moves",
    default: 3,
    step: 0.25,
    min: 0.25,
    max: 10,
    format: (value) => Number(value).toFixed(2),
    keywords: ["scrolling"],
  },
  {
    title: "Acceleration",
    category: "Input",
    path: ["scroll", "acceleration"],
    description: "Whether scrolling speeds up the faster you scroll",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["scroll acceleration"],
  },
  {
    title: "Mouse",
    category: "Input",
    path: ["mouse"],
    description: "Whether the interface responds to the mouse",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["mouse capture"],
  },
  {
    title: "Editor context",
    category: "Input",
    path: ["prompt", "editor"],
    description: "Whether your editor's selection is added to prompts",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["file context", "prompt context", "editor selection"],
  },
  {
    title: "Large pastes",
    category: "Input",
    path: ["prompt", "paste"],
    description: "Whether large pastes are summarized or shown in full",
    default: "compact",
    values: ["compact", "full"],
    keywords: ["paste summary", "clipboard", "pasted content"],
  },
  {
    title: "Voice input",
    category: "Input",
    path: ["voice", "button"],
    description: "Whether the microphone button for dictating prompts is shown beside the input",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["microphone", "mic", "dictation", "speech", "whisper", "push to talk", "transcription"],
  },
  {
    title: "Image previews",
    category: "Input",
    path: ["prompt", "image_preview"],
    description: "Whether attached images are previewed in the prompt",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["attachments", "clipboard", "images", "prompt"],
  },
  {
    title: "Leader timeout",
    category: "Input",
    path: ["leader", "timeout"],
    description: "How long the leader key waits for the next key",
    default: 2000,
    step: 250,
    min: 250,
    max: 10000,
    format: (value) => `${value} ms`,
    keywords: ["leader key", "shortcut timeout"],
  },
  {
    title: "Notifications",
    category: "Alerts",
    path: ["attention", "notifications"],
    description: "Whether to notify when a session needs attention",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["system notifications", "desktop notifications", "alerts"],
  },
  {
    title: "Sounds",
    category: "Alerts",
    path: ["attention", "sound"],
    description: "Whether a sound plays when a session needs attention",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["audio", "sound effects", "alerts"],
  },
  {
    title: "Volume",
    category: "Alerts",
    path: ["attention", "volume"],
    description: "Volume of alert sounds",
    default: 0.4,
    step: 0.1,
    min: 0,
    max: 1,
    format: (value) => `${Math.round(Number(value) * 100)}%`,
    keywords: ["sound volume", "audio volume"],
  },
  {
    title: "Release highlights",
    category: "Alerts",
    path: ["highlights"],
    description: "Whether release highlights are shown after an update",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["what's new", "changelog", "release notes"],
  },
  {
    title: "Window title",
    category: "Terminal",
    path: ["terminal", "title"],
    description: "Whether the window title shows the current session",
    default: true,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["terminal title", "tab title"],
  },
  {
    title: "Copy behavior",
    category: "Terminal",
    path: ["terminal", "copy"],
    description: "Whether selecting text copies it",
    default: process.platform === "win32" ? "manual" : "select",
    values: ["manual", "select"],
    keywords: ["selection", "clipboard"],
  },
  {
    title: "Developer tools",
    category: "Debug",
    path: ["debug", "devtools"],
    description: "Whether the developer tools bar is shown",
    default: false,
    values: [false, true],
    labels: ["off", "on"],
    keywords: ["debug bar", "developer tools"],
  },
]

export function settingID(setting: Setting) {
  return setting.path.join(".")
}

/** Settings, or with `appearance` only the look-and-feel rows, grouped into sections, for `/appearance`. */
export function DialogConfig(props: { current?: string; appearance?: boolean }) {
  const config = useConfig()
  const newDesigns = useNewDesigns()
  const dialog = useDialog()
  const toast = useToast()
  const themes = useThemes()
  const list = props.appearance
    ? settings
        .filter((setting) => setting.group)
        .toSorted((a, b) => GROUPS.indexOf(a.group!) - GROUPS.indexOf(b.group!))
    : settings
  const current = Math.max(
    0,
    list.findIndex((setting) => settingID(setting) === props.current),
  )
  const [selected, setSelected] = createSignal(current)
  const [saving, setSaving] = createSignal(false)

  const value = (setting: Setting) => {
    const current = setting.path.reduce<unknown>((result, key) => {
      if (!result || typeof result !== "object") return undefined
      return (result as Record<string, unknown>)[key]
    }, config.data)
    if (setting.path.join(".") === "theme.name") return current ?? themes.selected
    if (setting.path.join(".") === "background") return vortexMode(config.data)
    if (setting.path.join(".") === "mascot") return mascotEnabled(config.data)
    return current ?? setting.default
  }
  const values = (setting: Setting) => {
    const id = setting.path.join(".")
    if (id === "theme.name")
      return Object.keys(themes.all()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    if (id === "skin") return Object.keys(allSkins())
    return setting.values
  }
  const display = (setting: Setting) => {
    const current = value(setting)
    if (setting.format) return setting.format(current)
    const index = setting.values?.indexOf(current)
    return index === undefined || index < 0 ? String(current) : (setting.labels?.[index] ?? String(current))
  }
  const cyclable = (setting: Setting) => values(setting) !== undefined || setting.step !== undefined
  const options = createMemo(() =>
    list.map((setting, index) => ({
      title: setting.title,
      category: props.appearance ? setting.group : setting.category,
      searchText: setting.keywords?.join(" "),
      footer: newDesigns() ? (
        <DialogSelectChoice value={display(setting)} active={selected() === index} open={setting.open !== undefined} />
      ) : (
        display(setting)
      ),
      footerOverhang: newDesigns() ? 2 : undefined,
      detail: newDesigns() ? setting.description : undefined,
      value: index,
    })),
  )

  async function change(direction: number, index = selected()) {
    const setting = list[index]
    if (saving() || !cyclable(setting)) return
    const current = value(setting)
    const choices = values(setting)
    const next = choices
      ? choices[(choices.indexOf(current) + direction + choices.length) % choices.length]
      : Math.min(setting.max!, Math.max(setting.min!, Number(current) + direction * setting.step!))
    if (next === current) return
    setSaving(true)
    await config
      .update((draft) => {
        const parent = setting.path.slice(0, -1).reduce<Record<string, unknown>>((result, key) => {
          if (!result[key] || typeof result[key] !== "object") result[key] = {}
          return result[key] as Record<string, unknown>
        }, draft)
        parent[setting.path.at(-1)!] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title={props.appearance ? "Appearance" : "Settings"}
      searchInTitle
      titlePlaceholder={props.appearance ? "Search appearance" : "Search settings"}
      options={options()}
      // Under new designs the opening setting is focused without the current-item marker; changing a value keeps the
      // selection where it is.
      current={newDesigns() ? undefined : current}
      focusTarget={newDesigns() ? current : undefined}
      preserveSelection={newDesigns()}
      filterThreshold={0.7}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => {
        const setting = list[option.value]
        if (setting.open && (props.appearance || newDesigns() || !cyclable(setting)))
          return setting.open(dialog, () =>
            dialog.replace(() => <DialogConfig current={settingID(setting)} appearance={props.appearance} />),
          )
        void change(1, option.value)
      }}
      footerHints={newDesigns() ? [] : [{ title: "change", label: "←/→" }]}
      bindings={[
        {
          bind: "left",
          title: "Previous value",
          group: "Settings",
          run: () => void change(-1),
        },
        {
          bind: "right",
          title: "Next value",
          group: "Settings",
          run: () => void change(1),
        },
      ]}
    />
  )
}
