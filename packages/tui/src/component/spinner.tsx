import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "./spinner-renderable"
import { ShimmerText } from "./shimmer-text"
import { currentSkin } from "../skin"

export { SPINNER_FRAMES } from "./spinner-frames"

export function Spinner(props: { children?: JSX.Element; color?: RGBA; shimmer?: RGBA }) {
  const theme = useTheme()
  const config = useConfig().data
  const color = () => props.color ?? theme.text.muted
  const spinner = () => currentSkin().spinner
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (!(config.animations ?? true) || !props.shimmer) return
    const frames = spinner().frames.length
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames), spinner().interval)
    onCleanup(() => clearInterval(timer))
  })
  // A bare spinner beside a long sibling shrinks to a fractional width that rounds to 0, so the
  // glyph paints on top of the row gap. Only a labeled spinner may shrink (to wrap its text).
  return (
    <Show
      when={config.animations ?? true}
      fallback={<text fg={color()}>{props.children ? <>⋯ {props.children}</> : "⋯"}</text>}
    >
      <Show
        when={props.shimmer}
        fallback={
          <box flexDirection="row" gap={1} flexShrink={props.children ? 1 : 0}>
            <box flexShrink={0}>
              <spinner frames={spinner().frames} interval={spinner().interval} color={color()} />
            </box>
            <Show when={props.children}>
              <text fg={color()}>{props.children}</text>
            </Show>
          </box>
        }
      >
        {(shimmer) => (
          <ShimmerText fg={color()} shimmer={shimmer()}>
            {spinner().frames[frame() % spinner().frames.length]} {props.children}
          </ShimmerText>
        )}
      </Show>
    </Show>
  )
}
