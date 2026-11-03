import { Renderable, RGBA, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import { MASCOT_FPS, motion, type MascotState } from "./motion"
import { drawPose, Px, SPRITE_HEIGHT, SPRITE_WIDTH, spritePalette, type Accent, type Pose } from "./sprite"

const UPPER = "▀"
const LOWER = "▄"
const CLEAR = RGBA.fromValues(0, 0, 0, 0)
// Poke reactions run for this many ticks.
const POKE_TICKS = 10

type Options = RenderableOptions<MascotSpriteRenderable> & {
  state?: MascotState
  animate?: boolean
  look?: { x: number; y: number }
  walk?: -1 | 1
  hovered?: boolean
}

/**
 * The mascot's pixel-art body, two pixels per cell with half blocks. Clear pixels leave the cell beneath alone and
 * the ground shadow blends into it, so the sprite sits on whatever is behind it.
 *
 * Not live: like the spinner, it ticks on the renderer's shared animation clock while it is drawn, and it only asks
 * for a frame when a tick changes its pixels, which most idle ticks do not.
 */
export class MascotSpriteRenderable extends Renderable {
  private _state: MascotState
  private _animate: boolean
  private _look: Options["look"]
  private _walk: Options["walk"]
  private _hovered: boolean
  private clock = 0
  private age = 0
  private poked: number | undefined
  private grid = new Uint8Array(SPRITE_WIDTH * SPRITE_HEIGHT)
  private colors: RGBA[] = []
  private paletteKey = ""

  constructor(ctx: RenderContext, options: Options = {}) {
    super(ctx, { ...options, width: SPRITE_WIDTH, height: SPRITE_HEIGHT / 2 })
    this._state = options.state ?? "idle"
    this._animate = options.animate ?? true
    this._look = options.look
    this._walk = options.walk
    this._hovered = options.hovered ?? false
    this.restart()
    this.refresh()
  }

  set state(value: MascotState) {
    if (value === this._state) return
    this._state = value
    this.age = 0
    this.restart()
    this.refresh()
  }

  set animate(value: boolean) {
    if (value === this._animate) return
    this._animate = value
    this.restart()
  }

  set look(value: Options["look"]) {
    if (value?.x === this._look?.x && value?.y === this._look?.y) return
    this._look = value
    this.refresh()
  }

  set walk(value: Options["walk"]) {
    if (value === this._walk) return
    this._walk = value
    this.refresh()
  }

  set hovered(value: boolean) {
    if (value === this._hovered) return
    this._hovered = value
    this.refresh()
  }

  /** Plays a startled-then-delighted reaction with a heart. */
  poke() {
    this.poked = 0
    this.restart()
    this.refresh()
  }

  private restart() {
    // Sleep breathes slowly; without animations only state changes and pokes redraw.
    this.animationFps = this._animate ? (this._state === "sleeping" ? MASCOT_FPS / 2 : MASCOT_FPS) : undefined
  }

  protected override onAnimationTick(_deltaTime: number, ticks: number) {
    this.clock += ticks
    this.age += ticks
    if (this.poked !== undefined) this.poked = this.poked + ticks >= POKE_TICKS ? undefined : this.poked + ticks
    this.refresh()
  }

  /** Recomposes the current pose and asks for a frame only if its pixels changed. */
  private refresh() {
    const frame = motion({
      state: this._state,
      age: this.age,
      clock: this.clock,
      look: this._look,
      walk: this._walk,
      poked: this.poked,
      hovered: this._hovered,
    })
    const grid = drawPose(frame.pose)
    const palette = this.palette(frame.accent, frame.pose.glow)
    if (!palette && grid.every((px, index) => px === this.grid[index])) return
    this.grid = grid
    this.requestRender()
  }

  /** Swaps in the colours for `accent` and returns whether they changed. */
  private palette(accent: Accent, glow: Pose["glow"]) {
    const key = `${accent}:${glow}`
    if (key === this.paletteKey) return false
    this.paletteKey = key
    this.colors = spritePalette(accent, glow).map(([r, g, b, a]) => RGBA.fromInts(r, g, b, Math.round(a * 255)))
    return true
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    for (let row = 0; row < SPRITE_HEIGHT / 2; row++) {
      for (let column = 0; column < SPRITE_WIDTH; column++) {
        const top = this.grid[row * 2 * SPRITE_WIDTH + column]!
        const bottom = this.grid[(row * 2 + 1) * SPRITE_WIDTH + column]!
        if (top === Px.Clear && bottom === Px.Clear) continue
        const x = this.screenX + column
        const y = this.screenY + row
        const upper = top === Px.Clear ? CLEAR : this.colors[top]!
        const lower = bottom === Px.Clear ? CLEAR : this.colors[bottom]!
        // The solid half is always the glyph's foreground; a clear or translucent half blends into what is behind.
        if (upper.a === 1 && lower.a === 1) buffer.setCell(x, y, UPPER, upper, lower)
        else if (upper.a >= lower.a) buffer.setCellWithAlphaBlending(x, y, UPPER, upper, lower)
        else buffer.setCellWithAlphaBlending(x, y, LOWER, lower, upper)
      }
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    mascot_sprite: typeof MascotSpriteRenderable
  }
}

extend({ mascot_sprite: MascotSpriteRenderable })
