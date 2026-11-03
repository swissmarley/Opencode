// Started from packages/cli like the source CLI, so its bunfig.toml preload applies. It then runs its own self command
// in another directory, the way the CLI starts its background server inside the user's project, and that child loads
// the TUI's `.tsx` config.
import { selfCommand } from "../../src/util/process"

if (process.argv[2] === "child") {
  await import("@opencode/tui/config")
  console.log("loaded")
  process.exit(0)
}

const child = Bun.spawnSync([...selfCommand(), "child"], { cwd: process.argv[2], stdout: "inherit", stderr: "inherit" })
process.exit(child.exitCode ?? 1)
