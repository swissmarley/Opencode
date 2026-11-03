import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { MASCOT_STATES } from "../../../mascot/motion"
import "../../../mascot/renderable"
import type { MascotSpriteRenderable } from "../../../mascot/renderable"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const LOOKS = [undefined, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }] as const
const LOOK_NAMES = ["free", "left", "right", "up", "down"]
const WALKS = [undefined, -1, 1] as const

function MascotStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [index, setIndex] = createSignal(0)
  const [gallery, setGallery] = createSignal(false)
  const [animate, setAnimate] = createSignal(true)
  const [look, setLook] = createSignal(0)
  const [walk, setWalk] = createSignal(0)
  const [hovered, setHovered] = createSignal(false)
  // Every mounted sprite, so a poke reaches the whole gallery; remounts leave destroyed ones behind to skip.
  const sprites: MascotSpriteRenderable[] = []
  const live = () => sprites.filter((sprite) => !sprite.isDestroyed)
  const state = () => MASCOT_STATES[index()]!
  const step = (by: number) => setIndex((current) => (current + by + MASCOT_STATES.length) % MASCOT_STATES.length)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "left,h", title: "Previous state", group: "Storybook", run: () => step(-1) },
      { bind: "right,l", title: "Next state", group: "Storybook", run: () => step(1) },
      { bind: "p", title: "Poke", group: "Storybook", run: () => live().forEach((sprite) => sprite.poke()) },
      { bind: "e", title: "Cycle gaze", group: "Storybook", run: () => setLook((value) => (value + 1) % LOOKS.length) },
      { bind: "w", title: "Cycle walk", group: "Storybook", run: () => setWalk((value) => (value + 1) % WALKS.length) },
      { bind: "o", title: "Toggle hover", group: "Storybook", run: () => setHovered((value) => !value) },
      { bind: "a", title: "Toggle animation", group: "Storybook", run: () => setAnimate((value) => !value) },
      { bind: "g", title: "Toggle gallery", group: "Storybook", run: () => setGallery((value) => !value) },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () => {
          setIndex(0)
          setGallery(false)
          setAnimate(true)
          setLook(0)
          setWalk(0)
          setHovered(false)
        },
      },
    ],
  }))

  const sprite = (name: (typeof MASCOT_STATES)[number]) => (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      <mascot_sprite
        ref={(value: MascotSpriteRenderable) => {
          sprites.splice(0, sprites.length, ...live(), value)
        }}
        state={name}
        animate={animate()}
        look={LOOKS[look()]}
        walk={WALKS[walk()]}
        hovered={hovered()}
        onMouseUp={function (this: MascotSpriteRenderable) {
          this.poke()
        }}
      />
      <text fg={name === state() ? theme.text.base : theme.text.muted}>{name}</text>
    </box>
  )

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
        <Show
          when={gallery()}
          fallback={
            <box flexGrow={1} alignItems="center" justifyContent="center">
              {/* Keyed so a new state mounts a fresh sprite, which starts its entrance from the first tick. */}
              <Show when={state()} keyed>
                {(name) => sprite(name)}
              </Show>
            </box>
          }
        >
          <box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
            <For each={MASCOT_STATES}>{(name) => sprite(name)}</For>
          </box>
        </Show>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / mascot"
        details={[gallery() ? "all states" : state(), `gaze ${LOOK_NAMES[look()]}`, animate() ? "animated" : "still"]}
        message="The production sprite renderable; the bubble and approvals are covered by test/mascot-app.test.tsx"
        controls={[
          { shortcut: "←→", label: "state" },
          { shortcut: "p", label: "poke" },
          { shortcut: "e", label: "gaze" },
          { shortcut: "w", label: "walk" },
          { shortcut: "o", label: "hover" },
          { shortcut: "a", label: "animate" },
          { shortcut: "g", label: "gallery" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mascotStory: Story = {
  id: "mascot",
  title: "Mascot",
  render: (context) => <MascotStory context={context} />,
}
