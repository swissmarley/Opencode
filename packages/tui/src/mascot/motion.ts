import { CONFETTI, type Accent, type Decor, type Pose } from "./sprite"

/** Everything the mascot can be doing; each has its own animation and status colour. */
export const MASCOT_STATES = [
  "idle",
  "thinking",
  "talking",
  "coding",
  "reading",
  "searching",
  "waiting",
  "success",
  "error",
  "completed",
  "sleeping",
] as const
export type MascotState = (typeof MASCOT_STATES)[number]

/** Animation ticks per second. Poses only change on ticks, and most ticks repeat the last pose. */
export const MASCOT_FPS = 8

export type MotionInput = {
  state: MascotState
  /** Ticks since the mascot entered `state`, for one-off entrances such as a hop. */
  age: number
  /** Ticks since the mascot appeared, for steady rhythms such as blinking. */
  clock: number
  /** Where the eyes should look, from -1 to 1 on each axis, when something has caught them. */
  look?: { x: number; y: number }
  /** Walking direction while wandering. */
  walk?: -1 | 1
  /** Ticks since the mascot was poked, while the reaction plays. */
  poked?: number
  hovered?: boolean
}

/** A small deterministic hash, so idle glances and confetti look random but replay identically. */
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** The pose for one tick: the state's animation, with a poke, hover or walk layered on top. */
export function motion(input: MotionInput): { pose: Pose; accent: Accent } {
  const pose = statePose(input)
  if (input.walk && (input.state === "idle" || input.state === "sleeping")) {
    const step = input.clock % 4
    pose.feet = step < 2 ? "walk" : "walk2"
    pose.y = step % 2 === 0 ? 0 : -1
    pose.gaze = { x: input.walk, y: 0 }
    pose.eyes = "open"
    pose.arms = step < 2 ? "rest" : "low"
    pose.antenna = -input.walk
  }
  if (input.hovered && input.poked === undefined && input.state === "idle") {
    pose.eyes = "happy"
    pose.mouth = "smile"
    pose.blush = true
    pose.gaze = { x: 0, y: 0 }
  }
  if (input.poked !== undefined && input.poked < 10) {
    const hop = [0, -2, -3, -2, -1, 0, 0, 0, 0, 0][input.poked] ?? 0
    pose.eyes = input.poked < 3 ? "wide" : "happy"
    pose.mouth = input.poked < 3 ? "open" : "grin"
    pose.blush = true
    pose.y = hop
    pose.feet = hop < 0 ? "tuck" : "rest"
    pose.arms = input.poked < 5 ? "cheer" : "rest"
    pose.decor = [...(pose.decor ?? []), { kind: "heart", y: -4 - Math.min(2, input.poked >> 1) }]
  }
  return { pose, accent: input.state }
}

function statePose(input: MotionInput): Pose {
  const { age, clock } = input
  const blink = blinking(clock)
  const look = input.look ?? glance(clock)
  const sway = [0, 0, 1, 1, 0, 0, -1, -1][(clock >> 2) % 8]!
  const base: Pose = {
    eyes: blink ? "closed" : "open",
    gaze: look,
    mouth: "smile",
    arms: (clock >> 4) % 2 === 0 ? "rest" : "low",
    feet: "rest",
    antenna: sway,
    glow: "on",
  }

  switch (input.state) {
    case "idle":
      return base

    case "sleeping": {
      const breath = (clock >> 3) % 2
      return {
        ...base,
        eyes: "closed",
        gaze: { x: 0, y: 1 },
        mouth: breath ? "flat" : "none",
        arms: "low",
        antenna: 1,
        droop: true,
        glow: "dim",
        y: breath,
        decor: [{ kind: "zzz", phase: clock >> 1 }],
      }
    }

    case "thinking": {
      // Eyes drift up while pondering, with a thought bubble that grows and pops.
      const stage = (clock >> 2) % 5
      return {
        ...base,
        eyes: blink ? "closed" : "open",
        gaze: input.look ?? { x: (clock >> 5) % 2 === 0 ? 1 : -1, y: -1 },
        mouth: "flat",
        arms: "ponder",
        antenna: sway,
        decor: [{ kind: "thought", stage: Math.min(3, stage) }],
        glow: stage % 2 === 0 ? "on" : "dim",
      }
    }

    case "talking": {
      const mouths = ["open", "flat", "smile", "open", "grin", "flat"] as const
      return {
        ...base,
        mouth: mouths[Math.floor(noise(clock) * mouths.length)]!,
        gaze: input.look ?? { x: 0, y: 0 },
        arms: (clock >> 3) % 3 === 0 ? (clock % 4 < 2 ? "wave" : "wave2") : "rest",
        y: clock % 6 === 0 ? -1 : 0,
      }
    }

    case "coding": {
      // Hands drum the keyboard and little bits float up from it.
      const left = clock % 2 === 0
      return {
        ...base,
        eyes: blink ? "closed" : "open",
        gaze: input.look ?? { x: (clock >> 3) % 2 === 0 ? -1 : 1, y: 1 },
        mouth: "flat",
        arms: left ? "type" : "type2",
        prop: "keyboard",
        y: clock % 4 === 0 ? -1 : 0,
        decor: [0, 1, 2].map((index): Decor => {
          const rise = (clock + index * 3) % 9
          return { kind: "bit", x: index === 1 ? 12 : index === 0 ? -1 : -2, y: 7 - rise }
        }),
      }
    }

    case "reading": {
      // Eyes scan along a line, then jump back to the next; a page turns now and then.
      const scan = [-1, -1, 0, 0, 1, 1, 1][(clock >> 1) % 7]!
      return {
        ...base,
        eyes: blink ? "closed" : "open",
        gaze: { x: scan, y: 0 },
        mouth: "none",
        arms: "hold",
        prop: (clock >> 1) % 24 < 2 ? "book2" : "book",
        antenna: scan,
      }
    }

    case "searching": {
      // A magnifier sweeps up and down and the eyes follow it; now and then something catches the eye.
      const sweep = [-1, -1, 0, 1, 1, 0][(clock >> 1) % 6]!
      const found = (clock >> 1) % 18 === 0
      return {
        ...base,
        eyes: found ? "wide" : blink ? "closed" : "open",
        gaze: { x: 1, y: sweep },
        mouth: found ? "open" : "flat",
        arms: "lens",
        prop: "lens",
        lens: sweep,
        x: [0, 0, 1, 1, 0, 0][(clock >> 2) % 6]!,
        antenna: sweep,
      }
    }

    case "waiting": {
      // Waves for attention and taps a foot, with a blinking alert above its head.
      const wave = clock % 4 < 2
      return {
        ...base,
        eyes: blink ? "closed" : "wide",
        gaze: input.look ?? { x: 0, y: 0 },
        mouth: "open",
        arms: wave ? "wave" : "wave2",
        feet: (clock >> 1) % 2 === 0 ? "tap" : "rest",
        glow: clock % 4 < 3 ? "on" : "dim",
        antenna: wave ? 1 : 0,
        decor: clock % 6 < 4 ? [{ kind: "alert" }] : [],
      }
    }

    case "success": {
      const hop = [0, -1, -2, -1, 0][age] ?? 0
      return {
        ...base,
        eyes: "happy",
        gaze: { x: 0, y: 0 },
        mouth: "grin",
        blush: true,
        arms: age < 6 ? "cheer" : "wave",
        feet: hop < 0 ? "tuck" : "rest",
        y: hop,
        decor: [
          { kind: "sparkle", x: 14, y: -3, big: age % 4 < 2 },
          { kind: "sparkle", x: -3, y: 0, big: age % 4 >= 2 },
        ],
      }
    }

    case "completed": {
      // Two big hops with confetti, then a contented sway.
      const party = age < 24
      const hop = party ? ([0, -1, -2, -3, -2, -1, 0, 0][age % 8] ?? 0) : 0
      return {
        ...base,
        eyes: party || !blink ? "happy" : "closed",
        gaze: { x: 0, y: 0 },
        mouth: party ? "grin" : "smile",
        blush: true,
        arms: party ? (age % 4 < 2 ? "cheer" : "cheer2") : "low",
        feet: hop < 0 ? "tuck" : "rest",
        y: hop,
        antenna: party ? (age % 2 === 0 ? 1 : -1) : sway,
        decor: [
          { kind: "sparkle", x: 14, y: -4, big: age % 6 < 3 },
          { kind: "sparkle", x: -3, y: -2, big: age % 6 >= 3 },
          { kind: "sparkle", x: 15, y: 4, big: (age + 2) % 6 < 3 },
          ...(party ? confetti(age) : []),
        ],
      }
    }

    case "error": {
      // A jolt with crossed eyes, then a sheepish frown and a bead of sweat.
      const shock = age < 8
      return {
        ...base,
        eyes: shock ? (age < 4 ? "x" : "wince") : blink ? "closed" : "half",
        gaze: { x: 0, y: shock ? 0 : 1 },
        mouth: shock ? "wavy" : "frown",
        arms: shock ? "shrug" : "low",
        x: shock ? ([0, 1, -1, 1, -1, 1, 0, 0][age] ?? 0) : 0,
        droop: !shock,
        antenna: shock ? 0 : 1,
        glow: clock % 4 < 2 ? "on" : "dim",
        decor: [{ kind: "sweat", y: shock ? 0 : Math.min(5, (age - 8) >> 1) }],
      }
    }
  }
}

/** Blinks for one tick every few seconds, with an occasional double blink. */
function blinking(clock: number) {
  const cycle = clock % 37
  if (cycle === 0) return true
  return cycle === 2 && noise(Math.floor(clock / 37)) > 0.6
}

/** Idle glances: mostly straight ahead, sometimes a look to the side, up or down for a second or two. */
function glance(clock: number) {
  const slot = Math.floor(clock / 14)
  const roll = noise(slot + 0.5)
  if (roll < 0.55) return { x: 0, y: 0 }
  if (roll < 0.7) return { x: -1, y: 0 }
  if (roll < 0.85) return { x: 1, y: 0 }
  if (roll < 0.93) return { x: 1, y: -1 }
  return { x: -1, y: 1 }
}

function confetti(age: number): Decor[] {
  return Array.from({ length: 7 }, (_, index) => {
    const x = Math.floor(noise(index * 7.3) * 22)
    const y = Math.floor(noise(index * 3.1 + 1) * 6) + age - 4
    return { kind: "confetti", x, y: y % 20, color: CONFETTI[index % CONFETTI.length]! }
  })
}
