import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { go, logo } from "../logo"
import { currentSkin } from "../skin"
import { stringWidth } from "#string-width"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.base, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  // Skin logos are plain text: the markup characters of the stock logo have no meaning in them.
  const skinLogo = () => {
    const lines = currentSkin().logo
    if (!lines) return
    if (dimensions().width < Math.max(...lines.map((line) => stringWidth(line)))) return
    return lines
  }

  // A tagline sits centred under the logo, and drops out rather than wrap on a narrow terminal.
  const tagline = () => {
    const text = currentSkin().tagline
    if (!text || dimensions().height < 12 || dimensions().width < stringWidth(text)) return
    return text
  }

  return (
    <box alignItems="center">
      <box>
        {dimensions().height < 12 ? null : skinLogo() ? (
          <For each={skinLogo()}>
            {(line) => (
              <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
                {line}
              </text>
            )}
          </For>
        ) : dimensions().width < 22 ? (
          <For each={go.right.slice(1)}>
            {(line) => <box flexDirection="row">{renderLine(line, theme.text.base, true)}</box>}
          </For>
        ) : dimensions().width < 44 ? (
          <>
            <For each={logo.left.slice(1)}>
              {(line) => <box flexDirection="row">{renderLine(line, theme.text.muted, false)}</box>}
            </For>
            <For each={logo.right}>
              {(line) => <box flexDirection="row">{renderLine(line, theme.text.base, true)}</box>}
            </For>
          </>
        ) : (
          <For each={logo.left}>
            {(line, index) => (
              <box flexDirection="row" gap={1}>
                <box flexDirection="row">{renderLine(line, theme.text.muted, false)}</box>
                <box flexDirection="row">{renderLine(logo.right[index()], theme.text.base, true)}</box>
              </box>
            )}
          </For>
        )}
      </box>
      {tagline() ? (
        <text fg={theme.text.muted} selectable={false}>
          {tagline()}
        </text>
      ) : null}
    </box>
  )
}
