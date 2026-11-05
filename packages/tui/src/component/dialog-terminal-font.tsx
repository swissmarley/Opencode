import { For } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"

type Environment = Readonly<Record<string, string | undefined>>
type Terminal = {
  name: string
  /** Where the font family and its size are set. */
  font: string
  /** Shortcuts that make text bigger and smaller; undefined when the terminal has none of its own. */
  zoom?: (mac: boolean) => string
}

const standardZoom = (mac: boolean) => (mac ? "Cmd+= and Cmd+-" : "Ctrl+= and Ctrl+-")

// Checked in order. Variables a terminal sets for itself come first, because TERM_PROGRAM names tmux inside tmux.
const TERMINALS: readonly (Terminal & { detect: (env: Environment) => boolean })[] = [
  {
    name: "kitty",
    detect: (env) => env.KITTY_WINDOW_ID !== undefined || env.TERM === "xterm-kitty",
    font: "font_family and font_size in ~/.config/kitty/kitty.conf",
    zoom: (mac) => (mac ? "Cmd+= and Cmd+-" : "Ctrl+Shift+= and Ctrl+Shift+-"),
  },
  {
    name: "Alacritty",
    detect: (env) => env.ALACRITTY_WINDOW_ID !== undefined || env.ALACRITTY_SOCKET !== undefined,
    font: "font.normal.family and font.size in ~/.config/alacritty/alacritty.toml",
    zoom: standardZoom,
  },
  {
    name: "Windows Terminal",
    detect: (env) => env.WT_SESSION !== undefined,
    font: "Settings > Profiles > Defaults > Appearance > Font face and Font size",
    zoom: () => "Ctrl+= and Ctrl+-",
  },
  {
    name: "Konsole",
    detect: (env) => env.KONSOLE_VERSION !== undefined,
    font: "Settings > Edit Current Profile > Appearance > Font",
    zoom: () => "Ctrl++ and Ctrl+-",
  },
  {
    name: "GNOME Terminal",
    detect: (env) => env.GNOME_TERMINAL_SCREEN !== undefined || env.GNOME_TERMINAL_SERVICE !== undefined,
    font: "Preferences > your profile > Text > Custom font",
    zoom: () => "Ctrl++ and Ctrl+-",
  },
  {
    name: "Ghostty",
    detect: (env) => env.TERM_PROGRAM === "ghostty",
    font: "font-family and font-size in ~/.config/ghostty/config",
    zoom: standardZoom,
  },
  {
    name: "WezTerm",
    detect: (env) => env.TERM_PROGRAM === "WezTerm",
    font: "config.font and config.font_size in ~/.wezterm.lua",
    zoom: standardZoom,
  },
  {
    name: "iTerm2",
    detect: (env) => env.TERM_PROGRAM === "iTerm.app",
    font: "Settings > Profiles > Text > Font",
    zoom: () => "Cmd+= and Cmd+-",
  },
  {
    name: "Terminal",
    detect: (env) => env.TERM_PROGRAM === "Apple_Terminal",
    font: "Settings > Profiles > Text > Font",
    zoom: () => "Cmd+= and Cmd+-",
  },
  {
    name: "Warp",
    detect: (env) => env.TERM_PROGRAM === "WarpTerminal",
    font: "Settings > Appearance > Text",
    zoom: standardZoom,
  },
  {
    name: "VS Code",
    detect: (env) => env.TERM_PROGRAM === "vscode",
    font: "terminal.integrated.fontFamily and terminal.integrated.fontSize in your settings",
  },
]

/** The terminal OpenCode is running in, when it can tell from the environment. */
export function detectTerminal(env: Environment = process.env): Terminal | undefined {
  return TERMINALS.find((terminal) => terminal.detect(env))
}

/**
 * Explains that the terminal, not OpenCode, owns the font and text size, and says where to change them in the
 * terminal it detects. `onClose` returns to the caller, e.g. the appearance menu, instead of closing every dialog.
 */
export function DialogTerminalFont(props: { onClose?: () => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const terminal = detectTerminal()
  const mac = process.platform === "darwin"
  const close = () => (props.onClose ?? dialog.clear)()
  const zoom = terminal ? terminal.zoom?.(mac) : `${standardZoom(mac)} in most terminals`
  const rows = [
    ...(zoom ? [{ label: "Text size", value: zoom }] : []),
    { label: "Font", value: terminal?.font ?? "in your terminal's settings or config file" },
  ]

  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 1,
    commands: [
      { bind: "return", title: "Close", group: "Dialog", run: close },
      ...(props.onClose ? [{ bind: "escape", title: "Back", group: "Dialog", run: close }] : []),
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="Font and text size" onClose={close} />}
      footer={{ actions: { primary: [{ title: "ok", key: "enter", onTrigger: close }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={close}
          >
            <text fg={theme.text.action.primary.focused}>ok</text>
          </box>
        </box>
      }
    >
      <box gap={1}>
        <text fg={theme.text.muted} wrapMode="word">
          {`Your terminal draws every character, so it picks the font and the text size. OpenCode can't change them, but ${terminal?.name ?? "your terminal"} can:`}
        </text>
        <box>
          <For each={rows}>
            {(row) => (
              <box flexDirection="row" gap={2}>
                <text fg={theme.text.base} width={9} flexShrink={0}>
                  {row.label}
                </text>
                <text fg={theme.text.muted} wrapMode="word">
                  {row.value}
                </text>
              </box>
            )}
          </For>
        </box>
        <text fg={theme.text.muted} wrapMode="word">
          If borders or spinners look broken, pick a font with box-drawing characters or set Border to ascii.
        </text>
      </box>
    </DialogLayout>
  )
}
