/**
 * Tilde, the OpenCode mascot, as pixel art: a small CRT-terminal creature with a face on its screen, stubby limbs and
 * a tilde-curled antenna whose bulb, like the light on its front, glows in the colour of what it is doing.
 *
 * A frame is composed from a `Pose` (eyes, mouth, arms, feet, a held prop and floating decorations) into a grid of
 * palette indices, `SPRITE_WIDTH` by `SPRITE_HEIGHT` pixels. The renderer draws two pixels per terminal cell with
 * half blocks, so the sprite takes `SPRITE_WIDTH` columns and `SPRITE_HEIGHT / 2` rows. Everything here is pure, so a
 * pose always draws the same pixels.
 */

export const SPRITE_WIDTH = 22
export const SPRITE_HEIGHT = 20
// The body's top-left corner on the canvas. The rows above it hold the antenna, with headroom for hops and decor.
const BODY_X = 4
const BODY_Y = 7
// The screen's top-left corner inside the body; it is 8 by 6 pixels.
const SCREEN_X = 2
const SCREEN_Y = 2

export const enum Px {
  Clear,
  Outline,
  Highlight,
  Body,
  Shade,
  Screen,
  Glare,
  Eye,
  Mouth,
  Stem,
  Accent,
  Limb,
  White,
  Gold,
  Pink,
  Cyan,
  Brown,
  Paper,
  Key,
  KeyBase,
  Dream,
  Shadow,
}

const KEYS: Record<string, Px> = {
  o: Px.Outline,
  h: Px.Highlight,
  b: Px.Body,
  s: Px.Shade,
  k: Px.Screen,
  r: Px.Glare,
  A: Px.Accent,
  l: Px.Limb,
  w: Px.White,
  y: Px.Gold,
  p: Px.Pink,
  c: Px.Cyan,
  n: Px.Brown,
  P: Px.Paper,
  x: Px.Key,
  X: Px.KeyBase,
  z: Px.Dream,
}

export type Eyes = "open" | "closed" | "half" | "happy" | "wide" | "x" | "wince"
export type Mouth = "smile" | "flat" | "open" | "grin" | "frown" | "wavy" | "none"
export type Arms =
  | "rest"
  | "low"
  | "wave"
  | "wave2"
  | "cheer"
  | "cheer2"
  | "ponder"
  | "type"
  | "type2"
  | "hold"
  | "lens"
  | "shrug"
export type Feet = "rest" | "walk" | "walk2" | "tap" | "tuck"
export type Prop = "keyboard" | "book" | "book2" | "lens"
export type Decor =
  | { kind: "thought"; stage: number }
  | { kind: "alert" }
  | { kind: "question" }
  | { kind: "sparkle"; x: number; y: number; big: boolean }
  | { kind: "zzz"; phase: number }
  | { kind: "sweat"; y: number }
  | { kind: "bit"; x: number; y: number }
  | { kind: "heart"; y: number }
  | { kind: "confetti"; x: number; y: number; color: Px }

export type Pose = {
  eyes: Eyes
  /** Where the eyes look, -1 to 1 on each axis; they move a pixel. */
  gaze: { x: number; y: number }
  mouth: Mouth
  blush?: boolean
  arms: Arms
  feet: Feet
  /** Antenna lean, -1 to 1; `droop` lowers it. */
  antenna: number
  droop?: boolean
  /** How brightly the antenna bulb and status light glow. */
  glow: "on" | "dim"
  prop?: Prop
  /** The magnifier's vertical sweep, -1 to 1. */
  lens?: number
  decor?: Decor[]
  /** The whole body's offset in pixels; negative y is up, for hops and bobs. */
  x?: number
  y?: number
}

const BODY = [
  ".oooooooooo.",
  "ohhhhhhhhhbo",
  "ohkkkkkkrrso",
  "ohkkkkkkkrso",
  "ohkkkkkkkkso",
  "ohkkkkkkkkso",
  "ohkkkkkkkkso",
  "ohkkkkkkkkso",
  "ohbbbbbbbAso",
  "osssssssssso",
  ".oooooooooo.",
]
const KEYBOARD = ["XxXxXxXxXxXX", "oXXXXXXXXXXo"]
const BOOK = [".PPPPPP.", "onnnnnno", "onyyyyno", "onnnnnno", "oooooooo"]
const BOOK_TURN = ["..PPPPw.", "onnnnnno", "onyyyyno", "onnnnnno", "oooooooo"]
const LENS = [".ooo.", "occwo", "occco", "occco", ".ooo."]
const CLOUD = [".zzz.", "zzzzz", ".zzz."]
const ALERT = ["y", "y", "y", ".", "y"]
const QUESTION = ["yyy", "..y", ".yy", "...", ".y."]
const HEART = [".p.p.", "ppppp", ".ppp.", "..p.."]
const ZED = ["zzzz", "..z.", ".z..", "zzzz"]

// Point lists are flat x, y pairs.
type Points = readonly number[]

// Left-eye pixels around the eye's anchor; the right eye mirrors them.
const EYES: Record<Eyes, Points> = {
  open: [0, 0, 0, 1],
  closed: [0, 1, 1, 1],
  half: [0, 1],
  happy: [-1, 1, 0, 0, 1, 1],
  wide: [-1, 0, 0, 0, -1, 1, 0, 1],
  x: [-1, 0, 1, 0, 0, 1, -1, 2, 1, 2],
  wince: [-1, 0, 0, 1, -1, 2],
}

// Mouth pixels on the screen, below the eyes with a row between.
const MOUTHS: Record<Mouth, Points> = {
  smile: [2, 4, 5, 4, 3, 5, 4, 5],
  flat: [3, 5, 4, 5],
  open: [3, 4, 4, 4, 3, 5, 4, 5],
  grin: [2, 4, 3, 4, 4, 4, 5, 4, 3, 5, 4, 5],
  frown: [3, 4, 4, 4, 2, 5, 5, 5],
  wavy: [2, 5, 3, 4, 4, 5, 5, 4],
  none: [],
}

// Limb pixels relative to the body, which spans x 0..11 and y 0..10.
const ARMS: Record<Arms, Points> = {
  rest: [-1, 6, -1, 7, 12, 6, 12, 7],
  low: [-1, 7, -1, 8, 12, 7, 12, 8],
  wave: [-1, 6, -1, 7, 12, 6, 13, 5, 13, 4],
  wave2: [-1, 6, -1, 7, 12, 6, 13, 5, 14, 4],
  cheer: [-1, 6, -2, 5, -2, 4, 12, 6, 13, 5, 13, 4],
  cheer2: [-1, 6, -2, 5, -3, 4, 12, 6, 13, 5, 14, 4],
  // A hand raised to the side of the head.
  ponder: [-1, 6, -1, 7, 12, 7, 13, 6, 13, 5, 12, 4],
  type: [-1, 7, 0, 8, 1, 9, 12, 7, 11, 8, 10, 8],
  type2: [-1, 7, 0, 8, 1, 8, 12, 7, 11, 8, 10, 9],
  hold: [-1, 7, 0, 8, 1, 8, 12, 7, 11, 8, 10, 8],
  lens: [-1, 6, -1, 7, 12, 7],
  shrug: [-1, 5, -2, 5, 12, 5, 13, 5],
}

const FEET: Record<Feet, Points> = {
  rest: [2, 11, 3, 11, 8, 11, 9, 11],
  walk: [1, 11, 2, 11, 9, 11, 10, 11],
  walk2: [3, 11, 4, 11, 7, 11, 8, 11],
  tap: [2, 11, 3, 11, 8, 10, 9, 10],
  tuck: [3, 11, 8, 11],
}

const BULB = [0, 0, 1, 0, 0, 1, 1, 1]
const SPARK = [-1, 0, 1, 0, 0, -1, 0, 1]

/** Draws `pose` into a fresh grid of palette indices, row-major, `SPRITE_WIDTH` by `SPRITE_HEIGHT`. */
export function drawPose(pose: Pose) {
  const grid = new Uint8Array(SPRITE_WIDTH * SPRITE_HEIGHT)
  const put = (x: number, y: number, px: Px) => {
    if (x < 0 || y < 0 || x >= SPRITE_WIDTH || y >= SPRITE_HEIGHT) return
    grid[y * SPRITE_WIDTH + x] = px
  }
  const stamp = (rows: readonly string[], x: number, y: number) =>
    rows.forEach((row, dy) =>
      Array.from(row).forEach((key, dx) => {
        const px = KEYS[key]
        if (px !== undefined) put(x + dx, y + dy, px)
      }),
    )
  const points = (list: Points, x: number, y: number, px: Px, mirror = 1) => {
    for (let index = 0; index < list.length; index += 2) put(x + list[index]! * mirror, y + list[index + 1]!, px)
  }
  const ox = BODY_X + (pose.x ?? 0)
  const oy = BODY_Y + (pose.y ?? 0)

  // The shadow stays on the ground and narrows as the body rises.
  const lift = Math.min(4, Math.max(0, -(pose.y ?? 0)))
  for (let x = BODY_X + 1 + lift; x <= BODY_X + 10 - lift; x++) put(x, BODY_Y + 12, Px.Shadow)

  // Antenna: a stem with a kink, like a tilde, and a glowing bulb that leans with the pose.
  const lean = clampUnit(pose.antenna)
  const drop = pose.droop ? 1 : 0
  put(ox + 5, oy - 1, Px.Stem)
  put(ox + 5 + lean, oy - 2 + drop, Px.Stem)
  points(BULB, ox + 5 + lean + drop, oy - 4 + drop, Px.Accent)
  if (pose.glow === "on" && !pose.droop) put(ox + 5 + lean, oy - 4, Px.White)

  // Confetti is in canvas coordinates and behind the body, so it falls past rather than over the face.
  pose.decor?.forEach((decor) => {
    if (decor.kind === "confetti") put(decor.x, decor.y, decor.color)
  })

  stamp(BODY, ox, oy)
  points(FEET[pose.feet], ox, oy, Px.Limb)

  // The face. Gaze moves the eyes a pixel; the mouth follows sideways only.
  const sx = ox + SCREEN_X
  const sy = oy + SCREEN_Y
  const gx = clampUnit(pose.gaze.x)
  const gy = clampUnit(pose.gaze.y)
  points(EYES[pose.eyes], sx + 1 + gx, sy + 1 + gy, Px.Eye)
  points(EYES[pose.eyes], sx + 6 + gx, sy + 1 + gy, Px.Eye, -1)
  if (pose.blush) {
    put(sx, sy + 3, Px.Pink)
    put(sx + 7, sy + 3, Px.Pink)
  }
  points(MOUTHS[pose.mouth], sx + gx, sy, Px.Mouth)

  // Props sit in front of the body, then the limbs that hold them.
  if (pose.prop === "keyboard") stamp(KEYBOARD, ox, oy + 9)
  if (pose.prop === "book") stamp(BOOK, ox + 2, oy + 6)
  if (pose.prop === "book2") stamp(BOOK_TURN, ox + 2, oy + 6)
  if (pose.prop === "lens") {
    const sweep = clampUnit(pose.lens ?? 0)
    stamp(LENS, ox + 13, oy + 2 + sweep)
    put(ox + 13, oy + 6 + sweep, Px.Brown)
    if (sweep < 0) put(ox + 13, oy + 6, Px.Brown)
  }
  points(ARMS[pose.arms], ox, oy, Px.Limb)
  // The key under whichever hand is down lights up.
  if (pose.prop === "keyboard") put(ox + (pose.arms === "type" ? 2 : 9), oy + 9, Px.White)

  pose.decor?.forEach((decor) => {
    if (decor.kind === "thought") {
      if (decor.stage >= 1) put(ox - 1, oy - 1, Px.Dream)
      if (decor.stage >= 2) points(BULB, ox - 3, oy - 4, Px.Dream)
      if (decor.stage >= 3) stamp(CLOUD, ox - 5, oy - 7)
    }
    if (decor.kind === "alert") stamp(ALERT, ox + 14, oy - 7)
    if (decor.kind === "question") stamp(QUESTION, ox + 13, oy - 7)
    if (decor.kind === "sparkle") {
      put(ox + decor.x, oy + decor.y, decor.big ? Px.White : Px.Gold)
      if (decor.big) points(SPARK, ox + decor.x, oy + decor.y, Px.Gold)
    }
    if (decor.kind === "zzz") {
      const rise = decor.phase % 8
      stamp(ZED, ox + 12 + (rise >> 2), oy - 3 - rise)
      if (rise < 4) put(ox + 11, oy - 1 - rise, Px.Dream)
    }
    if (decor.kind === "sweat") {
      put(ox + 12, oy + decor.y, Px.Cyan)
      put(ox + 12, oy + decor.y + 1, Px.Cyan)
      put(ox + 13, oy + decor.y + 1, Px.White)
    }
    if (decor.kind === "bit") put(ox + decor.x, oy + decor.y, Px.Eye)
    if (decor.kind === "heart") stamp(HEART, ox + 12, oy + decor.y)
  })
  return grid
}

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, Math.round(value)))
}

export type Rgba = readonly [number, number, number, number]

/** The status colour of the antenna bulb and the light on the front, for each thing the mascot can be doing. */
export const ACCENTS = {
  idle: [126, 226, 184],
  thinking: [182, 156, 255],
  talking: [143, 211, 255],
  coding: [94, 224, 122],
  reading: [108, 182, 255],
  searching: [255, 200, 87],
  waiting: [255, 159, 67],
  success: [94, 224, 122],
  error: [255, 92, 92],
  completed: [255, 212, 94],
  sleeping: [109, 106, 138],
} as const satisfies Record<string, readonly [number, number, number]>

export type Accent = keyof typeof ACCENTS

/** The character's colours, with the bulb, light and eyes set for `accent`; indexed by `Px`. */
export function spritePalette(accent: Accent, glow: Pose["glow"]): Rgba[] {
  const [r, g, b] = ACCENTS[accent]
  const scale = glow === "dim" ? 0.55 : 1
  const eye: Rgba = accent === "error" ? [255, 112, 112, 1] : [140, 255, 214, 1]
  const colors: Record<Px, Rgba> = {
    [Px.Clear]: [0, 0, 0, 0],
    [Px.Outline]: [35, 33, 46, 1],
    [Px.Highlight]: [255, 253, 246, 1],
    [Px.Body]: [236, 230, 214, 1],
    [Px.Shade]: [196, 187, 166, 1],
    [Px.Screen]: [23, 34, 41, 1],
    [Px.Glare]: [52, 72, 84, 1],
    [Px.Eye]: eye,
    [Px.Mouth]: [Math.round(eye[0] * 0.78), Math.round(eye[1] * 0.78), Math.round(eye[2] * 0.78), 1],
    [Px.Stem]: [91, 93, 112, 1],
    [Px.Accent]: [Math.round(r * scale), Math.round(g * scale), Math.round(b * scale), 1],
    [Px.Limb]: [112, 108, 138, 1],
    [Px.White]: [255, 255, 255, 1],
    [Px.Gold]: [255, 212, 94, 1],
    [Px.Pink]: [255, 143, 177, 1],
    [Px.Cyan]: [127, 216, 255, 1],
    [Px.Brown]: [160, 103, 63, 1],
    [Px.Paper]: [247, 241, 223, 1],
    [Px.Key]: [141, 147, 168, 1],
    [Px.KeyBase]: [74, 77, 96, 1],
    [Px.Dream]: [217, 212, 245, 1],
    [Px.Shadow]: [0, 0, 0, 0.28],
  }
  return Array.from({ length: Px.Shadow + 1 }, (_, index) => colors[index as Px])
}

export const CONFETTI = [Px.Gold, Px.Pink, Px.Cyan, Px.Accent, Px.White] as const
